import { Link, type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import HapticPressable from '@/components/HapticPressable';

const Pressable = HapticPressable;

export default function SignupScreen() {
  const router = useRouter();
  const { requestSignupOtp, verifySignupOtp, completeSignup } = useAuth();
  const [otpCode, setOtpCode] = useState('');
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [otpVerified, setOtpVerified] = useState(false);
  const [name, setName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const normalizeContact = (value: string): string => value.replace(/\D/g, '');

  const isValidPhMobile = (value: string): boolean => {
    const digits = normalizeContact(value);
    return /^09\d{9}$/.test(digits) || /^639\d{9}$/.test(digits);
  };

  const onSendOtp = async () => {
    if (!contactNumber.trim()) {
      Alert.alert('Missing fields', 'Please enter your mobile number.');
      return;
    }

    if (!isValidPhMobile(contactNumber)) {
      Alert.alert('Invalid mobile number', 'Use a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).');
      return;
    }

    setSendingOtp(true);
    try {
      await requestSignupOtp(contactNumber);

      Alert.alert('OTP Sent', 'A verification code was sent to your mobile number.');
      setOtpVerified(false);
      setOtpToken(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send OTP';
      if (msg.toLowerCase().includes('existing account') || msg.toLowerCase().includes('log in instead')) {
        Alert.alert('Account Already Exists', msg, [
          { text: 'No', style: 'cancel' },
          {
            text: 'Yes, Log In',
            onPress: () => {
              const contact = contactNumber.replace(/\D/g, '');
              router.replace((`/login?contact=${contact}` as Href));
            },
          },
        ]);
      } else {
        Alert.alert('Signup failed', msg);
      }
    } finally {
      setSendingOtp(false);
    }
  };

  const onVerifyOtp = async () => {
    if (!contactNumber.trim() || !otpCode.trim()) {
      Alert.alert('Missing fields', 'Please enter mobile number and OTP code.');
      return;
    }

    if (!isValidPhMobile(contactNumber)) {
      Alert.alert('Invalid mobile number', 'Use a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).');
      return;
    }

    if (!/^\d{6}$/.test(otpCode.trim())) {
      Alert.alert('Invalid OTP', 'OTP code must be 6 digits.');
      return;
    }

    setVerifyingOtp(true);
    try {
      const token = await verifySignupOtp(contactNumber, otpCode);
      setOtpToken(token);
      setOtpVerified(true);
      Alert.alert('OTP Verified', 'OTP matched. You can now enter your full name and password.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OTP verification failed';
      Alert.alert('Verification failed', msg);
    } finally {
      setVerifyingOtp(false);
    }
  };

  const onCompleteSignup = async () => {
    if (!otpVerified || !otpToken) {
      Alert.alert('Verify OTP first', 'Please verify your OTP before creating your account.');
      return;
    }

    if (!name.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Full name and password are required.');
      return;
    }

    if (password.trim().length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await completeSignup({
        otpToken,
        name,
        contactNumber,
        email,
        password,
      });
      Alert.alert('Account created', 'Signup complete. You are now logged in.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to complete signup';
      Alert.alert('Signup failed', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>
      <Text style={styles.subtitle}>Enter your mobile number, send OTP, verify it, then continue with account details.</Text>

      <View style={styles.otpRow}>
        <TextInput
          value={contactNumber}
          onChangeText={setContactNumber}
          keyboardType="phone-pad"
          placeholder="Mobile number (09XXXXXXXXX)"
          style={[styles.input, styles.otpMobileInput]}
          editable={!otpVerified}
        />
        <Pressable
          style={[styles.sendOtpButton, sendingOtp && styles.disabled]}
          onPress={onSendOtp}
          disabled={sendingOtp || otpVerified}
        >
          {sendingOtp ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendOtpText}>✈</Text>}
        </Pressable>
      </View>

      <View style={styles.otpRow}>
        <TextInput
          value={otpCode}
          onChangeText={setOtpCode}
          keyboardType="number-pad"
          placeholder="OTP Code"
          style={[styles.input, styles.otpCodeInput]}
          editable={!otpVerified}
        />
        <Pressable
          style={[styles.verifyOtpButton, verifyingOtp && styles.disabled, otpVerified && styles.verifiedBtn]}
          onPress={onVerifyOtp}
          disabled={verifyingOtp || otpVerified}
        >
          {verifyingOtp ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{otpVerified ? 'Verified' : 'Verify'}</Text>}
        </Pressable>
      </View>

      <TextInput value={name} onChangeText={setName} placeholder="Full name" style={styles.input} editable={otpVerified} />
      <TextInput
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholder="Email (optional)"
        style={styles.input}
        editable={otpVerified}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
        style={styles.input}
        editable={otpVerified}
      />

      <Pressable style={[styles.button, submitting && styles.disabled]} onPress={onCompleteSignup} disabled={submitting || !otpVerified}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create Account</Text>}
      </Pressable>

      <Text style={styles.footerText}>
        Already have an account? <Link href={'/login' as Href} style={styles.link}>Log in</Link>
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
  otpRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  otpMobileInput: {
    flex: 1,
  },
  otpCodeInput: {
    flex: 1,
  },
  sendOtpButton: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f766e',
  },
  sendOtpText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginTop: -1,
  },
  verifyOtpButton: {
    minWidth: 92,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 12,
  },
  verifiedBtn: {
    backgroundColor: '#15803d',
  },
  button: {
    marginTop: 6,
    backgroundColor: '#0f766e',
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
