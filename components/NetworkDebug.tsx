import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import {
  getNetworkDiagnostics,
  getResolvedApiBase,
  requestApi,
  setPersistedApiBase,
} from '@/constants/api';
import {
  readReliabilityMetrics,
  resetReliabilityMetrics,
  type ReliabilityMetrics,
} from '@/constants/reliabilityMetrics';

type HealthState = {
  status: 'idle' | 'checking' | 'ok' | 'error';
  message: string;
};

type CandidateDetail = {
  base: string;
  sources: string[];
};

type DiagnosticsData = {
  expo_host_uri?: string;
  persisted_override?: string | null;
  all_candidates: string[];
  candidate_details?: CandidateDetail[];
};

const toPercent = (value: number): string => `${Math.round(value)}%`;

const getHealthScore = (metrics: ReliabilityMetrics | null): number => {
  if (!metrics) return 100;

  const scanAttempts = Math.max(0, metrics.scansAttempted);
  const uploadAttempts = Math.max(0, metrics.uploadsAttempted);
  const totalAttempts = scanAttempts + uploadAttempts;
  if (totalAttempts === 0) return 100;

  const scanFailures = Math.max(0, metrics.scansFailed);
  const uploadFailures = Math.max(0, metrics.uploadsFailed);
  const totalFailures = scanFailures + uploadFailures;

  const rawScore = ((totalAttempts - totalFailures) / totalAttempts) * 100;
  return Math.max(0, Math.min(100, rawScore));
};

const getHealthLabel = (score: number): string => {
  if (score >= 95) return 'Excellent';
  if (score >= 85) return 'Good';
  if (score >= 70) return 'Fair';
  return 'Needs attention';
};

export default function NetworkDebug() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [apiBase, setApiBase] = useState<string>('');
  const [customBase, setCustomBase] = useState('');
  const [health, setHealth] = useState<HealthState>({ status: 'idle', message: '' });
  const [metrics, setMetrics] = useState<ReliabilityMetrics | null>(null);
  const healthScore = getHealthScore(metrics);
  const healthLabel = getHealthLabel(healthScore);

  useEffect(() => {
    const load = async () => {
      const diag = getNetworkDiagnostics();
      setDiagnostics(diag);
      const resolved = getResolvedApiBase();
      setApiBase(resolved);
      const latestMetrics = await readReliabilityMetrics();
      setMetrics(latestMetrics);
    };

    void load();
  }, []);

  const refreshMetrics = async () => {
    const latestMetrics = await readReliabilityMetrics();
    setMetrics(latestMetrics);
  };

  const handleResetMetrics = async () => {
    await resetReliabilityMetrics();
    await refreshMetrics();
    Alert.alert('Reset complete', 'Reliability counters were cleared.');
  };

  const handleSetCustomBase = async () => {
    if (customBase.trim()) {
      await setPersistedApiBase(customBase.trim());
      setApiBase(customBase.trim());
      setCustomBase('');
      // Reload diagnostics
      const diag = getNetworkDiagnostics();
      setDiagnostics(diag);
      Alert.alert('Saved', `API base set to ${customBase.trim()}`);
    }
  };

  const handleClearOverride = async () => {
    await setPersistedApiBase(null);
    setCustomBase('');
    const diag = getNetworkDiagnostics();
    setDiagnostics(diag);
    const resolved = getResolvedApiBase();
    setApiBase(resolved);
    Alert.alert('Cleared', 'API base override cleared.');
  };

  const handleTestConnection = async () => {
    setHealth({ status: 'checking', message: 'Checking backend connection...' });
    try {
      const response = await requestApi('/api/library/sync', {}, { timeoutMs: 2500 });
      if (response.ok) {
        setHealth({ status: 'ok', message: `Connected successfully (HTTP ${response.status}).` });
      } else {
        setHealth({
          status: 'error',
          message: `Backend reached but returned HTTP ${response.status}.`,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not connect to backend. Check WiFi and API base.';
      setHealth({ status: 'error', message });
    }
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
        <Text style={styles.label}>All Candidate Hosts:</Text>
        {(diagnostics.candidate_details ?? []).length > 0
          ? diagnostics.candidate_details?.map((entry, i) => (
              <View key={`${entry.base}-${i}`} style={styles.candidateRow}>
                <Text style={styles.candidate}>{i + 1}. {entry.base}</Text>
                <Text style={styles.candidateSource}>Source: {entry.sources.join(', ')}</Text>
              </View>
            ))
          : diagnostics.all_candidates.map((host, i) => (
              <Text key={i} style={styles.candidate}>
                {i + 1}. {host}
              </Text>
            ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Set Custom API Base (override):</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={customBase}
            onChangeText={setCustomBase}
            placeholder="https://muscan-admin-api.onrender.com"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.actionsRow}>
          <Pressable style={[styles.actionBtn, styles.saveBtn]} onPress={() => void handleSetCustomBase()}>
            <Text style={styles.actionText}>Save Override</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, styles.clearBtn]} onPress={() => void handleClearOverride()}>
            <Text style={styles.actionText}>Clear</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          If auto-detection fails, manually enter your backend URL (e.g., https://muscan-admin-api.onrender.com).
          The app now prefers the Render host as its permanent API base.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Backend Health Check:</Text>
        <Pressable style={[styles.actionBtn, styles.testBtn]} onPress={() => void handleTestConnection()}>
          <Text style={styles.actionText}>Test Connection</Text>
        </Pressable>
        {health.status !== 'idle' && (
          <Text
            style={[
              styles.healthStatus,
              health.status === 'ok' ? styles.healthOk : health.status === 'error' ? styles.healthError : null,
            ]}
          >
            {health.message}
          </Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Overall Health Score:</Text>
        <View style={styles.scoreCard}>
          <Text style={styles.scoreValue}>{toPercent(healthScore)}</Text>
          <Text style={styles.scoreLabel}>{healthLabel}</Text>
          <Text style={styles.metricSubtext}>
            Based on recent scan and upload success rates.
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Reliability Counters:</Text>
        {metrics ? (
          <>
            <Text style={styles.metricText}>Scans attempted: {metrics.scansAttempted}</Text>
            <Text style={styles.metricText}>Scans succeeded: {metrics.scansSucceeded}</Text>
            <Text style={styles.metricText}>Scans failed: {metrics.scansFailed}</Text>
            <Text style={styles.metricText}>Gatekeeper rejected: {metrics.gatekeeperRejected}</Text>
            <Text style={styles.metricText}>Uploads attempted: {metrics.uploadsAttempted}</Text>
            <Text style={styles.metricText}>Uploads succeeded: {metrics.uploadsSucceeded}</Text>
            <Text style={styles.metricText}>Uploads failed: {metrics.uploadsFailed}</Text>
            <Text style={styles.metricText}>Upload retries: {metrics.uploadRetries}</Text>
            <Text style={styles.metricSubtext}>Last updated: {new Date(metrics.lastUpdated).toLocaleString()}</Text>
          </>
        ) : (
          <Text style={styles.metricSubtext}>Loading metrics...</Text>
        )}
        <View style={styles.actionsRow}>
          <Pressable style={[styles.actionBtn, styles.testBtn]} onPress={() => void refreshMetrics()}>
            <Text style={styles.actionText}>Refresh Metrics</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, styles.clearBtn]} onPress={() => void handleResetMetrics()}>
            <Text style={styles.actionText}>Reset Metrics</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.hint}>
          {'\n'}
          📡 Troubleshooting:
          {'\n'}• For the permanent backend, use the Render URL: https://muscan-admin-api.onrender.com
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
  candidateRow: {
    marginBottom: 8,
  },
  candidateSource: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 2,
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
    color: '#0f172a',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveBtn: {
    backgroundColor: '#0f766e',
  },
  clearBtn: {
    backgroundColor: '#64748b',
  },
  testBtn: {
    backgroundColor: '#1d4ed8',
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  healthStatus: {
    marginTop: 10,
    fontSize: 12,
    color: '#334155',
  },
  healthOk: {
    color: '#166534',
  },
  healthError: {
    color: '#b91c1c',
  },
  scoreCard: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  scoreValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  scoreLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    marginTop: 2,
  },
  metricText: {
    fontSize: 12,
    color: '#334155',
    marginBottom: 2,
  },
  metricSubtext: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 8,
  },
  hint: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
    marginTop: 8,
  },
});
