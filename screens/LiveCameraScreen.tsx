// screens/LiveCameraScreen.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import { File } from 'expo-file-system';
import { useML } from '../context/MLContext';
import { loadPersistedModel } from '../ml/storage';
import {
  CAPTURE_MIRROR,
  CAPTURE_QUALITY,
  CameraFacing,
  facingLabel,
  loadTrainingFacing,
} from '../ml/capture';

/**
 * Gap between capture attempts. Each frame is a full MobileNet inference plus a
 * base64 round-trip over the bridge, so this is a floor, not a guarantee.
 */
const CAPTURE_INTERVAL_MS = 600;

/**
 * Number of recent frames averaged into the displayed confidences.
 *
 * A single frame's KNN vote is coarse — with k=3 it can only ever be 0, 1/3, 2/3
 * or 1 — so raw per-frame output flickers between classes even when the subject
 * is steady. Averaging a short window makes the reading stable without hiding
 * genuine changes.
 */
const SMOOTHING_WINDOW = 5;

type Confidences = Record<string, number>;

/** Mean confidence per class across the window, renormalised to sum to 1. */
function averageConfidences(frames: Confidences[]): Confidences {
  if (frames.length === 0) return {};

  const totals: Confidences = {};
  for (const frame of frames) {
    for (const [className, value] of Object.entries(frame)) {
      totals[className] = (totals[className] ?? 0) + value;
    }
  }

  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  if (sum === 0) return totals;

  return Object.fromEntries(
    Object.entries(totals).map(([className, total]) => [className, total / sum]),
  );
}

export default function LiveCameraScreen() {
  const cameraRef = useRef<CameraView | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [facing, setFacing] = useState<CameraFacing>('back');
  const [trainedFacing, setTrainedFacing] = useState<CameraFacing | null>(null);
  const [smoothed, setSmoothed] = useState<Confidences>({});

  const { sendToWebView, lastPrediction, engineStatus, engineError } = useML();

  // Start on whichever camera the samples were collected with, so testing
  // matches training by default rather than by coincidence.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadTrainingFacing();
      if (!stored || cancelled) return;
      setTrainedFacing(stored);
      setFacing(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Rolling window of recent per-frame confidences.
  const windowRef = useRef<Confidences[]>([]);

  useEffect(() => {
    if (!lastPrediction || lastPrediction.modality !== 'image') return;

    windowRef.current = [...windowRef.current, lastPrediction.confidences].slice(
      -SMOOTHING_WINDOW,
    );
    setSmoothed(averageConfidences(windowRef.current));
  }, [lastPrediction]);

  // Frames from a different camera are not comparable, so discard the window
  // rather than averaging across the switch.
  useEffect(() => {
    windowRef.current = [];
    setSmoothed({});
  }, [facing]);

  // The original layout was a hardcoded row with a fixed 320px side panel, which
  // on a portrait phone left the camera a ~40px slither. Pick the axis from the
  // actual window instead, and re-evaluate on rotation.
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Request camera permission
  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // Restore a previously persisted model, if there is one. The KNN normally
  // already holds this session's samples (the engine WebView is never
  // unmounted), so a miss here is not an error — it just means nothing was
  // trained in an earlier run.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (engineStatus !== 'ready') return;

      try {
        const saved = await loadPersistedModel('image');
        if (!saved || cancelled) return;

        const ack = await sendToWebView({ type: 'loadModel', model: saved });
        if (!cancelled && !ack.ok) {
          console.warn('Could not restore saved model', ack.error);
        }
      } catch (error) {
        console.warn('Failed to read saved model', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [engineStatus, sendToWebView]);

  // Stream frames once the camera and engine are both up.
  //
  // Note what is NOT in the dep array: no piece of state that this effect also
  // sets. Previously `isStreaming` was both a dependency and set inside, so the
  // effect re-ran and cleared its own interval on every render — the 300ms timer
  // never survived long enough to fire.
  useEffect(() => {
    if (!cameraReady || !hasPermission || engineStatus !== 'ready') return;

    let stopped = false;
    // Guards against piling up captures when inference is slower than the
    // timer, which would otherwise queue frames faster than they drain.
    let inFlight = false;

    const tick = async () => {
      if (stopped || inFlight || !cameraRef.current) return;
      inFlight = true;

      let capturedUri: string | null = null;

      try {
        const photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: CAPTURE_QUALITY,
          shutterSound: false,
          // skipProcessing is deliberately NOT set. It bypasses orientation
          // adjustment, which handed the engine 90-degree-rotated frames while
          // the training samples were upright — different embeddings for the
          // same subject, and the main reason predictions looked random.
        });

        capturedUri = photo?.uri ?? null;
        if (stopped || !photo?.base64) return;

        const ack = await sendToWebView({
          type: 'predictImage',
          base64: `data:image/jpeg;base64,${photo.base64}`,
        });

        if (!stopped) {
          setStatusMessage(ack.ok ? null : ack.error ?? 'Prediction failed');
        }
      } catch (error) {
        if (!stopped) {
          console.warn('Live capture error', error);
        }
      } finally {
        // takePictureAsync writes a JPEG to the cache directory on every call.
        // At this cadence that is ~100 files a minute, so each frame has to be
        // cleaned up once its base64 is on the way to the engine.
        if (capturedUri) {
          try {
            new File(capturedUri).delete();
          } catch (error) {
            console.warn('Could not delete temp frame', error);
          }
        }
        inFlight = false;
      }
    };

    const interval = setInterval(tick, CAPTURE_INTERVAL_MS);
    tick();

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [cameraReady, hasPermission, engineStatus, sendToWebView]);

  if (hasPermission === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>No access to camera</Text>
      </View>
    );
  }

  // Display the smoothed window rather than the latest single frame.
  const confidences = smoothed;
  const hasClasses = Object.keys(confidences).length > 0;
  const topClass = Object.entries(confidences).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const facingMismatch = trainedFacing !== null && trainedFacing !== facing;

  return (
    <View style={[styles.container, !isLandscape && styles.containerPortrait]}>
      <View style={styles.cameraPane}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          mirror={CAPTURE_MIRROR}
          onCameraReady={() => setCameraReady(true)}
        />

        <TouchableOpacity
          style={styles.flipButton}
          onPress={() => setFacing((current) => (current === 'front' ? 'back' : 'front'))}
        >
          <Text style={styles.flipButtonText}>
            Flip to {facing === 'front' ? 'rear' : 'front'} camera
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.infoPane, isLandscape ? styles.infoPaneSide : styles.infoPaneBelow]}>
        <Text style={styles.projectTitle}>Image Project</Text>
        <Text style={[styles.liveLabel, engineStatus !== 'ready' && styles.liveLabelIdle]}>
          {engineStatus === 'ready'
            ? 'Live'
            : engineStatus === 'loading'
              ? 'Loading ML engine…'
              : 'Engine error'}
        </Text>

        {(engineError || statusMessage) && (
          <Text style={styles.errorText}>{engineError ?? statusMessage}</Text>
        )}

        {facingMismatch && trainedFacing && (
          <Text style={styles.warningText}>
            This model was trained on the {facingLabel(trainedFacing).toLowerCase()} camera.
            Predictions from a different camera are unreliable.
          </Text>
        )}

        <View style={styles.predictionCard}>
          <Text style={styles.predictionTitle}>Prediction</Text>
          <Text style={styles.predictionClass}>{topClass ?? 'No prediction yet'}</Text>
        </View>

        <View style={styles.classesList}>
          {!hasClasses ? (
            <Text style={styles.noClassesText}>
              No classes trained yet. Go back and train your model.
            </Text>
          ) : (
            Object.entries(confidences).map(([className, value]) => (
              <View key={className} style={styles.classRow}>
                <View style={styles.classLabelWrap}>
                  <Text style={styles.className}>{className}</Text>
                </View>
                <View style={styles.barBackground}>
                  <View
                    style={[styles.barFill, { width: `${Math.round(value * 100)}%` }]}
                  />
                </View>
                <Text style={styles.percentText}>
                  {(value * 100).toFixed(1)}%
                </Text>
              </View>
            ))
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#020617',
  },
  centerText: {
    color: '#e5e7eb',
    fontSize: 15,
  },
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#111827',
  },
  containerPortrait: {
    flexDirection: 'column',
  },
  cameraPane: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    width: '90%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    overflow: 'hidden',
  },
  infoPane: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: '#020617',
    borderColor: '#1f2937',
  },
  // Landscape: a fixed-width column beside the camera.
  infoPaneSide: {
    width: 320,
    borderLeftWidth: 1,
  },
  // Portrait: a panel under the camera, sized to its content rather than a
  // fixed width that would squeeze the preview.
  infoPaneBelow: {
    width: '100%',
    borderTopWidth: 1,
  },
  projectTitle: {
    color: '#e5e7eb',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  liveLabel: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 16,
  },
  liveLabelIdle: {
    color: '#f59e0b',
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    marginBottom: 12,
  },
  warningText: {
    color: '#fbbf24',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
  },
  flipButton: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  flipButtonText: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '600',
  },
  predictionCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  predictionTitle: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 4,
  },
  predictionClass: {
    color: '#f9fafb',
    fontSize: 20,
    fontWeight: '700',
  },
  classesList: {
    marginTop: 8,
  },
  noClassesText: {
    color: '#6b7280',
    fontSize: 13,
  },
  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  classLabelWrap: {
    width: 90,
  },
  className: {
    color: '#e5e7eb',
    fontSize: 13,
  },
  barBackground: {
    flex: 1,
    height: 10,
    backgroundColor: '#1f2937',
    borderRadius: 999,
    overflow: 'hidden',
    marginHorizontal: 8,
  },
  barFill: {
    height: 10,
    backgroundColor: '#3b82f6',
  },
  percentText: {
    width: 60,
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'right',
  },
});
