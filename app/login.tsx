import { Link, type Href, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import HapticPressable from '@/components/HapticPressable';

const Pressable = HapticPressable;

export default function LoginScreen() {
  const params = useLocalSearchParams<{ contact?: string }>();
  const { login } = useAuth();
  const [contactNumber, setContactNumber] = useState(params.contact ?? '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onLogin = async () => {
    if (!contactNumber.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please enter your mobile number and password.');
      return;
    }

    setLoading(true);
    try {
      await login(contactNumber, password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      Alert.alert('Login failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome Back</Text>
      <Text style={styles.subtitle}>Log in with your mobile number.</Text>

      <TextInput
        value={contactNumber}
        onChangeText={setContactNumber}
        keyboardType="phone-pad"
        placeholder="Mobile number"
        style={styles.input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
        style={styles.input}
      />

      <Pressable onPress={onLogin} style={[styles.button, loading && styles.disabled]} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log In</Text>}
      </Pressable>

      <Text style={styles.footerText}>
        New user? <Link href={'/signup' as Href} style={styles.link}>Create account</Link>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f8fafc',
    gap: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    color: '#475569',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  button: {
    marginTop: 6,
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  disabled: {
    opacity: 0.7,
  },
  footerText: {
    marginTop: 8,
    color: '#475569',
  },
  link: {
    color: '#1d4ed8',
    fontWeight: '700',
  },
});
