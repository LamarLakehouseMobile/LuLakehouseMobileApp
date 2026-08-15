import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import SideNavbar from '../components/SideNavbar';

export default function SettingsScreen() {
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [trainingReminders, setTrainingReminders] = useState(true);
  const [lowDataMode, setLowDataMode] = useState(false);

  return (
    <View style={styles.container}>
      <SideNavbar />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View>
              <Text style={styles.settingTitle}>Email alerts</Text>
              <Text style={styles.settingSubtitle}>Receive training and account updates</Text>
            </View>
            <Switch value={emailAlerts} onValueChange={setEmailAlerts} />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <View>
              <Text style={styles.settingTitle}>Training reminders</Text>
              <Text style={styles.settingSubtitle}>Prompt check-ins after model sessions</Text>
            </View>
            <Switch value={trainingReminders} onValueChange={setTrainingReminders} />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <View>
              <Text style={styles.settingTitle}>Low data mode</Text>
              <Text style={styles.settingSubtitle}>Reduce upload size during training</Text>
            </View>
            <Switch value={lowDataMode} onValueChange={setLowDataMode} />
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Workspace defaults</Text>
          <Text style={styles.infoText}>This app is currently configured for image and audio model training in a mobile-first workflow.</Text>
        </View>
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
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  settingTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  settingSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#64748B',
    maxWidth: 220,
  },
  infoCard: {
    marginTop: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1D4ED8',
    marginBottom: 6,
  },
  infoText: {
    color: '#1E3A8A',
    fontSize: 14,
    lineHeight: 20,
  },
});
