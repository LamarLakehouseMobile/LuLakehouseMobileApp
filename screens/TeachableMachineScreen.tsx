import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import SideNavbar from '../components/SideNavbar';
import { useNavigation } from '@react-navigation/native';
import { HomeStackParamList } from '../navigation/types';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useML } from '../context/MLContext';

export default function TeachableMachineScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  // Only use what MLContext actually exposes
  const { sendToWebView, lastPrediction } = useML();

  return (
    <View style={styles.content}>
      <SideNavbar />
      <Text style={styles.title}>Teachable Machine</Text>
      <Text style={styles.subtitle}>Choose an action below to continue with your project.</Text>

      <View style={styles.buttonsContainer}>
        <TouchableOpacity style={styles.cardButton} onPress={() => {}}>
          <Text style={styles.cardTitle}>Documentation</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPressIn={() => navigation.navigate('ProjectType')}
          style={styles.cardButton}
        >
          <Text style={styles.cardTitle}>Train a model</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    position: 'relative',
    padding: 20,
    backgroundColor: '#F8FAFC',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 100,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748B',
    marginBottom: 28,
    lineHeight: 22,
    maxWidth: 360,
  },
  buttonsContainer: {
    width: '100%',
    alignItems: 'center',
    gap: 16,
  },
  cardButton: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
});
