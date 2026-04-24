import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { getNetworkDiagnostics, getResolvedApiBase, setPersistedApiBase } from '@/constants/api';

export default function NetworkDebug() {
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [apiBase, setApiBase] = useState<string>('');
  const [customBase, setCustomBase] = useState('');

  useEffect(() => {
    const diag = getNetworkDiagnostics();
    setDiagnostics(diag);
    const resolved = getResolvedApiBase();
    setApiBase(resolved);
  }, []);

  const handleSetCustomBase = async () => {
    if (customBase.trim()) {
      await setPersistedApiBase(customBase.trim());
      setApiBase(customBase.trim());
      setCustomBase('');
      // Reload diagnostics
      const diag = getNetworkDiagnostics();
      setDiagnostics(diag);
      alert('API base set to: ' + customBase.trim());
    }
  };

  const handleClearOverride = async () => {
    await setPersistedApiBase(null);
    setCustomBase('');
    const diag = getNetworkDiagnostics();
    setDiagnostics(diag);
    const resolved = getResolvedApiBase();
    setApiBase(resolved);
    alert('API base override cleared');
  };

  if (!diagnostics) {
    return <ActivityIndicator size="large" color="#0f766e" />;
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Network Diagnostics</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Current API Base:</Text>
        <Text style={styles.value}>{apiBase}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Expo Host URI:</Text>
        <Text style={styles.value}>{diagnostics.expo_host_uri || '(none)'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Derived LAN Base:</Text>
        <Text style={styles.value}>{diagnostics.derived_lan_base || '(not derived)'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>All Candidate Hosts:</Text>
        {diagnostics.all_candidates.map((host: string, i: number) => (
          <Text key={i} style={styles.candidate}>
            {i + 1}. {host}
          </Text>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Set Custom API Base (override):</Text>
        <View style={styles.inputRow}>
          <Pressable
            style={styles.input}
            onPress={() => {
              /* text input would go here; for now using TextInput in real app */
            }}
          >
            <Text style={styles.inputText}>http://192.168.x.x:8001</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          If auto-detection fails, manually enter your backend IP:port (e.g., http://192.168.1.2:8001).
          Check your machine's local network IP and ensure it's on the same WiFi as your phone.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.hint}>
          {'\n'}
          📡 Troubleshooting:
          {'\n'}• Phone and backend must be on same WiFi network
          {'\n'}• Check if backend is running: python -m uvicorn app:app --port 8001
          {'\n'}• Check backend logs for incoming requests
          {'\n'}• If still failing, set custom API base above
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f8fafc',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 16,
    color: '#0f172a',
  },
  section: {
    marginBottom: 24,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderColor: '#e2e8f0',
    borderWidth: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  value: {
    fontSize: 14,
    color: '#0f172a',
    fontFamily: 'Courier New',
    backgroundColor: '#f1f5f9',
    padding: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  candidate: {
    fontSize: 12,
    color: '#475569',
    fontFamily: 'Courier New',
    marginBottom: 4,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    padding: 10,
    backgroundColor: '#fff',
  },
  inputText: {
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: 'Courier New',
  },
  hint: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
    marginTop: 8,
  },
});
