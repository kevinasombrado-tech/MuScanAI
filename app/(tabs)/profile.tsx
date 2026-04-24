import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';

import { requestApi } from '@/constants/api';
import HapticPressable from '@/components/HapticPressable';
import FarmManagementModal from '@/components/FarmManagementModal';
import { useAuth } from '@/context/AuthContext';

const Pressable = HapticPressable;

type ProfileView = 'main' | 'edit-profile' | 'account-settings' | 'language';;

const PROFILE_IMAGE_DIR = `${FileSystem.documentDirectory ?? ''}profile-images`;
const MAX_PROFILE_IMAGE_BYTES = 10 * 1024 * 1024;

const initialFromName = (name: string | undefined): string => {
  const clean = (name ?? '').trim();
  if (!clean) return 'F';
  return clean.charAt(0).toUpperCase();
};

export default function ProfileScreen() {
  const { user, logout, updateLocalUser } = useAuth();
  const navigation = useNavigation();
  const [view, setView] = useState<ProfileView>('main');
  const [saving, setSaving] = useState(false);
  const [showFarmModal, setShowFarmModal] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.name ?? '');
  const [imageDraft, setImageDraft] = useState(user?.profile_image ?? '');
  const [mobileDraft, setMobileDraft] = useState(user?.contact_number ?? '');
  const [emailDraft, setEmailDraft] = useState(user?.email ?? '');
  const [passwordDraft, setPasswordDraft] = useState('');

  const selectedLanguage = useMemo(() => 'English', []);

  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      setView('main');
    });
    return unsub;
  }, [navigation]);

  const callUserUpdate = async (payload: {
    name?: string;
    contact_number?: string;
    email?: string | null;
    password?: string;
    profile_image?: string | null;
  }) => {
    if (!user) return;
    const requestPayload = {
      name: payload.name ?? user.name,
      contact_number: payload.contact_number ?? user.contact_number,
      email: payload.email ?? user.email,
      password: payload.password,
      profile_image: payload.profile_image ?? user.profile_image ?? null,
      role: user.role,
    };

    const res = await requestApi(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    }, { requireOk: true, timeoutMs: 2000 });

    if (!res.ok) {
      throw new Error('Failed to update account');
    }

    const updated = (await res.json()) as typeof user;
    await updateLocalUser(updated);
  };

  const onPickProfileImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow gallery access.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      allowsMultipleSelection: false,
    });

    if (result.canceled || !result.assets?.length) return;

    const picked = result.assets[0];
    const rawSize = typeof picked.fileSize === 'number' ? picked.fileSize : 0;
    let size = rawSize;

    if (!size) {
      try {
        const info = await FileSystem.getInfoAsync(picked.uri);
        size = Number((info as { size?: number }).size ?? 0);
      } catch {
        size = 0;
      }
    }

    if (size > MAX_PROFILE_IMAGE_BYTES) {
      Alert.alert('Image too large', 'Please choose an image smaller than 10MB.');
      return;
    }

    try {
      await FileSystem.makeDirectoryAsync(PROFILE_IMAGE_DIR, { intermediates: true });
      const extMatch = picked.uri.match(/\.[a-zA-Z0-9]+($|\?)/);
      const ext = extMatch ? extMatch[0].replace('?', '') : '.jpg';
      const target = `${PROFILE_IMAGE_DIR}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      await FileSystem.copyAsync({ from: picked.uri, to: target });
      setImageDraft(target);
    } catch {
      Alert.alert('Upload failed', 'Could not save selected image.');
    }
  };

  const saveEditProfile = async () => {
    if (!user) return;
    const trimmedName = nameDraft.trim();
    if (trimmedName.length < 2) {
      Alert.alert('Invalid name', 'Name must be at least 2 characters.');
      return;
    }

    setSaving(true);
    try {
      await callUserUpdate({ name: trimmedName, profile_image: imageDraft || null });
      Alert.alert('Saved', 'Profile updated successfully.');
      setView('main');
    } catch {
      Alert.alert('Update failed', 'Could not update your profile.');
    } finally {
      setSaving(false);
    }
  };

  const saveAccountSettings = async () => {
    const mobile = mobileDraft.replace(/\D/g, '');
    if (mobile.length < 10 || mobile.length > 15) {
      Alert.alert('Invalid mobile', 'Use 10 to 15 digits.');
      return;
    }
    if (passwordDraft && passwordDraft.length < 8) {
      Alert.alert('Invalid password', 'Password must be at least 8 characters.');
      return;
    }

    setSaving(true);
    try {
      await callUserUpdate({
        contact_number: mobile,
        email: emailDraft.trim() ? emailDraft.trim().toLowerCase() : null,
        password: passwordDraft.trim() || undefined,
      });
      setPasswordDraft('');
      Alert.alert('Saved', 'Account settings updated successfully.');
      setView('main');
    } catch {
      Alert.alert('Update failed', 'Could not update account settings.');
    } finally {
      setSaving(false);
    }
  };

  const exportAccount = async () => {
    if (!user) return;
    try {
      const payload = {
        exported_at: new Date().toISOString(),
        user,
      };
      const filePath = `${FileSystem.documentDirectory ?? ''}muscan-account-${user.id}.json`;
      await FileSystem.writeAsStringAsync(filePath, JSON.stringify(payload, null, 2));
      Alert.alert('Export complete', `Account data saved to:\n${filePath}`);
    } catch {
      Alert.alert('Export failed', 'Could not export account JSON.');
    }
  };

  const onLogout = async () => {
    try {
      await logout();
    } catch {
      Alert.alert('Logout issue', 'Could not notify server, but local session was cleared.');
    }
  };

  const renderMain = () => (
    <>
      <View style={styles.bannerWrap}>
        <Image
          source={{ uri: 'https://images.unsplash.com/photo-1464226184884-fa280b87c399?q=80&w=1400&auto=format&fit=crop' }}
          style={styles.bannerImage}
          contentFit="cover"
        />
        <View style={styles.identityWrap}>
          <View style={styles.avatarWrap}>
            {user?.profile_image ? (
              <Image source={{ uri: user.profile_image }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>{initialFromName(user?.name)}</Text>
              </View>
            )}
          </View>

          <Text style={styles.nameText}>{user?.name ?? 'Farmer'}</Text>
          <Text style={styles.roleText}>{user?.role ?? 'Farmer'}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Settings</Text>
        <Pressable style={styles.settingRow} onPress={() => setView('edit-profile')}>
          <Text style={styles.settingLabel}>Edit Profile</Text>
          <Ionicons name="chevron-forward" size={18} color="#64748b" />
        </Pressable>
        <Pressable style={styles.settingRow} onPress={() => setView('account-settings')}>
          <Text style={styles.settingLabel}>Account Settings</Text>
          <Ionicons name="chevron-forward" size={18} color="#64748b" />
        </Pressable>
        <Pressable style={styles.settingRow} onPress={() => setShowFarmModal(true)}>
          <Text style={styles.settingLabel}>Manage Farms</Text>
          <Ionicons name="chevron-forward" size={18} color="#64748b" />
        </Pressable>
        <Pressable style={styles.settingRow} onPress={() => setView('language')}>
          <Text style={styles.settingLabel}>Language</Text>
          <Ionicons name="chevron-forward" size={18} color="#64748b" />
        </Pressable>
      </View>

      <Pressable style={styles.logoutButton} onPress={onLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </Pressable>
    </>
  );

  const renderEditProfile = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Edit Profile</Text>
      <Text style={styles.label}>Profile Image</Text>
      {imageDraft ? <Image source={{ uri: imageDraft }} style={styles.previewImage} contentFit="cover" /> : null}

      <Pressable style={styles.secondaryButton} onPress={() => void onPickProfileImage()}>
        <Text style={styles.secondaryButtonText}>Upload Image (max 10MB)</Text>
      </Pressable>

      <Text style={styles.label}>Name</Text>
      <TextInput value={nameDraft} onChangeText={setNameDraft} style={styles.input} placeholder="Full name" />

      <Pressable
        style={[styles.primaryButton, saving && styles.disabledButton]}
        onPress={() => void saveEditProfile()}
        disabled={saving}
      >
        <Text style={styles.primaryButtonText}>Save Profile</Text>
      </Pressable>
    </View>
  );

  const renderAccountSettings = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Account Settings</Text>
      <Text style={styles.label}>Change Mobile Number</Text>
      <TextInput
        value={mobileDraft}
        onChangeText={setMobileDraft}
        style={styles.input}
        placeholder="Mobile number"
        keyboardType="phone-pad"
      />

      <Text style={styles.label}>Change Email</Text>
      <TextInput
        value={emailDraft}
        onChangeText={setEmailDraft}
        style={styles.input}
        placeholder="Email"
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <Text style={styles.label}>Change Password</Text>
      <TextInput
        value={passwordDraft}
        onChangeText={setPasswordDraft}
        style={styles.input}
        placeholder="New password (min 8 chars)"
        secureTextEntry
      />

      <Pressable
        style={[styles.primaryButton, saving && styles.disabledButton]}
        onPress={() => void saveAccountSettings()}
        disabled={saving}
      >
        <Text style={styles.primaryButtonText}>Save Account Changes</Text>
      </Pressable>

      <Pressable style={styles.exportButton} onPress={() => void exportAccount()}>
        <Text style={styles.exportButtonText}>Export Account (JSON)</Text>
      </Pressable>
    </View>
  );

  const renderLanguage = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Language</Text>
      <Text style={styles.value}>Current: {selectedLanguage}</Text>
      <Text style={styles.label}>More language options can be added here.</Text>
    </View>
  );

  return (
    <>
      <ScrollView contentContainerStyle={styles.container}>
        {view !== 'main' ? (
          <Pressable style={styles.backButton} onPress={() => setView('main')}>
            <Ionicons name="arrow-back" size={18} color="#0f172a" />
            <Text style={styles.backText}>Back to Profile</Text>
          </Pressable>
        ) : null}

        {view === 'main' ? renderMain() : null}
        {view === 'edit-profile' ? renderEditProfile() : null}
        {view === 'account-settings' ? renderAccountSettings() : null}
        {view === 'language' ? renderLanguage() : null}
      </ScrollView>
      <FarmManagementModal visible={showFarmModal} onClose={() => setShowFarmModal(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 18,
    paddingBottom: 130,
    backgroundColor: '#f8fafc',
    gap: 14,
  },
  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#e2e8f0',
  },
  backText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
  },
  bannerWrap: {
    borderRadius: 16,
    overflow: 'visible',
    position: 'relative',
    marginBottom: 76,
  },
  bannerImage: {
    width: '100%',
    height: 160,
    borderRadius: 16,
    backgroundColor: '#dbeafe',
  },
  identityWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -58,
    alignItems: 'center',
    gap: 4,
  },
  avatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: '#cbd5e1',
  },
  avatarFallback: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 24,
  },
  nameText: {
    marginTop: 2,
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  roleText: {
    marginTop: -2,
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  settingLabel: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '600',
  },
  label: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  previewImage: {
    alignSelf: 'center',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#e5e7eb',
  },
  primaryButton: {
    marginTop: 4,
    backgroundColor: '#165DFF',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 11,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  secondaryButton: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 11,
  },
  secondaryButtonText: {
    color: '#1d4ed8',
    fontWeight: '700',
    fontSize: 14,
  },
  exportButton: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 11,
  },
  exportButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  disabledButton: {
    opacity: 0.55,
  },
  logoutButton: {
    marginTop: 8,
    backgroundColor: '#b91c1c',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  logoutText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
