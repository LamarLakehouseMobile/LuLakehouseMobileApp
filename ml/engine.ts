// ml/engine.ts
//
// The Teachable Machine inference engine that runs inside the WebView.
//
// This is the file for the engine HTML. It is a plain string
// (not a .html file) because Metro cannot bundle .html assets without extra
// resolver config, and inlining keeps the engine versioned with its RN caller.
//
// Design notes / why this looks the way it does:
//
//  * Libraries are loaded imperatively via loadScript() rather than static
//    <script> tags. A static tag that 404s or times out fails silently; here we
//    verify the expected global actually exists, fall back to a second CDN, and
//    report the exact failing URL back to React Native.
//  * window.__TM.receive() is installed BEFORE any library loads, so a library
//    failure still leaves a live channel that can report the error. Previously a
//    ReferenceError at parse time meant no message listener was ever registered
//    and the engine died completely silently.
//  * Messages are answered with an {type:'ack', id} so the RN side can await a
//    real result instead of hoping.
//  * Image and audio get SEPARATE KNN classifiers. A single KNN requires every
//    example to share one feature length; mixing 1280-d image embeddings with
//    audio features in one classifier corrupts both.
//
// IMPORTANT: the engine source below must not contain backticks or "${", since
// it lives inside a TS template literal. Use single quotes and + concatenation.

/** Feature vector length for audio: AUDIO_FRAMES * AUDIO_BANDS. */
export const AUDIO_FRAMES = 24;
export const AUDIO_BANDS = 20;

export const ENGINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Teachable Machine Engine</title>
</head>
<body style="margin:0;background:#0f172a;color:#e5e7eb;font:12px system-ui">
  <div id="log">booting…</div>

  <script>
  (function () {
    'use strict';

    var CDNS = ['https://cdn.jsdelivr.net/npm', 'https://unpkg.com'];

    // Pinned, mutually compatible versions. mobilenet 2.1.1 and
    // knn-classifier 1.2.6 both peer-depend on @tensorflow/tfjs-core ^4.x.
    // NOTE the explicit /dist/*.min.js paths: without them the CDN serves the
    // CJS build, which never defines the UMD browser global.
    var LIBS = [
      { name: 'tfjs', path: '/@tensorflow/tfjs@4.22.0/dist/tf.min.js', global: 'tf' },
      { name: 'mobilenet', path: '/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js', global: 'mobilenet' },
      { name: 'knn-classifier', path: '/@tensorflow-models/knn-classifier@1.2.6/dist/knn-classifier.min.js', global: 'knnClassifier' }
    ];

    var AUDIO_FRAMES = ${AUDIO_FRAMES};
    var AUDIO_BANDS = ${AUDIO_BANDS};
    var AUDIO_FEATURE_LEN = AUDIO_FRAMES * AUDIO_BANDS;
    var AUDIO_MAX_SECONDS = 3;
    var FRAME_LENGTH = 1024;
    var FRAME_STEP = 512;

    var state = {
      status: 'booting',
      error: null,
      mobilenet: null,
      knnImage: null,
      knnAudio: null,
      imageFeatureLen: null,
      classNames: {},
      seen: {},
      audioCtx: null
    };

    // ---------------------------------------------------------------- bridge

    function send(payload) {
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      } catch (e) {
        // Nothing we can do — the bridge is the only channel out.
      }
    }

    function log(msg) {
      var text = String(msg);
      send({ type: 'log', msg: text });
      var el = document.getElementById('log');
      if (el) { el.textContent = text; }
    }

    function describe(err) {
      if (!err) { return 'unknown error'; }
      return err.message ? err.message : String(err);
    }

    function fail(stage, err) {
      state.status = 'error';
      state.error = stage + ': ' + describe(err);
      send({
        type: 'engineError',
        stage: stage,
        message: describe(err),
        stack: err && err.stack ? String(err.stack) : null
      });
      log('ERROR ' + state.error);
    }

    // Surface anything that escapes, so a failure is never silent again.
    window.onerror = function (message, source, lineno, colno, error) {
      send({
        type: 'engineError',
        stage: 'window.onerror',
        message: String(message),
        line: lineno,
        column: colno,
        stack: error && error.stack ? String(error.stack) : null
      });
      return false;
    };

    window.addEventListener('unhandledrejection', function (e) {
      send({
        type: 'engineError',
        stage: 'unhandledrejection',
        message: describe(e && e.reason)
      });
    });

    // ---------------------------------------------------------- library load

    function loadScript(url) {
      return new Promise(function (resolve, reject) {
        var el = document.createElement('script');
        var timer = setTimeout(function () {
          el.onload = null;
          el.onerror = null;
          reject(new Error('timed out after 20s loading ' + url));
        }, 20000);

        el.async = true;
        el.src = url;
        el.onload = function () { clearTimeout(timer); resolve(); };
        el.onerror = function () { clearTimeout(timer); reject(new Error('network error loading ' + url)); };
        document.head.appendChild(el);
      });
    }

    function loadLib(lib) {
      function attempt(i) {
        if (i >= CDNS.length) {
          return Promise.reject(new Error('every CDN failed for ' + lib.name));
        }
        var url = CDNS[i] + lib.path;
        return loadScript(url).then(function () {
          // A 200 that serves the wrong build is the subtle failure mode:
          // verify the global really exists before declaring success.
          if (!window[lib.global]) {
            throw new Error(lib.name + ' loaded from ' + url + ' but global "' + lib.global + '" is undefined');
          }
          log(lib.name + ' ready');
        }).catch(function (err) {
          log('retrying ' + lib.name + ': ' + describe(err));
          return attempt(i + 1);
        });
      }
      return attempt(0);
    }

    // ------------------------------------------------------------------ boot

    function boot() {
      state.status = 'loading';
      send({ type: 'engineStatus', status: 'loading' });

      var seq = Promise.resolve();
      LIBS.forEach(function (lib) {
        seq = seq.then(function () { return loadLib(lib); });
      });

      return seq.then(function () {
        return tf.ready();
      }).then(function () {
        log('tfjs backend: ' + tf.getBackend());
        log('loading mobilenet weights…');
        return mobilenet.load({ version: 2, alpha: 1.0 });
      }).then(function (model) {
        state.mobilenet = model;

        // Warm up once so the first real capture is not paying compile cost,
        // and so we learn the embedding width for validation.
        var warm = tf.zeros([224, 224, 3]);
        var probe = model.infer(warm, true);
        state.imageFeatureLen = probe.shape[1];
        warm.dispose();
        probe.dispose();

        state.knnImage = knnClassifier.create();
        state.knnAudio = knnClassifier.create();
        state.status = 'ready';

        send({
          type: 'engineReady',
          backend: tf.getBackend(),
          imageFeatureLength: state.imageFeatureLen,
          audioFeatureLength: AUDIO_FEATURE_LEN
        });
        log('engine ready (' + tf.getBackend() + ', ' + state.imageFeatureLen + '-d embeddings)');
      }).catch(function (err) {
        fail('boot', err);
      });
    }

    // ----------------------------------------------------------------- image

    function decodeImage(data) {
      return new Promise(function (resolve, reject) {
        if (!data || typeof data !== 'string') {
          reject(new Error('no base64 image data supplied'));
          return;
        }
        var src = data.indexOf('data:') === 0 ? data : 'data:image/jpeg;base64,' + data;
        var img = new Image();
        var timer = setTimeout(function () {
          reject(new Error('image decode timed out'));
        }, 15000);

        img.onload = function () {
          clearTimeout(timer);
          if (!img.width || !img.height) {
            reject(new Error('decoded image has zero dimensions'));
            return;
          }
          resolve(img);
        };
        // Without this handler a malformed data URI left the promise pending
        // forever, which looked exactly like "the engine never ran".
        img.onerror = function () {
          clearTimeout(timer);
          reject(new Error('could not decode image (bad base64 or unsupported format)'));
        };
        img.src = src;
      });
    }

    function embedImage(img) {
      // mobilenet.infer handles fromPixels + resize to 224 + [0,255] scaling,
      // so hand it the element and let it normalise.
      return tf.tidy(function () {
        return state.mobilenet.infer(tf.browser.fromPixels(img), true);
      });
    }

    // ----------------------------------------------------------------- audio

    function getAudioContext() {
      if (!state.audioCtx) {
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) { throw new Error('AudioContext unavailable in this WebView'); }
        state.audioCtx = new Ctor();
      }
      return state.audioCtx;
    }

    function base64ToArrayBuffer(b64) {
      var comma = b64.indexOf(',');
      var clean = comma >= 0 ? b64.slice(comma + 1) : b64;
      var binary = atob(clean);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }

    function decodeAudio(b64) {
      var buffer = base64ToArrayBuffer(b64);
      var ctx = getAudioContext();
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          reject(new Error('audio decode timed out'));
        }, 20000);
        ctx.decodeAudioData(buffer, function (decoded) {
          clearTimeout(timer);
          resolve(decoded);
        }, function (err) {
          clearTimeout(timer);
          reject(new Error('could not decode audio: ' + (describe(err) || 'unsupported format')));
        });
      });
    }

    function toMono(audioBuffer) {
      var limit = Math.min(
        audioBuffer.length,
        Math.floor(audioBuffer.sampleRate * AUDIO_MAX_SECONDS)
      );
      // Pad short clips so there is always at least one full STFT frame.
      var length = Math.max(limit, FRAME_LENGTH * 2);
      var out = new Float32Array(length);
      var channels = audioBuffer.numberOfChannels;

      for (var c = 0; c < channels; c++) {
        var data = audioBuffer.getChannelData(c);
        for (var i = 0; i < limit; i++) {
          out[i] += data[i] / channels;
        }
      }
      return out;
    }

    // Produces a fixed-length log-magnitude spectrogram. Fixed length matters:
    // a KNN cannot compare examples of differing dimensionality, and raw
    // compressed-file bytes (the previous approach) are not comparable at all.
    function audioFeatures(samples) {
      return tf.tidy(function () {
        var signal = tf.tensor1d(samples);
        var stft = tf.signal.stft(signal, FRAME_LENGTH, FRAME_STEP);
        var mag = tf.abs(stft);
        var logMag = tf.log(tf.add(mag, 1e-6));

        // Resample the [frames, bins] spectrogram to a constant shape.
        var resized = tf.image.resizeBilinear(
          logMag.expandDims(0).expandDims(-1),
          [AUDIO_FRAMES, AUDIO_BANDS]
        );
        var flat = resized.reshape([1, AUDIO_FEATURE_LEN]);

        // Per-sample standardisation so loudness does not dominate distance.
        var moments = tf.moments(flat);
        return flat.sub(moments.mean).div(tf.sqrt(moments.variance).add(1e-6));
      });
    }

    // ------------------------------------------------------------ classifier

    function counts(knn) {
      return knn && knn.getNumClasses() > 0 ? knn.getClassExampleCount() : {};
    }

    function stats() {
      return {
        status: state.status,
        error: state.error,
        image: counts(state.knnImage),
        audio: counts(state.knnAudio),
        classNames: state.classNames
      };
    }

    function named(confidences) {
      var out = {};
      Object.keys(confidences).forEach(function (id) {
        out[state.classNames[id] || id] = confidences[id];
      });
      return out;
    }

    function exportDataset(knn) {
      var ds = knn.getClassifierDataset();
      var out = {};
      Object.keys(ds).forEach(function (label) {
        out[label] = {
          shape: ds[label].shape,
          data: Array.prototype.slice.call(ds[label].dataSync())
        };
      });
      return out;
    }

    // Only the labels present in this dataset, so a per-modality model does not
    // carry the other modality's class names around with it.
    function namesFor(dataset) {
      var out = {};
      Object.keys(dataset).forEach(function (label) {
        out[label] = state.classNames[label] || label;
      });
      return out;
    }

    function knnFor(modality) {
      if (modality === 'image') { return state.knnImage; }
      if (modality === 'audio') { return state.knnAudio; }
      throw new Error('train needs modality "image" or "audio", got: ' + modality);
    }

    function importDataset(knn, obj) {
      var ds = {};
      Object.keys(obj || {}).forEach(function (label) {
        ds[label] = tf.tensor2d(obj[label].data, obj[label].shape);
      });
      knn.setClassifierDataset(ds);
    }

    // -------------------------------------------------------------- handlers

    function addSample(knn, modality, payload, embedding) {
      if (payload.classId == null) { throw new Error('addSample needs a classId'); }
      state.classNames[payload.classId] = payload.className || String(payload.classId);
      knn.addExample(embedding, String(payload.classId));
      embedding.dispose();
      return {
        type: 'sampleAdded',
        modality: modality,
        classId: payload.classId,
        className: state.classNames[payload.classId],
        counts: counts(knn)
      };
    }

    function predict(knn, modality, embedding) {
      if (knn.getNumClasses() === 0) {
        embedding.dispose();
        throw new Error('nothing trained yet — add samples before predicting');
      }

      // k must not exceed the number of stored examples: predictClass runs
      // tf.topk internally, which throws if k is larger than the dataset. Early
      // on there may only be one or two samples.
      var total = 0;
      var byClass = counts(knn);
      Object.keys(byClass).forEach(function (id) { total += byClass[id]; });
      var k = Math.max(1, Math.min(3, total));

      return knn.predictClass(embedding, k).then(function (result) {
        embedding.dispose();
        return {
          type: 'prediction',
          modality: modality,
          classId: result.label,
          className: state.classNames[result.label] || result.label,
          confidences: named(result.confidences)
        };
      }, function (err) {
        embedding.dispose();
        throw err;
      });
    }

    var handlers = {
      addImageSample: function (payload) {
        return decodeImage(payload.base64).then(function (img) {
          return addSample(state.knnImage, 'image', payload, embedImage(img));
        });
      },

      // Burst capture sends many frames at once. Doing them in one message saves
      // a bridge round trip and an ack per frame, which is most of the per-sample
      // overhead once the camera itself is no longer the bottleneck.
      addImageSamples: function (payload) {
        var images = payload.images || [];
        if (payload.classId == null) { throw new Error('addImageSamples needs a classId'); }
        if (images.length === 0) { throw new Error('addImageSamples got no images'); }

        var classId = String(payload.classId);
        state.classNames[classId] = payload.className || classId;

        var added = 0;
        var failed = 0;

        // Sequential rather than parallel: concurrent MobileNet inferences
        // thrash GPU memory, and the frames are already queued locally.
        function step(i) {
          if (i >= images.length) { return Promise.resolve(); }

          return decodeImage(images[i])
            .then(function (img) {
              var embedding = embedImage(img);
              state.knnImage.addExample(embedding, classId);
              embedding.dispose();
              added++;
            })
            .catch(function (err) {
              // One unreadable frame in a burst should not discard the rest.
              failed++;
              log('skipped a burst frame: ' + describe(err));
            })
            .then(function () { return step(i + 1); });
        }

        return step(0).then(function () {
          if (added === 0) { throw new Error('every frame in the batch failed to decode'); }
          return {
            type: 'sampleAdded',
            modality: 'image',
            classId: payload.classId,
            className: state.classNames[classId],
            added: added,
            failed: failed,
            counts: counts(state.knnImage)
          };
        });
      },

      predictImage: function (payload) {
        return decodeImage(payload.base64).then(function (img) {
          return predict(state.knnImage, 'image', embedImage(img));
        });
      },

      addAudioSample: function (payload) {
        return decodeAudio(payload.base64).then(function (decoded) {
          return addSample(
            state.knnAudio, 'audio', payload, audioFeatures(toMono(decoded))
          );
        });
      },

      predictAudio: function (payload) {
        return decodeAudio(payload.base64).then(function (decoded) {
          return predict(state.knnAudio, 'audio', audioFeatures(toMono(decoded)));
        });
      },

      // KNN is lazy/instance-based: there is no gradient step to run. This
      // exists so the UI's "Train" button has something real to await, and so
      // it can hand back a serialisable model.
      //
      // Scoped to one modality: the caller only has its own samples in hand, so
      // returning a combined model would let whichever screen trained last
      // overwrite the other's persisted dataset with an empty one.
      train: function (payload) {
        var modality = payload.modality;
        var knn = knnFor(modality);
        var dataset = exportDataset(knn);

        if (Object.keys(dataset).length === 0) {
          throw new Error('no ' + modality + ' samples to train on');
        }

        var model = { version: 2, modality: modality, classNames: namesFor(dataset) };
        model[modality] = dataset;

        return { type: 'trained', modality: modality, model: model, stats: stats() };
      },

      // Additive on purpose: only datasets actually present in the payload are
      // touched. Calling setClassifierDataset with an empty object would clear a
      // classifier, so restoring an image-only model must not reach the audio
      // KNN at all. Class names merge for the same reason.
      loadModel: function (payload) {
        var model = payload.model || {};

        if (model.classNames) {
          Object.keys(model.classNames).forEach(function (id) {
            state.classNames[id] = model.classNames[id];
          });
        }

        // An empty object is truthy but would still clear the classifier, so
        // test for actual entries rather than mere presence.
        var hasEntries = function (d) { return !!d && Object.keys(d).length > 0; };

        var restored = [];
        if (hasEntries(model.image)) { importDataset(state.knnImage, model.image); restored.push('image'); }
        if (hasEntries(model.audio)) { importDataset(state.knnAudio, model.audio); restored.push('audio'); }

        log(restored.length ? 'model restored (' + restored.join(', ') + ')' : 'model had nothing to restore');
        return { type: 'modelLoaded', restored: restored, stats: stats() };
      },

      reset: function () {
        if (state.knnImage) { state.knnImage.clearAllClasses(); }
        if (state.knnAudio) { state.knnAudio.clearAllClasses(); }
        state.classNames = {};
        return { type: 'reset', stats: stats() };
      },

      clearClass: function (payload) {
        var id = String(payload.classId);
        [state.knnImage, state.knnAudio].forEach(function (knn) {
          if (knn && counts(knn)[id] != null) { knn.clearClass(id); }
        });
        delete state.classNames[id];
        return { type: 'classCleared', classId: payload.classId, stats: stats() };
      },

      getStatus: function () {
        return { type: 'status', stats: stats() };
      }
    };

    // --------------------------------------------------------------- receive

    // Serialise work. Concurrent mobilenet inferences on a 300ms camera timer
    // will thrash GPU memory; one at a time keeps things predictable.
    var chain = Promise.resolve();

    function receive(raw) {
      var payload;
      try {
        payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        log('ignoring non-JSON message from RN');
        return;
      }
      if (!payload || typeof payload !== 'object' || !payload.type) { return; }

      // The same logical message can arrive twice (injectJavaScript plus a
      // bubbled MessageEvent); ids make delivery idempotent.
      if (payload.id != null) {
        if (state.seen[payload.id]) { return; }
        state.seen[payload.id] = true;
      }

      var handler = handlers[payload.type];
      if (!handler) {
        send({ type: 'ack', id: payload.id, ok: false, error: 'unknown message type: ' + payload.type });
        return;
      }
      if (state.status !== 'ready' && payload.type !== 'getStatus') {
        send({
          type: 'ack',
          id: payload.id,
          ok: false,
          error: 'engine is not ready (status=' + state.status + (state.error ? '; ' + state.error : '') + ')'
        });
        return;
      }

      chain = chain.then(function () {
        return Promise.resolve()
          .then(function () { return handler(payload); })
          .then(function (result) {
            if (result) { send(result); }
            send({ type: 'ack', id: payload.id, ok: true, result: result || null });
          })
          .catch(function (err) {
            send({ type: 'ack', id: payload.id, ok: false, error: describe(err) });
            send({ type: 'engineError', stage: payload.type, message: describe(err) });
          });
      });
    }

    // Installed before boot() so library failures can still be reported.
    window.__TM = { receive: receive, stats: stats };

    // Belt and braces for the native postMessage path: Android dispatches the
    // MessageEvent on document, iOS on window. Listening to only one silently
    // drops every message on the other platform.
    document.addEventListener('message', function (e) { receive(e.data); });
    window.addEventListener('message', function (e) { receive(e.data); });

    boot();
  })();
  </script>
</body>
</html>
`;
