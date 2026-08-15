// screens/ImageTrainingScreen.tsx
import { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SideNavbar from '../components/SideNavbar';
import { HomeStackParamList, RecordedSample } from '../navigation/types';
import { useML } from '../context/MLContext';
import { savePersistedModel } from '../ml/storage';
import ImageCaptureModal, { CapturedFrame } from '../components/ImageCaptureModal';
import {
  CameraFacing,
  facingLabel,
  loadTrainingFacing,
  saveTrainingFacing,
} from '../ml/capture';

/**
 * Rough floor for usable KNN accuracy. Not enforced — just surfaced as a hint,
 * since "it predicts unreliably" is most often a sample-count problem rather
 * than a pipeline one.
 */
const RECOMMENDED_SAMPLES = 20;

type ImageClass = {
  id: string;
  name: string;
  isDefault: boolean;
  disabled: boolean;
};

export default function ImageTrainingScreen() {
  const { sendToWebView, engineStatus, engineError } = useML();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  const [classes, setClasses] = useState<ImageClass[]>([
    { id: 'default', name: 'Default Class', isDefault: true, disabled: false },
  ]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Ready to collect image samples.');
  const [savedImages, setSavedImages] = useState<Record<string, RecordedSample[]>>({});
  const [hasTrained, setHasTrained] = useState(false);
  const [facing, setFacing] = useState<CameraFacing>('back');
  /** Class the burst capture sheet is currently collecting for, if open. */
  const [captureTarget, setCaptureTarget] = useState<{ id: string; name: string } | null>(null);

  // Restore the camera last used for training so a session picks up where the
  // previous one left off, keeping a class's samples visually consistent.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadTrainingFacing();
      if (stored && !cancelled) setFacing(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAddClass = () => {
    const customCount = classes.filter((item) => !item.isDefault).length + 1;
    const newClass: ImageClass = {
      id: `class-${Date.now()}`,
      name: `Class ${customCount}`,
      isDefault: false,
      disabled: false,
    };

    setClasses((current) => [...current, newClass]);
    setActiveMenuId(null);
    setStatusMessage(`Added ${newClass.name}.`);
  };

  const handleDeleteClass = (classId: string) => {
    setClasses((current) => current.filter((item) => item.id !== classId));
    setSavedImages((current) => {
      const copy = { ...current };
      delete copy[classId];
      return copy;
    });
    setActiveMenuId(null);
    setStatusMessage('Class removed.');
  };

  const handleToggleDisable = (classId: string) => {
    setClasses((current) =>
      current.map((item) =>
        item.id === classId ? { ...item, disabled: !item.disabled } : item,
      ),
    );
    setActiveMenuId(null);
    setStatusMessage('Class state updated.');
  };

  const handleAction = (message: string) => {
    setStatusMessage(message);
    setActiveMenuId(null);
  };

  const removeAllImages = (classId: string) => {
    setSavedImages((current) => ({ ...current, [classId]: [] }));
    setActiveMenuId(null);
    setStatusMessage('Removed all images for this class.');
  };

  const confirmRemoveAllImages = (classId: string) => {
    Alert.alert(
      'Remove all images',
      'Are you sure you want to remove all saved images for this class? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeAllImages(classId) },
      ],
    );
  };

  /**
   * Receives each flushed batch from the burst capture sheet: records the frames
   * locally for "View Images" and hands them to the engine in one message.
   *
   * The sheet awaits this, so a slow engine throttles capture instead of
   * queueing frames without bound.
   */
  const handleCapturedBatch = async (frames: CapturedFrame[]) => {
    if (!captureTarget) return;
    const { id: classId, name: className } = captureTarget;

    const stamp = Date.now();
    const samples: RecordedSample[] = frames.map((frame, index) => ({
      id: `${stamp}-${index}`,
      uri: frame.uri,
      createdAt: new Date().toLocaleTimeString(),
    }));

    setSavedImages((current) => ({
      ...current,
      [classId]: [...(current[classId] ?? []), ...samples],
    }));

    // Record which camera produced these samples so the live screen can default
    // to the same one — a rear-trained model tested on the front camera is
    // comparing entirely different scenes.
    await saveTrainingFacing(facing);

    const ack = await sendToWebView({
      type: 'addImageSamples',
      classId,
      className,
      images: frames.map((frame) => `data:image/jpeg;base64,${frame.base64}`),
    });

    if (!ack.ok) {
      setStatusMessage(`Could not add samples: ${ack.error}`);
      return;
    }

    const added = ack.result?.added ?? frames.length;
    const total = ack.result?.counts?.[classId] ?? added;
    setStatusMessage(`Added ${added} sample${added === 1 ? '' : 's'} to ${className} (${total} total).`);
    setHasTrained(false);
  };

  const handleTrainModel = async () => {
    const totalSamples = Object.values(savedImages).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );

    if (totalSamples === 0) {
      setStatusMessage('Add at least one image sample before training.');
      return;
    }

    // A KNN classifier learns incrementally as samples are added, so there is no
    // gradient step here. What this does do is ask the engine for the serialised
    // dataset and persist it, so the live screen still works after a restart.
    setStatusMessage('Finalising model…');
    const ack = await sendToWebView({ type: 'train', modality: 'image' });

    if (!ack.ok) {
      setStatusMessage(`Training failed: ${ack.error}`);
      return;
    }

    try {
      await savePersistedModel('image', ack.result?.model ?? null);
    } catch (error) {
      // The in-memory model is still usable this session; only persistence failed.
      console.warn('Failed to persist trained model', error);
    }

    setStatusMessage('Model ready. You can now test your model.');
    setHasTrained(true);
  };

  // Any class that has samples but too few of them. Classes with none yet are
  // excluded — the user has simply not started on those.
  const needsMoreSamples = classes.some((item) => {
    const count = savedImages[item.id]?.length ?? 0;
    return count > 0 && count < RECOMMENDED_SAMPLES;
  });

  const handleTestModel = () => {
    if (!hasTrained) {
      setStatusMessage('Train the model first.');
      return;
    }
    navigation.navigate('LiveCamera');
  };

  return (
    <View style={styles.container}>
      <SideNavbar />

      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Image Training</Text>
      <Text style={styles.subtitle}>
        Create and manage your image classes, capture samples, then train and test your model.
      </Text>

      <View style={[styles.statusBox, engineStatus === 'error' && styles.statusBoxError]}>
        <Text style={[styles.statusText, engineStatus === 'error' && styles.statusTextError]}>
          {engineStatus === 'loading'
            ? 'Loading ML engine (downloading MobileNet)…'
            : engineStatus === 'error'
              ? `ML engine failed: ${engineError}`
              : statusMessage}
        </Text>
      </View>

      <View style={styles.cameraRow}>
        <Text style={styles.cameraRowLabel}>Camera</Text>
        <View style={styles.segmented}>
          {(['back', 'front'] as CameraFacing[]).map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.segment, facing === option && styles.segmentActive]}
              onPress={() => setFacing(option)}
            >
              <Text
                style={[styles.segmentText, facing === option && styles.segmentTextActive]}
              >
                {facingLabel(option)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {needsMoreSamples && (
        <Text style={styles.hintText}>
          Tip: accuracy needs roughly {RECOMMENDED_SAMPLES}+ samples per class, taken from
          varied angles and distances. Classes with only a handful of samples predict
          unreliably.
        </Text>
      )}

      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Classes</Text>
        <TouchableOpacity style={styles.addButton} onPress={handleAddClass}>
          <Text style={styles.addButtonText}>+ Add Class</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {classes.map((item) => (
          <View key={item.id} style={[styles.classCard, item.disabled && styles.disabledCard]}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleWrap}>
                <Text style={styles.classTitle}>{item.name}</Text>
                <Text style={styles.classSubtitle}>
                  {item.isDefault ? 'Default class' : 'Custom class'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.menuButton}
                onPress={() => setActiveMenuId(activeMenuId === item.id ? null : item.id)}
              >
                <Text style={styles.menuIcon}>⋯</Text>
              </TouchableOpacity>
            </View>

            {activeMenuId === item.id && (
              <View style={styles.menuPanel}>
                {!item.isDefault && (
                  <>
                    <TouchableOpacity onPress={() => handleDeleteClass(item.id)}>
                      <Text style={styles.menuItem}>Delete Class</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleToggleDisable(item.id)}>
                      <Text style={styles.menuItem}>
                        {item.disabled ? 'Enable Class' : 'Disable Class'}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity onPress={() => confirmRemoveAllImages(item.id)}>
                  <Text style={styles.menuItem}>Remove All Samples</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleAction('Samples downloaded.')}>
                  <Text style={styles.menuItem}>Download Samples</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleAction('Samples saved to Drive.')}>
                  <Text style={styles.menuItem}>Save Samples to Drive</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.sampleCounter}>
              {savedImages[item.id]?.length > 0
                ? `${savedImages[item.id].length} saved image${
                    savedImages[item.id].length > 1 ? 's' : ''
                  }`
                : 'No saved images yet'}
            </Text>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  item.disabled && styles.disabledActionButton,
                  styles.recordButton,
                ]}
                onPress={() =>
                  !item.disabled && setCaptureTarget({ id: item.id, name: item.name })
                }
                disabled={item.disabled}
              >
                <Text style={styles.actionButtonText}>Capture Samples</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, styles.viewButton]}
                onPress={() =>
                  navigation.navigate('ViewImages', {
                    className: item.name,
                    samples: savedImages[item.id] ?? [],
                  })
                }
              >
                <Text style={styles.actionButtonText}>View Images</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      <ImageCaptureModal
        visible={captureTarget !== null}
        className={captureTarget?.name ?? ''}
        facing={facing}
        onChangeFacing={setFacing}
        onBatch={handleCapturedBatch}
        onClose={() => setCaptureTarget(null)}
      />

      {/* Global model actions */}
      <View style={styles.globalActions}>
        <TouchableOpacity
          style={[styles.globalButton, { backgroundColor: '#059669' }]}
          onPress={handleTrainModel}
        >
          <Text style={styles.globalButtonText}>Train Model</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.globalButton,
            { backgroundColor: '#2563eb' },
            !hasTrained && styles.globalButtonDisabled,
          ]}
          onPress={handleTestModel}
          disabled={!hasTrained}
        >
          <Text style={styles.globalButtonText}>
            {hasTrained ? 'Test Your Model' : 'Train First'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 24,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backButtonText: {
    color: '#2563EB',
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#64748B',
    marginBottom: 16,
    lineHeight: 21,
  },
  statusBox: {
    backgroundColor: '#E0F2FE',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  statusText: {
    color: '#075985',
    fontSize: 13,
    fontWeight: '600',
  },
  statusBoxError: {
    backgroundColor: '#FEE2E2',
  },
  statusTextError: {
    color: '#991B1B',
  },
  cameraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cameraRowLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    padding: 3,
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  segmentActive: {
    backgroundColor: '#FFFFFF',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentTextActive: {
    color: '#0F172A',
  },
  hintText: {
    fontSize: 12,
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    lineHeight: 17,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  addButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  list: {
    paddingBottom: 16,
    gap: 12,
  },
  classCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  disabledCard: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardTitleWrap: {
    flex: 1,
  },
  classTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  classSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  menuButton: {
    padding: 4,
  },
  menuIcon: {
    fontSize: 22,
    color: '#334155',
    fontWeight: '700',
  },
  menuPanel: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  menuItem: {
    color: '#334155',
    fontSize: 14,
    paddingVertical: 6,
    fontWeight: '600',
  },
  sampleCounter: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 8,
    marginBottom: 6,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginTop: 8,
  },
  actionButton: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  disabledActionButton: {
    opacity: 0.6,
  },
  recordButton: {
    flex: 1,
    marginRight: 8,
  },
  viewButton: {
    flex: 1,
    backgroundColor: '#2563EB',
  },
  globalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  globalButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  globalButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  globalButtonDisabled: {
    opacity: 0.5,
  },
});
