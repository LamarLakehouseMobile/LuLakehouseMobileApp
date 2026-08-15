import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import SideNavbar from '../components/SideNavbar';
import { supabase } from '../lib/supabase';

export default function ProfileScreen() {
  const { user } = useAuth();
  const [requesting, setRequesting] = useState(false);

  const handlePasswordResetRequest = async () => {
    const email = user?.email;
    if (!email) {
      Alert.alert('No email on file', 'We could not find your account email.');
      return;
    }

    setRequesting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'lakehouse://auth',
      });

      if (error) throw error;

      Alert.alert(
        'Reset email sent',
        'If an account exists for this email, we sent a secure password reset link there.'
      );
    } catch (error) {
      Alert.alert(
        'Unable to send reset email',
        error instanceof Error ? error.message : 'Please try again in a moment.'
      );
    } finally {
      setRequesting(false);
    }
  };

  return (
    <View style={styles.container}>
      <SideNavbar />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Account</Text>
          <Text style={styles.value}>{user?.email || 'No email available'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>Active learner</Text>
        </View>

        <TouchableOpacity
          style={[styles.resetButton, requesting && styles.resetButtonDisabled]}
          disabled={requesting}
          onPress={handlePasswordResetRequest}
        >
          <Text style={styles.resetButtonText}>
            {requesting ? 'Sending reset email...' : 'Request password reset email'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 100,
    paddingBottom: 36,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  value: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F172A',
  },
  resetButton: {
    backgroundColor: '#2563EB',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  resetButtonDisabled: {
    opacity: 0.6,
  },
  resetButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
