import React from 'react';
import { Alert, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import Button from '../components/Button';
import SideNavbar from '../components/SideNavbar';
import type { HomeStackParamList } from '../navigation/types';   // <-- add this
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';


const styles = StyleSheet.create({
  content: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 20,
    backgroundColor: '#F8FAFC',
  },
  headerSection: {
    width: '100%',
    marginTop: 80,
    marginBottom: 24,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'left',
  },
  subtitle: {
    fontSize: 15,
    color: '#64748B',
    lineHeight: 22,
    maxWidth: 360,
  },
  dashboard: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 28,
  },
  card: {
    flexBasis: '48%',
    minWidth: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  logoutButton: {
    width: '100%',
    maxWidth: 320,
  },
});

export default function HomeScreen() {
  const { logout, user } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  return (
    <View style={styles.content}>
      <SideNavbar />

      <View style={styles.headerSection}>
        <Text style={styles.welcomeText}>
          Welcome back, {user?.email || 'User'}!
        </Text>
        <Text style={styles.subtitle}>
          This dashboard is the first step toward a mobile interface that can connect to the Teachable Machine API.
        </Text>
      </View>

      <View style={styles.dashboard}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Lamar Lakehouse</Text>
        </View>

        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('TeachableMachine')}
        >
          <Text style={styles.cardTitle}>Teachable Machine</Text>
        </TouchableOpacity>
      </View>

      <Button title="Logout" onPress={logout} style={styles.logoutButton} />
    </View>
  );
}
