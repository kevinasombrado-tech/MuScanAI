import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { ActivityIndicator, View } from 'react-native';

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { FarmsProvider } from '@/context/FarmsContext';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootNavigator() {
  const colorScheme = useColorScheme();
  const { initializing, isAuthenticated } = useAuth();
  const segments = useSegments();

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  const current = segments[0] ?? '';
  const inAuthFlow = current === 'login' || current === 'signup' || current === 'verify-otp';

  if (!isAuthenticated && !inAuthFlow) {
    return <Redirect href="/login" />;
  }
  if (isAuthenticated && inAuthFlow) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'Log In', headerShown: false }} />
        <Stack.Screen name="signup" options={{ title: 'Sign Up', headerShown: false }} />
        <Stack.Screen name="verify-otp" options={{ title: 'Verify OTP', headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <FarmsProvider>
        <RootNavigator />
      </FarmsProvider>
    </AuthProvider>
  );
}
