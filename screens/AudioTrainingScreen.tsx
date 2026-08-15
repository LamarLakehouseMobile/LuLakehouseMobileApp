import { useML } from '../context/MLContext';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import SideNavbar from '../components/SideNavbar';
import { HomeStackParamList, RecordedSample } from '../navigation/types';
import { savePersistedModel } from '../ml/storage';
import { AUDIO_CLIP_MS } from '../ml/capture';


type AudioClass = {
  id: string;
  name: string;
  isDefault: boolean;
  disabled: boolean;
};

const recordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: 'document' as const,
};

export default function AudioTrainingScreen() {
  const { sendToWebView, engineStatus, engineError } = useML();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const [classes, setClasses] = useState<AudioClass[]>([
    { id: 'default', name: 'Default Class', isDefault: true, disabled: false },
  ]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Ready to collect audio samples.');
  const [recordingSamples, setRecordingSamples] = useState<Record<string, RecordedSample[]>>({});
  const [recordingClassId, setRecordingClassId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [hasTrained, setHasTrained] = useState(false);

  const audioRecorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(audioRecorder);

  /**
   * Whether the recorder is already armed. prepareToRecordAsync is a real
   * per-sample cost, so it is paid ahead of time and re-paid off the critical
   * path after each clip rather than while the user waits.
   */
  const preparedRef = useRef(false);
  /** Guards against overlapping clips from rapid taps. */
  const busyRef = useRef(false);

  const prewarm = async () => {
    if (preparedRef.current) return;
    try {
      await audioRecorder.prepareToRecordAsync();
      preparedRef.current = true;
    } catch (error) {
      preparedRef.current = false;
      console.warn('Could not pre-arm the recorder', error);
    }
  };

  useEffect(() => {
    const configureAudio = async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
        });

        // Ask up front so the first tap is not held up by a permission dialog.
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (permission.granted) await prewarm();
      } catch (error) {
        console.warn('Unable to configure audio session', error);
      }
    };

    configureAudio();
  }, []);

  const handleAddClass = () => {
    const customCount = classes.filter((item) => !item.isDefault).length + 1;
    const newClass: AudioClass = {
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
    setRecordingSamples((current) => {
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

  const handleRenameClass = (classId: string, currentName: string) => {
    setRenameTarget({ id: classId, name: currentName });
    setRenameDraft(currentName);
    setActiveMenuId(null);
  };

  const confirmRenameClass = async () => {
    if (!renameTarget) return;

    const nextName = renameDraft.trim() || renameTarget.name;

    const ack = await sendToWebView({
      type: 'renameClass',
      classId: renameTarget.id,
      className: nextName,
    });

    if (!ack.ok) {
      setStatusMessage(`Rename failed: ${ack.error}`);
      setRenameTarget(null);
      setRenameDraft('');
      return;
    }

    setClasses((current) =>
      current.map((item) => (item.id === renameTarget.id ? { ...item, name: nextName } : item)),
    );

    setStatusMessage(`Renamed class to ${nextName}.`);
    setRenameTarget(null);
    setRenameDraft('');
  };

  const confirmRemoveAll = (classId: string) => {
    Alert.alert(
      'Remove all samples',
      'Are you sure you want to remove all saved samples for this class? This cannot be undone in the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeAllSamples(classId) },
      ],
    );
  };

  const removeAllSamples = (classId: string) => {
    setRecordingSamples((current) => ({ ...current, [classId]: [] }));
    setActiveMenuId(null);
    setStatusMessage('Removed all samples for this class.');
  };

  /**
   * Records exactly one fixed-length clip and auto-stops.
   *
   * Previously this was a manual start/stop toggle, so every sample cost two
   * taps plus a prepareToRecordAsync. Now one tap yields one clip of a known
   * length, which also makes samples more comparable to each other: the engine
   * resamples every clip to the same spectrogram shape, so wildly varying
   * durations were being squashed by differing amounts.
   */
  const handleRecordSamples = async (classId: string, className: string) => {
    if (busyRef.current) {
      setStatusMessage('Still saving the last clip — try again in a moment.');
      return;
    }
    busyRef.current = true;
    setRecordingClassId(classId);

    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone access needed', 'Please allow microphone access to record training samples.');
        setStatusMessage('Microphone permission was not granted.');
        return;
      }

      await prewarm();
      audioRecorder.record();
      setStatusMessage(`Recording ${AUDIO_CLIP_MS / 1000}s for ${className}…`);

      await new Promise((resolve) => setTimeout(resolve, AUDIO_CLIP_MS));

      await audioRecorder.stop();
      // stop() consumes the armed session; the next clip needs a fresh one.
      preparedRef.current = false;

      const savedUri = audioRecorder.uri;
      if (!savedUri) {
        setStatusMessage(`Recording finished for ${className}, but no file was created.`);
        return;
      }

      const sample: RecordedSample = {
        id: `${Date.now()}`,
        uri: savedUri,
        createdAt: new Date().toLocaleTimeString(),
      };

      setRecordingSamples((current) => ({
        ...current,
        [classId]: [...(current[classId] ?? []), sample],
      }));

      // SDK 56: the legacy FileSystem.readAsStringAsync() helper now throws
      // by design. The File class is the supported way to read a file.
      const base64Audio = await new File(savedUri).base64();

      setStatusMessage(`Extracting features for ${className}…`);

      // The engine decodes the compressed clip with the WebView's AudioContext
      // and turns it into a fixed-length spectrogram. Sending the raw file bytes
      // as "features" (the original approach) could not work: they are
      // variable-length and compressed, and a KNN needs every example to share
      // one comparable feature space.
      const ack = await sendToWebView({
        type: 'addAudioSample',
        classId,
        className,
        base64: base64Audio,
      });

      if (!ack.ok) {
        setStatusMessage(`Could not add sample: ${ack.error}`);
        return;
      }

      const total = (recordingSamples[classId]?.length ?? 0) + 1;
      setStatusMessage(`Added sample to ${className} (${total} total).`);
      setHasTrained(false);
    } catch (error) {
      console.warn('Failed to record sample', error);
      setStatusMessage(
        `Unable to record: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setRecordingClassId(null);
      busyRef.current = false;
      // Re-arm for the next tap without blocking this one.
      void prewarm();
    }
  };

  const handleTrainModel = async () => {
    const totalSamples = Object.values(recordingSamples).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );

    if (totalSamples === 0) {
      setStatusMessage('Add at least one audio sample before training.');
      return;
    }

    // A KNN classifier learns incrementally as samples are added, so there is no
    // gradient step here. What this does do is ask the engine for the serialised
    // dataset and persist it, so the live screen still works after a restart.
    setStatusMessage('Finalising model…');
    const ack = await sendToWebView({ type: 'train', modality: 'audio' });

    if (!ack.ok) {
      setStatusMessage(`Training failed: ${ack.error}`);
      return;
    }

    try {
      await savePersistedModel('audio', ack.result?.model ?? null);
    } catch (error) {
      // The in-memory model is still usable this session; only persistence failed.
      console.warn('Failed to persist trained model', error);
    }

    setStatusMessage('Model ready. You can now test your model.');
    setHasTrained(true);
  };

  const handleTestModel = () => {
    if (!hasTrained) {
      setStatusMessage('Train the model first.');
      return;
    }
    navigation.navigate('LiveAudio');
  };

  return (
    <View style={styles.container}>
      <SideNavbar />

      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Audio Training</Text>
      <Text style={styles.subtitle}>
        Create and manage your audio classes, record samples, then train and test your model.
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

      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Classes</Text>
        <TouchableOpacity style={styles.addButton} onPress={handleAddClass}>
          <Text style={styles.addButtonText}>+ Add Class</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {classes.map((item) => {
          const savedSamples = recordingSamples[item.id] ?? [];
          // Busy covers the whole clip: recording, reading, and feature
          // extraction. The button is no longer a stop control, so it reflects
          // progress rather than offering a second action.
          const isCurrentRecordingClass = recordingClassId === item.id;
          const isRecordingNow = isCurrentRecordingClass && recorderState.isRecording;

          return (
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
                  <TouchableOpacity onPress={() => handleRenameClass(item.id, item.name)}>
                    <Text style={styles.menuItem}>Rename Class</Text>
                  </TouchableOpacity>

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

                  <TouchableOpacity onPress={() => confirmRemoveAll(item.id)}>
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
                {savedSamples.length > 0
                  ? `${savedSamples.length} saved sample${savedSamples.length > 1 ? 's' : ''}`
                  : 'No saved samples yet'}
              </Text>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    (item.disabled || isCurrentRecordingClass) && styles.disabledActionButton,
                    styles.recordButton,
                  ]}
                  onPress={() => !item.disabled && handleRecordSamples(item.id, item.name)}
                  disabled={item.disabled || isCurrentRecordingClass}
                >
                  <Text style={styles.actionButtonText}>
                    {isRecordingNow
                      ? 'Listening…'
                      : isCurrentRecordingClass
                        ? 'Saving…'
                        : `Record ${AUDIO_CLIP_MS / 1000}s Sample`}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.viewButton]}
                  onPress={() => navigation.navigate('ViewSamples', { className: item.name, samples: savedSamples })}
                >
                  <Text style={styles.actionButtonText}>View Samples</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

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

      <Modal visible={renameTarget !== null} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename class</Text>
            <Text style={styles.modalSubtitle}>Choose a new name for this class.</Text>
            <TextInput
              autoFocus
              value={renameDraft}
              onChangeText={setRenameDraft}
              placeholder="Class name"
              style={styles.modalInput}
              onSubmitEditing={confirmRenameClass}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setRenameTarget(null)} style={styles.modalCancelButton}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmRenameClass} style={styles.modalConfirmButton}>
                <Text style={styles.modalConfirmText}>Rename</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  modalSubtitle: {
    color: '#475569',
    fontSize: 14,
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  modalCancelText: {
    color: '#475569',
    fontWeight: '700',
  },
  modalConfirmButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontWeight: '700',
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
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    flex: 1,
  },
  // Equal halves now that Train/Predict have moved to the global action bar;
  // the old 1.4 weighting existed to fit four buttons in this row.
  recordButton: {
    flex: 1,
  },
  viewButton: {
    backgroundColor: '#2563EB',
    flex: 1,
  },
  disabledActionButton: {
    backgroundColor: '#94A3B8',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
