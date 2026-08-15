import React from 'react';
import SideNavbar from '../components/SideNavbar';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Camera, Mic } from 'lucide-react-native'; // optional icons
import { useNavigation } from '@react-navigation/native';
import { HomeStackParamList } from '../navigation/types';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

export default function ProjectTypeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  return (
    <View style={styles.container}>
      <SideNavbar />
      <Text style={styles.title}>Create a New Project</Text>

      <View style={styles.cardContainer}>
        
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('ImageTraining')}
        >
          <Camera size={40} color="#334155" />
          <Text style={styles.cardText}>Image Project</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('AudioTraining')}
        >
          <Mic size={40} color="#334155" />
          <Text style={styles.cardText}>Audio Project</Text>
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
    paddingTop: 60,
  },
  title: {
    fontSize: 26,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 30,
    textAlign: 'center',
  },
  cardContainer: {
    gap: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 30,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardText: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: '500',
    color: '#334155',
  },
});
