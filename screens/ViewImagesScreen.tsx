import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { HomeStackParamList } from '../navigation/types';

type ViewImagesRouteProp = NativeStackScreenProps<HomeStackParamList, 'ViewImages'>;

export default function ViewImagesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const route = useRoute<ViewImagesRouteProp['route']>();
  const { className, samples } = route.params;

  const [selectedImageId, setSelectedImageId] = useState<string | null>(samples[0]?.id ?? null);

  const selectedImage = useMemo(
    () => samples.find((item) => item.id === selectedImageId) ?? samples[0] ?? null,
    [samples, selectedImageId],
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Images for {className}</Text>
      <Text style={styles.subtitle}>Select a saved image below to preview.</Text>

      {selectedImage ? (
        <View style={styles.previewCard}>
          <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} resizeMode="contain" />
          <Text style={styles.previewMeta}>{selectedImage.createdAt}</Text>
          <Text style={styles.uriText}>{selectedImage.uri}</Text>
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateTitle}>No images saved yet</Text>
          <Text style={styles.emptyStateText}>Capture a new image from the training screen first.</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {samples.length === 0 ? (
          <Text style={styles.emptyListText}>This class has no saved images.</Text>
        ) : (
          samples.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.thumbItem, selectedImage?.id === item.id && styles.selectedThumbItem]}
              onPress={() => setSelectedImageId(item.id)}
            >
              <Image source={{ uri: item.uri }} style={styles.thumbImage} />
              <View style={styles.thumbInfo}>
                <Text style={styles.thumbTitle}>{item.createdAt}</Text>
                <Text style={styles.thumbSubtitle}>{item.uri.split('/').pop() ?? 'image'}</Text>
              </View>
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
  previewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: 8,
    marginBottom: 8,
  },
  previewMeta: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
  },
  uriText: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 6,
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
  thumbItem: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  selectedThumbItem: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  thumbImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
    marginRight: 10,
  },
  thumbInfo: {
    flex: 1,
  },
  thumbTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  thumbSubtitle: {
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
