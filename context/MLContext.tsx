// context/MLContext.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { ENGINE_HTML } from '../ml/engine';

export type EngineStatus = 'loading' | 'ready' | 'error';

export type Prediction = {
  modality: 'image' | 'audio';
  classId: string;
  className: string;
  confidences: Record<string, number>;
};

/** Per-class example counts, keyed by classId. */
export type EngineStats = {
  status: string;
  error: string | null;
  image: Record<string, number>;
  audio: Record<string, number>;
  classNames: Record<string, string>;
};

/**
 * Result of a round-trip to the engine. Never rejects — callers get an explicit
 * ok/error pair instead, so a forgotten `await` cannot turn into an unhandled
 * rejection.
 */
export type EngineResult<T = any> = { ok: boolean; error?: string; result?: T };

type MLContextValue = {
  /** Sends a message and resolves once the engine acknowledges it. */
  sendToWebView: (msg: Record<string, unknown>) => Promise<EngineResult>;
  lastPrediction: Prediction | null;
  clearPrediction: () => void;
  engineStatus: EngineStatus;
  engineError: string | null;
  stats: EngineStats | null;
  /** Most recent engine log lines, newest last. Handy for on-screen debugging. */
  logs: string[];
};

const MLContext = createContext<MLContextValue | undefined>(undefined);

export const useML = () => {
  const ctx = useContext(MLContext);
  if (!ctx) throw new Error('useML must be used within MLProvider');
  return ctx;
};

/** How long to wait for an ack before giving up on a message. */
const ACK_TIMEOUT_MS = 45000;
const MAX_LOGS = 50;

type Pending = {
  resolve: (value: EngineResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

export const MLProvider = ({ children }: { children: ReactNode }) => {
  const webviewRef = useRef<WebView | null>(null);

  const [engineStatus, setEngineStatus] = useState<EngineStatus>('loading');
  const [engineError, setEngineError] = useState<string | null>(null);
  const [lastPrediction, setLastPrediction] = useState<Prediction | null>(null);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Messages sent before the engine finishes loading mobilenet are held here
  // rather than dropped. Loading weights over the network takes seconds, and
  // the UI is tappable the whole time.
  const queueRef = useRef<string[]>([]);
  const pendingRef = useRef<Map<number, Pending>>(new Map());
  const readyRef = useRef(false);
  const idRef = useRef(0);

  const settle = useCallback((id: number, value: EngineResult) => {
    const pending = pendingRef.current.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current.delete(id);
    pending.resolve(value);
  }, []);

  const deliver = useCallback((json: string) => {
    // injectJavaScript is the primary transport: it calls our global directly
    // and so sidesteps the Android-document / iOS-window MessageEvent split
    // entirely. JSON.stringify escapes the payload into a safe JS literal.
    webviewRef.current?.injectJavaScript(
      `window.__TM && window.__TM.receive(${JSON.stringify(json)}); true;`,
    );
  }, []);

  const sendToWebView = useCallback(
    (msg: Record<string, unknown>): Promise<EngineResult> => {
      const id = ++idRef.current;
      const json = JSON.stringify({ ...msg, id });

      return new Promise<EngineResult>((resolve) => {
        const timer = setTimeout(() => {
          pendingRef.current.delete(id);
          resolve({
            ok: false,
            error: `engine did not respond within ${ACK_TIMEOUT_MS / 1000}s`,
          });
        }, ACK_TIMEOUT_MS);

        pendingRef.current.set(id, { resolve, timer });

        if (readyRef.current) {
          deliver(json);
        } else {
          queueRef.current.push(json);
        }
      });
    },
    [deliver],
  );

  const flushQueue = useCallback(() => {
    const queued = queueRef.current;
    queueRef.current = [];
    queued.forEach(deliver);
  }, [deliver]);

  const appendLog = useCallback((line: string) => {
    setLogs((current) => [...current, line].slice(-MAX_LOGS));
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let data: any;
      try {
        data = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      switch (data.type) {
        case 'engineReady':
          readyRef.current = true;
          setEngineStatus('ready');
          setEngineError(null);
          appendLog(
            `engine ready (${data.backend}, image=${data.imageFeatureLength}d, audio=${data.audioFeatureLength}d)`,
          );
          flushQueue();
          break;

        case 'engineStatus':
          if (data.status === 'loading') setEngineStatus('loading');
          break;

        case 'engineError':
          // A boot failure is fatal for the engine; a per-message failure is
          // already reported through that message's ack, so don't flip the
          // whole engine to 'error' for it.
          appendLog(`[error:${data.stage}] ${data.message}`);
          console.warn('[ML engine]', data.stage, data.message, data.stack ?? '');
          if (data.stage === 'boot' || data.stage === 'window.onerror') {
            setEngineStatus('error');
            setEngineError(data.message);
          }
          break;

        case 'ack':
          settle(data.id, { ok: data.ok, error: data.error, result: data.result });
          break;

        case 'prediction':
          setLastPrediction({
            modality: data.modality,
            classId: data.classId,
            className: data.className,
            confidences: data.confidences ?? {},
          });
          break;

        case 'sampleAdded':
          appendLog(`sample added to "${data.className}"`);
          break;

        case 'trained':
        case 'modelLoaded':
        case 'reset':
        case 'classCleared':
        case 'status':
          if (data.stats) setStats(data.stats);
          break;

        case 'log':
          appendLog(data.msg);
          console.log('[ML]', data.msg);
          break;
      }
    },
    [appendLog, flushQueue, settle],
  );

  /** Resets bridge state whenever the WebView (re)loads or crashes. */
  const invalidate = useCallback(
    (reason: string) => {
      readyRef.current = false;
      setEngineStatus('loading');
      pendingRef.current.forEach((pending, id) => {
        clearTimeout(pending.timer);
        pendingRef.current.delete(id);
        pending.resolve({ ok: false, error: reason });
      });
    },
    [],
  );

  useEffect(
    () => () => {
      pendingRef.current.forEach((pending) => clearTimeout(pending.timer));
      pendingRef.current.clear();
    },
    [],
  );

  const clearPrediction = useCallback(() => setLastPrediction(null), []);

  return (
    <MLContext.Provider
      value={{
        sendToWebView,
        lastPrediction,
        clearPrediction,
        engineStatus,
        engineError,
        stats,
        logs,
      }}
    >
      <View style={{ flex: 1 }}>
        {children}

        {/*
          Kept mounted for the whole app lifetime: the KNN lives in here, so
          unmounting would throw away every collected sample. Offscreen rather
          than opacity:0 / display:none, both of which can get the WebView
          deprioritised on Android.
        */}
        <View
          style={{ position: 'absolute', width: 1, height: 1, left: -10, top: -10 }}
          pointerEvents="none"
        >
          <WebView
            ref={webviewRef}
            source={{ html: ENGINE_HTML, baseUrl: 'https://localhost/' }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            // tfjs fetches mobilenet weights over the network; a real https
            // baseUrl (above) gives the page a proper secure origin so those
            // CORS requests are not made from an opaque "null" origin.
            mixedContentMode="always"
            allowFileAccess
            cacheEnabled
            androidLayerType="hardware"
            onMessage={handleMessage}
            onLoadStart={() => invalidate('WebView reloaded before the message was handled')}
            onError={({ nativeEvent }) => {
              setEngineStatus('error');
              setEngineError(nativeEvent.description ?? 'WebView failed to load');
              console.warn('[ML WebView] load error', nativeEvent);
            }}
            onHttpError={({ nativeEvent }) => {
              console.warn('[ML WebView] http error', nativeEvent.statusCode, nativeEvent.url);
            }}
            onRenderProcessGone={({ nativeEvent }) => {
              // Android can kill the renderer under memory pressure; without
              // this the engine would appear to hang forever.
              invalidate('WebView renderer crashed');
              setEngineStatus('error');
              setEngineError(
                `WebView renderer crashed (didCrash=${nativeEvent.didCrash}). Reload the screen.`,
              );
            }}
            style={{ width: 1, height: 1 }}
          />
        </View>
      </View>
    </MLContext.Provider>
  );
};
