import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { API_BASE_CANDIDATES, requestApi } from '@/constants/api';

type User = {
  id: number;
  name: string;
  contact_number: string;
  email: string | null;
  profile_image?: string | null;
  role: 'Farmer' | 'Researcher' | 'Admin' | 'Superadmin';
  source: 'signup' | 'manual';
};

type SignupCompleteData = {
  otpToken: string;
  name: string;
  contactNumber: string;
  email?: string;
  password: string;
};

type AuthContextValue = {
  initializing: boolean;
  isAuthenticated: boolean;
  token: string | null;
  user: User | null;
  requestSignupOtp: (contactNumber: string) => Promise<void>;
  verifySignupOtp: (contactNumber: string, otp: string) => Promise<string>;
  completeSignup: (data: SignupCompleteData) => Promise<void>;
  login: (contactNumber: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateLocalUser: (nextUser: User) => Promise<void>;
};

type StoredAuth = {
  token: string;
  user: User;
};

const AUTH_STORAGE_KEY = 'muscan.auth.session';
const AuthContext = createContext<AuthContextValue | null>(null);

const readErrorMessage = async (res: Response): Promise<string> => {
  try {
    const raw = (await res.json()) as { detail?: unknown; message?: unknown };

    if (typeof raw.detail === 'string' && raw.detail.trim()) {
      return raw.detail;
    }
    if (Array.isArray(raw.detail) && raw.detail.length > 0) {
      const first = raw.detail[0] as { msg?: unknown };
      if (typeof first?.msg === 'string' && first.msg.trim()) {
        return first.msg;
      }
      return 'Request failed';
    }
    if (typeof raw.message === 'string' && raw.message.trim()) {
      return raw.message;
    }

    return `Request failed (${res.status})`;
  } catch {
    try {
      const text = (await res.text()).trim();
      if (text) return text;
    } catch {
      // Ignore parse failures.
    }
    return `Request failed (${res.status})`;
  }
};

const normalizeDigits = (value: string): string => value.replace(/\D/g, '');

const requestWithFallback = async (
  path: string,
  init: RequestInit,
  options: { timeoutMs?: number } = {}
): Promise<Response> => {
  return requestApi(path, init, { timeoutMs: options.timeoutMs ?? 4500 });
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) {
          setInitializing(false);
          return;
        }

        const stored = JSON.parse(raw) as StoredAuth;
        const res = await requestWithFallback('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: stored.token }),
        });

        if (!res.ok) {
          await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
          setInitializing(false);
          return;
        }

        const data = (await res.json()) as { valid: boolean; user: User };
        setToken(stored.token);
        setUser(data.user);
      } catch {
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      } finally {
        setInitializing(false);
      }
    };

    void bootstrap();
  }, []);

  const persistAuth = async (nextToken: string, nextUser: User) => {
    const payload: StoredAuth = { token: nextToken, user: nextUser };
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
    setToken(nextToken);
    setUser(nextUser);
  };

  const requestSignupOtp = async (contactNumber: string): Promise<void> => {
    const contact = normalizeDigits(contactNumber);
    const payload = {
      contact_number: contact,
    };

    const res = await requestWithFallback(
      '/api/auth/signup/request-otp-mobile',
      {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      },
      { timeoutMs: 60000 }
    );

    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }

    await res.json();
  };

  const verifySignupOtp = async (contactNumber: string, otp: string): Promise<string> => {
    const contact = normalizeDigits(contactNumber);
    const res = await requestWithFallback(
      '/api/auth/signup/verify-otp-mobile',
      {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_number: contact, otp: otp.trim() }),
      },
      { timeoutMs: 30000 }
    );

    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }

    const data = (await res.json()) as { otp_token?: string };
    if (!data.otp_token) {
      throw new Error('OTP verification failed. Please request a new code.');
    }
    return data.otp_token;
  };

  const completeSignup = async (data: SignupCompleteData): Promise<void> => {
    const contact = normalizeDigits(data.contactNumber);
    const payload = {
      otp_token: data.otpToken,
      name: data.name.trim(),
      password: data.password,
      email: data.email?.trim() ? data.email.trim().toLowerCase() : null,
      role: 'Farmer' as const,
    };

    if (!contact) {
      throw new Error('Invalid mobile number.');
    }

    const res = await requestWithFallback('/api/auth/signup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }

    const result = (await res.json()) as { token: string; user: User };
    await persistAuth(result.token, result.user);
  };

  const login = async (contactNumber: string, password: string) => {
    const contact = normalizeDigits(contactNumber);
    const res = await requestWithFallback('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_number: contact, password }),
    });

    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }

    const data = (await res.json()) as { token: string; user: User };
    await persistAuth(data.token, data.user);
  };

  const logout = async () => {
    const currentToken = token;
    setToken(null);
    setUser(null);
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);

    if (!currentToken) return;
    try {
      await requestWithFallback('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken }),
      });
    } catch {
      // Ignore network errors during logout cleanup.
    }
  };

  const updateLocalUser = async (nextUser: User) => {
    if (!token) {
      setUser(nextUser);
      return;
    }
    await persistAuth(token, nextUser);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      initializing,
      isAuthenticated: !!token,
      token,
      user,
      requestSignupOtp,
      verifySignupOtp,
      completeSignup,
      login,
      logout,
      updateLocalUser,
    }),
    [initializing, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
