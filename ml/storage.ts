// ml/storage.ts
//
// Persistence for trained KNN datasets, keyed per modality.
//
// Image and audio used to share a single 'trainedModel' key holding a combined
// blob. Because each training screen only ever has its own modality's samples in
// hand, whichever screen trained last wrote a blob reflecting only its own state
// and silently dropped the other's dataset. Separate keys make the two flows
// independent.
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Modality = 'image' | 'audio';

export const MODALITIES: Modality[] = ['image', 'audio'];

/** One dataset per class label, as serialised by the engine. */
export type SerialisedDataset = Record<string, { shape: number[]; data: number[] }>;

export type TrainedModel = {
  version: number;
  /** Absent on legacy (version 1) blobs, which carried both modalities. */
  modality?: Modality;
  classNames: Record<string, string>;
  image?: SerialisedDataset;
  audio?: SerialisedDataset;
};

export const trainedModelKey = (modality: Modality) => `trainedModel:${modality}`;

/** Pre-split key. Read once for migration, then removed. */
const LEGACY_KEY = 'trainedModel';

const isNonEmpty = (dataset?: SerialisedDataset) =>
  !!dataset && Object.keys(dataset).length > 0;

/**
 * Splits a legacy combined blob into per-modality keys and drops the old key.
 *
 * Both modalities are migrated in one pass — migrating lazily per modality would
 * mean removing the legacy key before the second modality had been read from it.
 * Existing per-modality keys win, so this can never clobber newer data.
 */
async function migrateLegacyModel(): Promise<void> {
  const legacy = await AsyncStorage.getItem(LEGACY_KEY);
  if (!legacy) return;

  let parsed: TrainedModel | null = null;
  try {
    parsed = JSON.parse(legacy);
  } catch {
    // Unreadable blob: nothing to salvage, so just drop it.
    await AsyncStorage.removeItem(LEGACY_KEY);
    return;
  }

  const writes: Record<string, string> = {};

  for (const modality of MODALITIES) {
    const dataset = parsed?.[modality];
    if (!isNonEmpty(dataset)) continue;

    const key = trainedModelKey(modality);
    if (await AsyncStorage.getItem(key)) continue;

    writes[key] = JSON.stringify({
      version: 2,
      modality,
      classNames: parsed?.classNames ?? {},
      [modality]: dataset,
    } satisfies TrainedModel);
  }

  // v3 batch API: setMany takes an object, not multiSet's key/value pairs.
  if (Object.keys(writes).length > 0) await AsyncStorage.setMany(writes);
  await AsyncStorage.removeItem(LEGACY_KEY);
}

/**
 * Reads the persisted model for one modality, migrating a legacy blob first if
 * one is still present. Returns null when nothing has been trained yet — not an
 * error, just an empty slot.
 */
export async function loadPersistedModel(modality: Modality): Promise<TrainedModel | null> {
  await migrateLegacyModel();

  const raw = await AsyncStorage.getItem(trainedModelKey(modality));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as TrainedModel;
  } catch {
    return null;
  }
}

/** Persists the model the engine produced for one modality. */
export async function savePersistedModel(
  modality: Modality,
  model: TrainedModel | null,
): Promise<void> {
  if (!model) return;
  await AsyncStorage.setItem(trainedModelKey(modality), JSON.stringify(model));
}
