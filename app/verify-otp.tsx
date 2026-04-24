import { Link, type Href, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import HapticPressable from '@/components/HapticPressable';

const Pressable = HapticPressable;

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{ contact?: string }>();
  const { verifySignupOtp } = useAuth();

  const [contactNumber, setContactNumber] = useState(params.contact ?? '');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);

  const onVerify = async () => {
    if (!contactNumber.trim() || !otp.trim()) {
      Alert.alert('Missing fields', 'Please enter mobile number and OTP.');
      return;
    }

    setLoading(true);
    try {
      await verifySignupOtp(contactNumber, otp);
      Alert.alert('Account created', 'Signup complete. You are now logged in.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OTP verification failed';
      Alert.alert('Verification failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify OTP</Text>
      <Text style={styles.subtitle}>Enter the code sent to your mobile number.</Text>

      <TextInput
        value={contactNumber}
        onChangeText={setContactNumber}
        keyboardType="phone-pad"
        placeholder="Mobile number"
        style={styles.input}
      />
      <TextInput
        value={otp}
        onChangeText={setOtp}
        keyboardType="number-pad"
        placeholder="6-digit OTP"
        style={styles.input}
      />

      <Pressable style={[styles.button, loading && styles.disabled]} onPress={onVerify} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify & Create Account</Text>}
      </Pressable>

      <Text style={styles.footerText}>
        Need another OTP? <Link href={'/signup' as Href} style={styles.link}>Back to signup</Link>
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
    backgroundColor: '#7c3aed',
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
