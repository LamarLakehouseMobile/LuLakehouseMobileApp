// screens/LiveAudioScreen.tsx
//
// Audio counterpart to LiveCameraScreen. Same architecture: restore the
// persisted model once the engine is ready, capture from the device, hand the
// clip to the WebView engine, and render whatever prediction comes back.
//
// The one structural difference is inherent to the modality: a camera produces
// frames continuously, so LiveCameraScreen polls on a timer. Audio needs a
// user-defined start and end, so capture here is driven by a record button
// rather than an interval.
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { File } from 'expo-file-system';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useML } from '../context/MLContext';
import { loadPersistedModel } from '../ml/storage';

const recordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: 'document' as const,
};

export default function LiveAudioScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPredicting, setIsPredicting] = useState(false);

  const { sendToWebView, lastPrediction, clearPrediction, engineStatus, engineError } = useML();

  const audioRecorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(audioRecorder);

  // Mirrors LiveCameraScreen: pick the layout axis from the actual window so a
  // portrait phone does not get a squeezed fixed-width side panel.
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Avoids setting state after the screen has gone away mid-request.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Request microphone permission and configure the audio session.
  useEffect(() => {
    (async () => {
      try {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (mountedRef.current) setHasPermission(permission.granted);

        if (permission.granted) {
          await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
        }
      } catch (error) {
        console.warn('Unable to configure audio session', error);
        if (mountedRef.current) setHasPermission(false);
      }
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
        const saved = await loadPersistedModel('audio');
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

  const handleRecordAndPredict = async () => {
    if (recorderState.isRecording) {
      let capturedUri: string | null = null;

      try {
        await audioRecorder.stop();
        capturedUri = audioRecorder.uri;

        if (!capturedUri) {
          setStatusMessage('Recording stopped, but no file was created.');
          return;
        }

        setIsPredicting(true);
        // Drop the previous result so the card cannot show a stale prediction
        // while this one is still running.
        clearPrediction();
        setStatusMessage('Analysing…');

        const base64Audio = await new File(capturedUri).base64();
        const ack = await sendToWebView({ type: 'predictAudio', base64: base64Audio });

        if (mountedRef.current) {
          setStatusMessage(ack.ok ? null : `Prediction failed: ${ack.error}`);
        }
      } catch (error) {
        console.warn('Live audio capture error', error);
        if (mountedRef.current) {
          setStatusMessage(
            `Unable to analyse clip: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } finally {
        // This screen only ever needs the clip long enough to extract features,
        // so clean it up rather than letting test recordings pile up on disk.
        if (capturedUri) {
          try {
            new File(capturedUri).delete();
          } catch (error) {
            console.warn('Could not delete temp clip', error);
          }
        }
        if (mountedRef.current) setIsPredicting(false);
      }
      return;
    }

    try {
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setStatusMessage('Recording… tap again to analyse.');
    } catch (error) {
      console.warn('Failed to start recording', error);
      setStatusMessage('Unable to start recording.');
    }
  };

  if (hasPermission === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>Requesting microphone permission...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>No access to microphone</Text>
      </View>
    );
  }

  // The engine shares one prediction channel across modalities, so ignore any
  // result that came from the image screen.
  const prediction = lastPrediction?.modality === 'audio' ? lastPrediction : null;
  const confidences = prediction?.confidences ?? {};
  const hasClasses = Object.keys(confidences).length > 0;
  const isRecording = recorderState.isRecording;

  return (
    <View style={[styles.container, !isLandscape && styles.containerPortrait]}>
      <View style={styles.capturePane}>
        <TouchableOpacity
          style={[
            styles.recordButton,
            isRecording && styles.recordButtonActive,
            (isPredicting || engineStatus !== 'ready') && styles.recordButtonDisabled,
          ]}
          onPress={handleRecordAndPredict}
          disabled={isPredicting || engineStatus !== 'ready'}
        >
          <Text style={styles.recordButtonText}>
            {isRecording ? 'Stop & Analyse' : isPredicting ? 'Analysing…' : 'Record & Predict'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.infoPane, isLandscape ? styles.infoPaneSide : styles.infoPaneBelow]}>
        <Text style={styles.projectTitle}>Audio Project</Text>
        <Text style={[styles.liveLabel, engineStatus !== 'ready' && styles.liveLabelIdle]}>
          {engineStatus === 'ready'
            ? 'Ready'
            : engineStatus === 'loading'
              ? 'Loading ML engine…'
              : 'Engine error'}
        </Text>

        {(engineError || statusMessage) && (
          <Text style={styles.errorText}>{engineError ?? statusMessage}</Text>
        )}

        <View style={styles.predictionCard}>
          <Text style={styles.predictionTitle}>Prediction</Text>
          <Text style={styles.predictionClass}>
            {prediction ? prediction.className : 'No prediction yet'}
          </Text>
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
                  <Text style={styles.className} numberOfLines={1}>
                    {className}
                  </Text>
                </View>
                <View style={styles.barBackground}>
                  <View style={[styles.barFill, { width: `${Math.round(value * 100)}%` }]} />
                </View>
                <Text style={styles.percentText}>{(value * 100).toFixed(1)}%</Text>
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
  capturePane: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  recordButton: {
    backgroundColor: '#dc2626',
    borderRadius: 999,
    paddingVertical: 18,
    paddingHorizontal: 28,
    alignItems: 'center',
    minWidth: 200,
  },
  recordButtonActive: {
    backgroundColor: '#b91c1c',
  },
  recordButtonDisabled: {
    opacity: 0.5,
  },
  recordButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  infoPane: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: '#020617',
    borderColor: '#1f2937',
  },
  // Landscape: a fixed-width column beside the capture control.
  infoPaneSide: {
    width: 320,
    borderLeftWidth: 1,
  },
  // Portrait: a panel underneath, sized to its content.
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
