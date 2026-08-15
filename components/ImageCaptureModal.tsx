// components/ImageCaptureModal.tsx
//
// In-app burst capture for image training samples.
//
// This replaces bouncing out to the system camera app via ImagePicker, which
// cost an activity launch and two taps per single photo (~5s a sample). Holding
// the button here captures continuously from a preview that is already warm, so
// collecting the 20+ samples a class actually needs stops being tedious.
//
// It also removes the last train/test pipeline difference: samples are now taken
// through the same CameraView, at the same quality and orientation handling, as
// the frames LiveCameraScreen classifies.
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  BURST_FLUSH_EVERY,
  CAPTURE_MIRROR,
  CAPTURE_QUALITY,
  CameraFacing,
  MAX_BURST_FRAMES,
  facingLabel,
  pickPictureSize,
} from '../ml/capture';

export type CapturedFrame = { uri: string; base64: string };

type Props = {
  visible: boolean;
  className: string;
  facing: CameraFacing;
  onChangeFacing: (facing: CameraFacing) => void;
  /** Called with each flushed batch. Awaited, so it also applies backpressure. */
  onBatch: (frames: CapturedFrame[]) => Promise<void>;
  onClose: () => void;
};

export default function ImageCaptureModal({
  visible,
  className,
  facing,
  onChangeFacing,
  onBatch,
  onClose,
}: Props) {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  const [captured, setCaptured] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drives the burst loop. A ref rather than state because the loop reads it on
  // every iteration and must see the release immediately.
  const capturingRef = useRef(false);
  const bufferRef = useRef<CapturedFrame[]>([]);
  const totalRef = useRef(0);

  useEffect(() => {
    if (visible && permission && !permission.granted) requestPermission();
  }, [visible, permission, requestPermission]);

  // Reset per-session counters each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setCaptured(0);
    setError(null);
    totalRef.current = 0;
    bufferRef.current = [];
  }, [visible]);

  // Stop the loop if the sheet is dismissed mid-burst.
  useEffect(() => {
    if (!visible) capturingRef.current = false;
  }, [visible]);

  const handleCameraReady = async () => {
    setReady(true);
    try {
      const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
      if (sizes?.length) setPictureSize(pickPictureSize(sizes));
    } catch {
      // Falls back to the camera default, which only costs speed.
    }
  };

  const flush = async () => {
    const batch = bufferRef.current;
    bufferRef.current = [];
    if (batch.length > 0) await onBatch(batch);
  };

  const startBurst = async () => {
    if (capturingRef.current || !ready) return;

    capturingRef.current = true;
    setIsCapturing(true);

    try {
      // No artificial delay: the loop runs as fast as the device can encode,
      // which is the whole point. takePictureAsync is the natural rate limit.
      while (capturingRef.current && totalRef.current < MAX_BURST_FRAMES) {
        const photo = await cameraRef.current?.takePictureAsync({
          base64: true,
          quality: CAPTURE_QUALITY,
          shutterSound: false,
          // skipProcessing stays off deliberately — it bypasses orientation
          // correction, and a rotated frame embeds completely differently.
        });

        if (!photo?.base64 || !photo.uri) break;

        bufferRef.current.push({ uri: photo.uri, base64: photo.base64 });
        totalRef.current += 1;
        setCaptured(totalRef.current);

        // Awaited on purpose: it keeps memory bounded and stops the capture loop
        // outrunning the engine. Raise BURST_FLUSH_EVERY to trade memory for
        // throughput.
        if (bufferRef.current.length >= BURST_FLUSH_EVERY) await flush();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      capturingRef.current = false;
      setIsCapturing(false);
      try {
        await flush();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const stopBurst = () => {
    capturingRef.current = false;
  };

  const hitLimit = captured >= MAX_BURST_FRAMES;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {className}
          </Text>
          <Text style={styles.counter}>{captured} captured</Text>
        </View>

        <View style={styles.preview}>
          {permission?.granted ? (
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing={facing}
              mirror={CAPTURE_MIRROR}
              pictureSize={pictureSize}
              // The shutter animation adds latency per frame and is pointless
              // during a burst.
              animateShutter={false}
              // Refocusing between frames stalls the loop; the subject is
              // typically at a steady distance while collecting samples.
              autofocus={isCapturing ? 'off' : 'on'}
              onCameraReady={handleCameraReady}
            />
          ) : (
            <Text style={styles.permissionText}>
              {permission ? 'Camera access is needed to collect samples.' : 'Checking camera…'}
            </Text>
          )}
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Text style={styles.hint}>
          {hitLimit
            ? `Reached the ${MAX_BURST_FRAMES}-frame limit for one burst. Release and hold again to continue.`
            : 'Hold to capture continuously. Move around the subject for varied angles.'}
        </Text>

        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => onChangeFacing(facing === 'front' ? 'back' : 'front')}
            disabled={isCapturing}
          >
            <Text style={styles.secondaryButtonText}>{facingLabel(facing)}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.shutter,
              isCapturing && styles.shutterActive,
              (!ready || hitLimit) && styles.shutterDisabled,
            ]}
            onPressIn={startBurst}
            onPressOut={stopBurst}
            disabled={!ready || hitLimit}
          >
            <Text style={styles.shutterText}>{isCapturing ? 'Capturing…' : 'Hold'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={onClose}
            disabled={isCapturing}
          >
            <Text style={styles.secondaryButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    flex: 1,
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '700',
  },
  counter: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '700',
  },
  preview: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  camera: {
    width: '100%',
    height: '100%',
  },
  permissionText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    marginTop: 10,
  },
  hint: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
    marginBottom: 14,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  secondaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    minWidth: 96,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '600',
  },
  shutter: {
    backgroundColor: '#dc2626',
    borderRadius: 999,
    paddingVertical: 20,
    paddingHorizontal: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterActive: {
    backgroundColor: '#b91c1c',
  },
  shutterDisabled: {
    opacity: 0.5,
  },
  shutterText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
});
