// ml/capture.ts
//
// Shared image-capture settings for the training and live screens.
//
// A KNN over MobileNet embeddings compares raw appearance, so anything that
// differs between how a sample was collected and how a frame is later captured
// shows up as a distance penalty and wrecks accuracy. The two screens used to
// disagree on all of the following at once:
//
//   * which camera (training defaulted to rear, the live screen hardcoded front)
//   * JPEG quality (0.8 vs 0.4)
//   * orientation (the live screen passed skipProcessing, which per the SDK docs
//     "bypasses orientation adjustment" and can yield a 90/180/270-rotated frame)
//
// Keeping these in one module is what stops them drifting apart again.
import AsyncStorage from '@react-native-async-storage/async-storage';

export type CameraFacing = 'front' | 'back';

/**
 * Used by BOTH screens. Matching compression matters because JPEG artefacts
 * move the embedding; a lower value is also faster to base64 across the bridge,
 * so this is a compromise rather than either previous extreme.
 */
export const CAPTURE_QUALITY = 0.7;

/**
 * Front-camera capture is left un-mirrored on both paths. The preview is
 * mirrored so it feels like a mirror to the user, but MobileNet embeddings are
 * not mirror-invariant, so what gets classified must match what was trained.
 */
export const CAPTURE_MIRROR = false;

/**
 * MobileNet resizes its input to 224x224, so capturing at full sensor
 * resolution just spends JPEG encode time on detail that is thrown away. This is
 * the smallest edge worth keeping.
 */
export const MIN_CAPTURE_EDGE = 224;

/**
 * How many burst frames to accumulate before handing them to the engine. Each
 * flush is one bridge round trip, so batching cuts overhead; keeping it small
 * bounds how much base64 is held in memory at once.
 */
export const BURST_FLUSH_EVERY = 4;

/** Safety stop so a stuck finger cannot capture without bound. */
export const MAX_BURST_FRAMES = 150;

/** Fixed audio clip length. One tap records exactly this and auto-stops. */
export const AUDIO_CLIP_MS = 1000;

/**
 * Picks the smallest reported picture size that still clears MIN_CAPTURE_EDGE.
 *
 * Sizes come back as "WxH" strings and the list is device-specific, so this
 * returns undefined when nothing is parseable and the caller should fall back to
 * the camera default.
 */
export function pickPictureSize(available: string[]): string | undefined {
  const usable = available
    .map((size) => {
      const [width, height] = size.split('x').map(Number);
      return { size, width, height };
    })
    .filter(
      ({ width, height }) =>
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width >= MIN_CAPTURE_EDGE &&
        height >= MIN_CAPTURE_EDGE,
    )
    .sort((a, b) => a.width * a.height - b.width * b.height);

  return usable[0]?.size;
}

const FACING_KEY = 'imageCapture:facing';

export const facingLabel = (facing: CameraFacing) =>
  facing === 'front' ? 'Front (selfie)' : 'Rear';

/** Remembers which camera the samples were collected with. */
export async function saveTrainingFacing(facing: CameraFacing): Promise<void> {
  try {
    await AsyncStorage.setItem(FACING_KEY, facing);
  } catch (error) {
    // Only the convenience of pre-selecting the right camera is lost.
    console.warn('Could not persist camera facing', error);
  }
}

/**
 * The camera the model was trained with, or null if nothing has been captured
 * yet. The live screen uses this as its initial camera so testing matches
 * training by default instead of by luck.
 */
export async function loadTrainingFacing(): Promise<CameraFacing | null> {
  try {
    const stored = await AsyncStorage.getItem(FACING_KEY);
    return stored === 'front' || stored === 'back' ? stored : null;
  } catch {
    return null;
  }
}
