import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { HomeStackParamList } from '../navigation/types';

type ViewSamplesRouteProp = NativeStackScreenProps<HomeStackParamList, 'ViewSamples'>;

export default function ViewSamplesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const route = useRoute<ViewSamplesRouteProp['route']>();
  const { className, samples } = route.params;

  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(samples[0]?.id ?? null);

  const selectedSample = useMemo(
    () => samples.find((item) => item.id === selectedSampleId) ?? samples[0] ?? null,
    [samples, selectedSampleId],
  );

  const player = useAudioPlayer(selectedSample?.uri ?? null);
  const playerStatus = useAudioPlayerStatus(player);
  const isPlaying = playerStatus.playing;

  useEffect(() => {
    if (!selectedSample?.uri) {
      return;
    }

    player.replace(selectedSample.uri);
    player.seekTo(0);
  }, [selectedSample?.id, selectedSample?.uri]);

  const handlePlayPause = () => {
    if (!selectedSample) {
      return;
    }

    if (isPlaying) {
      player.pause();
      return;
    }

    player.seekTo(0);
    player.play();
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Samples for {className}</Text>
      <Text style={styles.subtitle}>
        Select a saved clip below and play it back from your device.
      </Text>

      {selectedSample ? (
        <View style={styles.playerCard}>
          <Text style={styles.playerTitle}>Preview</Text>
          <Text style={styles.playerMeta}>{selectedSample.createdAt}</Text>
          <TouchableOpacity style={styles.playButton} onPress={handlePlayPause}>
            <Text style={styles.playButtonText}>{isPlaying ? 'Pause Sample' : 'Play Sample'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateTitle}>No samples saved yet</Text>
          <Text style={styles.emptyStateText}>Record a new sample from the training screen first.</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {samples.length === 0 ? (
          <Text style={styles.emptyListText}>This class has no saved samples.</Text>
        ) : (
          samples.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.sampleItem, selectedSample?.id === item.id && styles.selectedSampleItem]}
              onPress={() => setSelectedSampleId(item.id)}
            >
              <Text style={styles.sampleTitle}>{item.createdAt}</Text>
              <Text style={styles.sampleSubtitle}>{item.uri.split('/').pop() ?? 'audio sample'}</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
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
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 16,
    lineHeight: 20,
  },
  playerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  playerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  playerMeta: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12,
  },
  playButton: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  playButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  emptyState: {
    backgroundColor: '#E0F2FE',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#075985',
  },
  emptyStateText: {
    fontSize: 13,
    color: '#0369A1',
    marginTop: 4,
  },
  list: {
    paddingBottom: 16,
    gap: 10,
  },
  sampleItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  selectedSampleItem: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  sampleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  sampleSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  emptyListText: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
});
