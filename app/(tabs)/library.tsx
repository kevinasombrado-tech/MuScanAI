import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { requestApi, toApiUrl } from '@/constants/api';
import {
  clearScanHistory,
  deleteScanHistoryItem,
  readScanHistory,
  updateManyScanHistoryItems,
  updateScanHistoryItem,
  type ScanHistoryItem,
} from '@/constants/scanHistory';
import MitigationInstruction from '@/components/MitigationInstruction';
import HapticPressable from '@/components/HapticPressable';
import { useAuth } from '@/context/AuthContext';
import { useFarms } from '@/context/FarmsContext';

const Pressable = HapticPressable;

type ActiveSection = 'library' | 'history';
type SeverityFilter = 'All' | 'Functional' | 'Mild' | 'Moderate' | 'Severe';
type FarmFilter = 'all' | 'none' | number;

type LibraryItem = {
  id: number;
  title: string;
  body: string;
  image: string;
  modified_at?: string | null;
};

type LibrarySyncResponse = {
  version: number;
  draft_version: number;
  pending: boolean;
  items: LibraryItem[];
};

const normalizeLibraryImage = (image: string | null | undefined): string => {
  const raw = String(image || '').trim();
  if (!raw) return '';
  if (/^data:image\//i.test(raw)) return raw;
  return toApiUrl(raw);
};

const stripHtml = (value: string): string =>
  String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function fetchLibrarySync(): Promise<LibrarySyncResponse> {
  const res = await requestApi('/api/library/sync', {}, { requireOk: true, timeoutMs: 1400 });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as LibrarySyncResponse;
}

export default function LibraryScreen() {
  const { user } = useAuth();
  const { farms } = useFarms();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ section?: string; entryId?: string; historyId?: string }>();
  const [activeSection, setActiveSection] = useState<ActiveSection>(
    params.section === 'history' ? 'history' : 'library'
  );
  const [activeEntryId, setActiveEntryId] = useState<number | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMode, setUploadMode] = useState(false);
  const [selectedUploadIds, setSelectedUploadIds] = useState<string[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [remarkDraft, setRemarkDraft] = useState('');
  const [savingRemark, setSavingRemark] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('All');
  const [farmFilter, setFarmFilter] = useState<FarmFilter>('all');

  const hasItems = useMemo(() => items.length > 0, [items.length]);
  const hasHistory = useMemo(() => history.length > 0, [history.length]);
  const filteredLibraryItems = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    if (!query) return items;
    return items.filter((entry) => {
      const title = String(entry.title || '').toLowerCase();
      const body = stripHtml(entry.body || '').toLowerCase();
      return title.includes(query) || body.includes(query);
    });
  }, [items, librarySearch]);
  const activeEntry = useMemo(
    () => (activeEntryId ? items.find((item) => item.id === activeEntryId) ?? null : null),
    [activeEntryId, items]
  );
  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      const severityOk = severityFilter === 'All' ? true : item.severity === severityFilter;
      const farmOk =
        farmFilter === 'all'
          ? true
          : farmFilter === 'none'
          ? item.farmId == null
          : item.farmId === farmFilter;
      return severityOk && farmOk;
    });
  }, [farmFilter, history, severityFilter]);
  const activeHistoryItem = useMemo(
    () => (activeHistoryId ? filteredHistory.find((item) => item.id === activeHistoryId) ?? null : null),
    [activeHistoryId, filteredHistory]
  );

  useEffect(() => {
    setActiveSection(params.section === 'history' ? 'history' : 'library');
  }, [params.section]);

  useEffect(() => {
    if (!params.entryId) {
      setActiveEntryId(null);
      return;
    }
    const parsed = Number(params.entryId);
    setActiveEntryId(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  }, [params.entryId]);

  useEffect(() => {
    if (params.section !== 'history') return;
    const nextHistoryId = typeof params.historyId === 'string' ? params.historyId.trim() : '';
    if (!nextHistoryId) {
      setActiveHistoryId(null);
      return;
    }
    setActiveSection('history');
    setUploadMode(false);
    setSelectedUploadIds([]);
    setActiveEntryId(null);
    setActiveHistoryId(nextHistoryId);
    const match = history.find((item) => item.id === nextHistoryId);
    setRemarkDraft(match?.remark ?? '');
  }, [history, params.historyId, params.section]);

  useEffect(() => {
    if (activeSection !== 'history') {
      setUploadMode(false);
      setSelectedUploadIds([]);
      setActiveHistoryId(null);
    }
  }, [activeSection]);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    setError(null);

    try {
      const [data, scans] = await Promise.all([fetchLibrarySync(), readScanHistory()]);
      const normalizedItems = Array.isArray(data.items)
        ? data.items.map((item) => ({
            ...item,
            image: normalizeLibraryImage(item.image),
          }))
        : [];
      setItems(normalizedItems);
      setHistory(scans);
      setSelectedUploadIds((prev) => prev.filter((id) => scans.some((item) => item.id === id)));
      setActiveHistoryId((prev) => (prev && scans.some((item) => item.id === prev) ? prev : null));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load library';
      setError(message);
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load('refresh');
    }, [load])
  );

  useEffect(() => {
    const unsub = (navigation as any).addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      setActiveSection('library');
      setActiveEntryId(null);
      setUploadMode(false);
      setSelectedUploadIds([]);
      setActiveHistoryId(null);
      setRemarkDraft('');
    });
    return unsub;
  }, [navigation]);

  const handleDeleteHistoryItem = (id: string) => {
    Alert.alert('Delete entry', 'Remove this scan from history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const next = await deleteScanHistoryItem(id);
          setHistory(next);
        },
      },
    ]);
  };

  const handleClearHistory = () => {
    if (history.length === 0) return;
    Alert.alert('Clear all history', 'This will permanently remove all saved scans.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All',
        style: 'destructive',
        onPress: async () => {
          await clearScanHistory();
          setHistory([]);
          setSelectedUploadIds([]);
          setUploadMode(false);
          setActiveHistoryId(null);
          setRemarkDraft('');
        },
      },
    ]);
  };

  const uploadHistoryItems = async (uploadItems: ScanHistoryItem[]) => {
    if (uploadItems.length === 0) {
      Alert.alert('No pending upload', 'No eligible history entries to upload.');
      return;
    }

    const missingRemark = uploadItems.find((item) => !(item.remark ?? '').trim());
    if (missingRemark) {
      Alert.alert('Remark required', 'Add a remark before uploading this scan result.');
      return;
    }

    setUploading(true);
    try {
      let uploadedCount = 0;
      
      for (const item of uploadItems) {
        try {
          // Determine file extension from imageUri
          const sanitizedUri = item.imageUri.split('?')[0] ?? item.imageUri;
          const ext = sanitizedUri.split('.').pop()?.toLowerCase() || 'jpg';
          const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
          
          // Create FormData for multipart upload
          const formData = new FormData();
          
          // Append local file directly; avoids data: URI fetch failures on Android.
          formData.append('file', {
            uri: item.imageUri,
            name: `scan-${item.id}.${ext}`,
            type: mimeType,
          } as unknown as Blob);
          
          // Append metadata as form fields
          formData.append('history_id', item.id);
          if (user?.id) formData.append('user_id', String(user.id));
          if (item.farmId != null) formData.append('farm_id', String(item.farmId));
          formData.append('severity', item.severity);
          formData.append('mitigations', JSON.stringify(item.mitigations));
          formData.append('remark', item.remark ?? '');
          formData.append('scanned_at', item.scannedAt);
          
          // Upload through requestApi so candidate API hosts are attempted on device/LAN.
          const res = await requestApi('/api/upload-scan', {
            method: 'POST',
            body: formData,
          }, {
            timeoutMs: 20000,
          });
          
          if (!res.ok) {
            const errorBody = await res.text().catch(() => '');
            throw new Error(`Upload failed (${res.status}): ${errorBody || res.statusText}`);
          }
          
          uploadedCount++;
        } catch (itemErr) {
          console.error(`Failed to upload item ${item.id}:`, itemErr);
          Alert.alert('Upload error', `Failed to upload scan ${item.severity}. Check network and try again.`);
          setUploading(false);
          return;
        }
      }
      
      // Mark all items as uploaded
      const now = new Date().toISOString();
      const next = await updateManyScanHistoryItems(uploadItems.map((item) => item.id), (item) => ({
        ...item,
        uploadStatus: 'uploaded',
        uploadedAt: now,
      }));
      setHistory(next);
      setSelectedUploadIds([]);
      setUploadMode(false);
      Alert.alert(
        'Upload complete',
        `${uploadedCount} scan result${uploadedCount > 1 ? 's' : ''} uploaded successfully.`
      );
    } catch (err) {
      console.error('Upload error:', err);
      Alert.alert('Upload failed', 'Please check your network and try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleToggleUploadMode = () => {
    setUploadMode((prev) => {
      if (prev) {
        setSelectedUploadIds([]);
      }
      return !prev;
    });
    setActiveHistoryId(null);
    setRemarkDraft('');
  };

  const toggleUploadSelection = (itemId: string) => {
    setSelectedUploadIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const openHistoryEntry = (scan: ScanHistoryItem) => {
    if (uploadMode) {
      if ((scan.uploadStatus ?? 'pending') === 'uploaded') {
        return;
      }
      toggleUploadSelection(scan.id);
      return;
    }
    setActiveHistoryId(scan.id);
    setRemarkDraft(scan.remark ?? '');
  };

  const saveRemark = async (itemId: string) => {
    const nextRemark = remarkDraft.trim();
    setSavingRemark(true);
    try {
      const next = await updateScanHistoryItem(itemId, (item) => ({
        ...item,
        remark: nextRemark,
      }));
      setHistory(next);
      setRemarkDraft(nextRemark);
      setActiveHistoryId(itemId);
    } finally {
      setSavingRemark(false);
    }
  };

  const selectedUploadItems = useMemo(
    () =>
      history.filter(
        (item) =>
          selectedUploadIds.includes(item.id) &&
          (item.uploadStatus ?? 'pending') !== 'uploaded'
      ),
    [history, selectedUploadIds]
  );

  const getFarmLabel = useCallback(
    (item: ScanHistoryItem): string => {
      if (item.farmName && item.farmName.trim()) return item.farmName;
      if (item.farmId != null) {
        const match = farms.find((farm) => farm.id === item.farmId);
        if (match?.farm_name) return match.farm_name;
      }
      return 'No Farm (General)';
    },
    [farms]
  );

  const severityOptions: SeverityFilter[] = ['All', 'Functional', 'Mild', 'Moderate', 'Severe'];

  const showBottomUpload =
    activeSection === 'history' && uploadMode && !activeHistoryId && selectedUploadItems.length > 0;

  const handleUploadSelected = async () => {
    await uploadHistoryItems(selectedUploadItems);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />}
      >
        <Text style={styles.heading}>Banana Library</Text>
        <Text style={styles.subheading}>Sent from Admin Dashboard</Text>

        <View style={styles.segmentWrap}>
          <Pressable
            style={[styles.segmentBtn, activeSection === 'library' && styles.segmentBtnActive]}
            onPress={() => setActiveSection('library')}
          >
            <Text style={[styles.segmentText, activeSection === 'library' && styles.segmentTextActive]}>
              Library
            </Text>
          </Pressable>
          <Pressable
            style={[styles.segmentBtn, activeSection === 'history' && styles.segmentBtnActive]}
            onPress={() => {
              setActiveSection('history');
              setActiveEntryId(null);
              setActiveHistoryId(null);
            }}
          >
            <Text style={[styles.segmentText, activeSection === 'history' && styles.segmentTextActive]}>
              Scan History
            </Text>
          </Pressable>
        </View>

        {!loading && !error && activeSection === 'library' && !activeEntryId ? (
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color="#64748b" />
            <TextInput
              value={librarySearch}
              onChangeText={setLibrarySearch}
              placeholder="Search library content"
              placeholderTextColor="#94a3b8"
              style={styles.searchInput}
            />
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator size="large" color="#0f766e" />
            <Text style={styles.centerText}>Loading library entries...</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={[styles.centerBlock, styles.errorBlock]}>
            <Text style={styles.errorTitle}>Library unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!loading && !error && activeSection === 'library' && !hasItems ? (
          <View style={styles.centerBlock}>
            <Text style={styles.centerText}>No sent library entries yet.</Text>
          </View>
        ) : null}

        {!loading && !error && activeSection === 'library' && hasItems && !activeEntryId && filteredLibraryItems.length === 0 ? (
          <View style={styles.centerBlock}>
            <Text style={styles.centerText}>No library entries match your search.</Text>
          </View>
        ) : null}

        {!loading && !error && activeSection === 'history' && !hasHistory ? (
          <View style={styles.centerBlock}>
            <Text style={styles.centerText}>No scan history yet.</Text>
          </View>
        ) : null}

        {!loading && !error && activeSection === 'library' && !activeEntryId
          ? filteredLibraryItems.map((entry) => (
              <Pressable
                key={`${entry.id}-${entry.title}`}
                style={styles.card}
                onPress={() => setActiveEntryId(entry.id)}
              >
                <Image source={{ uri: entry.image }} style={styles.cardImage} contentFit="cover" />
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{entry.title}</Text>
                  <Text style={styles.cardPreview} numberOfLines={3}>
                    {stripHtml(entry.body)}
                  </Text>
                </View>
              </Pressable>
            ))
          : null}

        {!loading && !error && activeSection === 'library' && activeEntryId ? (
          !activeEntry ? (
            <View style={styles.centerBlock}>
              <Text style={styles.centerText}>This library entry is no longer available.</Text>
              <Pressable style={styles.inlineBackBtn} onPress={() => setActiveEntryId(null)}>
                <Text style={styles.inlineBackBtnText}>Back to Library</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.entryDetailCard}>
              <Pressable style={styles.entryBackRow} onPress={() => setActiveEntryId(null)}>
                <Ionicons name="arrow-back" size={18} color="#0f172a" />
                <Text style={styles.entryBackText}>Back to Library</Text>
              </Pressable>

              <Image source={{ uri: activeEntry.image }} style={styles.entryImage} contentFit="cover" />
              <Text style={styles.entryTitle}>{activeEntry.title}</Text>
              <MitigationInstruction instruction={activeEntry.body} />
            </View>
          )
        ) : null}

        {!loading && !error && activeSection === 'history' ? (
          <View style={styles.historyWrap}>
            <View style={styles.historyToolbar}>
              <Text style={styles.historyCount}>
                {filteredHistory.length} / {history.length} scan{history.length !== 1 ? 's' : ''} shown
              </Text>
              <View style={styles.historyToolbarActions}>
                {history.some((item) => (item.uploadStatus ?? 'pending') !== 'uploaded') ? (
                  <Pressable
                    onPress={handleToggleUploadMode}
                    style={[styles.uploadAllBtn, uploadMode && styles.uploadAllBtnActive]}
                    disabled={uploading}
                  >
                    <Text style={styles.uploadAllBtnText}>Upload</Text>
                  </Pressable>
                ) : null}
                {history.length > 0 ? (
                  <Pressable onPress={handleClearHistory} style={styles.clearBtn}>
                    <Text style={styles.clearBtnText}>Clear All</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>Severity Filter</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                {severityOptions.map((option) => {
                  const active = severityFilter === option;
                  return (
                    <Pressable
                      key={`sev-${option}`}
                      style={[styles.filterChip, active && styles.filterChipActive]}
                      onPress={() => setSeverityFilter(option)}
                    >
                      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={styles.filterLabel}>Farm Filter</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                <Pressable
                  key="farm-all"
                  style={[styles.filterChip, farmFilter === 'all' && styles.filterChipActive]}
                  onPress={() => setFarmFilter('all')}
                >
                  <Text style={[styles.filterChipText, farmFilter === 'all' && styles.filterChipTextActive]}>All Farms</Text>
                </Pressable>
                <Pressable
                  key="farm-none"
                  style={[styles.filterChip, farmFilter === 'none' && styles.filterChipActive]}
                  onPress={() => setFarmFilter('none')}
                >
                  <Text style={[styles.filterChipText, farmFilter === 'none' && styles.filterChipTextActive]}>No Farm</Text>
                </Pressable>
                {farms.map((farm) => {
                  const active = farmFilter === farm.id;
                  return (
                    <Pressable
                      key={`farm-${farm.id}`}
                      style={[styles.filterChip, active && styles.filterChipActive]}
                      onPress={() => setFarmFilter(farm.id)}
                    >
                      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{farm.farm_name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {activeHistoryId && !uploadMode ? (
              !activeHistoryItem ? (
                <View style={styles.centerBlock}>
                  <Text style={styles.centerText}>This scan history entry is no longer available.</Text>
                  <Pressable style={styles.inlineBackBtn} onPress={() => setActiveHistoryId(null)}>
                    <Text style={styles.inlineBackBtnText}>Back to Scan History</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.entryDetailCard}>
                  <Pressable style={styles.entryBackRow} onPress={() => setActiveHistoryId(null)}>
                    <Ionicons name="arrow-back" size={18} color="#0f172a" />
                    <Text style={styles.entryBackText}>Back to Scan History</Text>
                  </Pressable>

                  <Image source={{ uri: activeHistoryItem.imageUri }} style={styles.entryImage} contentFit="cover" />
                  <Text style={styles.entryTitle}>{activeHistoryItem.severity}</Text>
                  <Text style={styles.historyMeta}>Farm: {getFarmLabel(activeHistoryItem)}</Text>
                  <Text style={styles.historyMeta}>{new Date(activeHistoryItem.scannedAt).toLocaleString()}</Text>
                  <Text style={styles.historyMeta}>
                    Mitigation v{activeHistoryItem.mitigationVersion} · {activeHistoryItem.mitigationSource}
                  </Text>
                  <View style={styles.mitigationList}>
                    {activeHistoryItem.mitigations.map((mitigation) => (
                      <View key={`${activeHistoryItem.id}-${mitigation.title}`} style={styles.mitigationItem}>
                        <Text style={styles.mitigationTitle}>{mitigation.title}</Text>
                        <MitigationInstruction instruction={(mitigation as { instruction?: string }).instruction || mitigation.description} />
                      </View>
                    ))}
                  </View>
                  <Text style={styles.remarkLabel}>Remark</Text>
                  <TextInput
                    value={remarkDraft}
                    onChangeText={setRemarkDraft}
                    placeholder="Add remark"
                    placeholderTextColor="#94a3b8"
                    style={styles.remarkInput}
                    multiline
                  />
                  <Pressable
                    style={[styles.remarkSaveBtn, savingRemark && styles.disabledBtn]}
                    onPress={() => void saveRemark(activeHistoryItem.id)}
                    disabled={savingRemark}
                  >
                    {savingRemark ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.remarkSaveText}>Save Remark</Text>
                    )}
                  </Pressable>
                </View>
              )
            ) : (
              filteredHistory.length === 0 ? (
                <View style={styles.centerBlock}>
                  <Text style={styles.centerText}>No scans match the selected filters.</Text>
                </View>
              ) : (
              filteredHistory.map((scan) => {
                const isSelected = selectedUploadIds.includes(scan.id);
                const isUploaded = (scan.uploadStatus ?? 'pending') === 'uploaded';
                return (
                  <Pressable
                    key={scan.id}
                    style={[
                      styles.historyCard,
                      uploadMode && isSelected && styles.historyCardSelected,
                      uploadMode && isUploaded && styles.historyCardDisabled,
                    ]}
                    onPress={() => openHistoryEntry(scan)}
                  >
                    <Image source={{ uri: scan.imageUri }} style={styles.historyImage} contentFit="cover" />
                    <View style={styles.historyBody}>
                      <View style={styles.historyTopRow}>
                        <View style={styles.historyTitleRow}>
                          {uploadMode ? (
                            <View
                              style={[
                                styles.checkCell,
                                isSelected && styles.checkCellSelected,
                                isUploaded && styles.checkCellDisabled,
                              ]}
                            >
                              {isSelected ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
                            </View>
                          ) : null}
                          <Text style={styles.historySeverity}>{scan.severity}</Text>
                        </View>
                        <Pressable onPress={() => handleDeleteHistoryItem(scan.id)} hitSlop={8}>
                          <Ionicons name="trash-outline" size={18} color="#ef4444" />
                        </Pressable>
                      </View>
                      <Text style={styles.historyMeta}>{new Date(scan.scannedAt).toLocaleString()}</Text>
                      <Text style={styles.historyMeta}>Farm: {getFarmLabel(scan)}</Text>
                      <Text style={styles.historyMeta}>
                        Mitigation v{scan.mitigationVersion} · {scan.mitigationSource}
                      </Text>
                      <Text style={styles.historyRemark} numberOfLines={2}>
                        {scan.remark?.trim() ? `Remark: ${scan.remark}` : 'No remark yet'}
                      </Text>
                      <Text style={styles.uploadTag}>
                        {scan.uploadStatus === 'uploaded'
                          ? `Uploaded${scan.uploadedAt ? ` · ${new Date(scan.uploadedAt).toLocaleString()}` : ''}`
                          : 'Pending upload'}
                      </Text>
                    </View>
                  </Pressable>
                );
              }))
            )}
          </View>
        ) : null}
      </ScrollView>

      {showBottomUpload ? (
        <View style={styles.bottomUploadWrap}>
          <Pressable
            style={[styles.bottomUploadBtn, uploading && styles.disabledBtn]}
            onPress={() => void handleUploadSelected()}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.bottomUploadBtnText}>Upload ({selectedUploadItems.length})</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f5f7f2',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 170,
    gap: 12,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1f2937',
  },
  subheading: {
    marginTop: 2,
    marginBottom: 8,
    fontSize: 14,
    color: '#4b5563',
    fontWeight: '600',
  },
  segmentWrap: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    padding: 4,
    gap: 6,
  },
  segmentBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#ffffff',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  segmentTextActive: {
    color: '#0f172a',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: '#0f172a',
    fontSize: 14,
    paddingVertical: 0,
  },
  centerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    padding: 20,
    backgroundColor: '#ffffff',
  },
  centerText: {
    marginTop: 10,
    color: '#334155',
    fontSize: 14,
    textAlign: 'center',
  },
  errorBlock: {
    backgroundColor: '#fff1f2',
  },
  errorTitle: {
    color: '#9f1239',
    fontSize: 16,
    fontWeight: '700',
  },
  errorText: {
    marginTop: 6,
    color: '#881337',
    textAlign: 'center',
  },
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  cardImage: {
    width: '100%',
    height: 150,
    backgroundColor: '#e5e7eb',
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  cardPreview: {
    fontSize: 14,
    lineHeight: 20,
    color: '#4b5563',
  },
  entryDetailCard: {
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    padding: 12,
    gap: 10,
  },
  entryBackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  entryBackText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  entryImage: {
    width: '100%',
    height: 210,
    borderRadius: 14,
    backgroundColor: '#e5e7eb',
  },
  entryTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  entryBody: {
    fontSize: 15,
    lineHeight: 22,
    color: '#334155',
  },
  inlineBackBtn: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  inlineBackBtnText: {
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '700',
  },
  historyWrap: {
    gap: 10,
  },
  filterBlock: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe3ea',
    backgroundColor: '#ffffff',
    padding: 10,
    gap: 8,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  filterRow: {
    gap: 8,
    paddingRight: 8,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipActive: {
    borderColor: '#0f7a2e',
    backgroundColor: '#dcfce7',
  },
  filterChipText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#166534',
  },
  historyToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  historyToolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  historyCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1f2937',
  },
  uploadAllBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#0f7a2e',
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadAllBtnActive: {
    backgroundColor: '#14532d',
  },
  uploadAllBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  clearBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#fee2e2',
  },
  clearBtnText: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '700',
  },
  historyCard: {
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    overflow: 'hidden',
  },
  historyCardSelected: {
    borderColor: '#16a34a',
    borderWidth: 2,
  },
  historyCardDisabled: {
    opacity: 0.7,
  },
  historyImage: {
    width: '100%',
    height: 140,
    backgroundColor: '#e5e7eb',
  },
  historyBody: {
    padding: 10,
    gap: 4,
  },
  historyTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkCell: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#64748b',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  checkCellSelected: {
    borderColor: '#0f7a2e',
    backgroundColor: '#0f7a2e',
  },
  checkCellDisabled: {
    opacity: 0.45,
  },
  historySeverity: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  historyMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  historyRemark: {
    marginTop: 3,
    fontSize: 12,
    color: '#334155',
  },
  mitigationList: {
    marginTop: 8,
    gap: 8,
  },
  mitigationItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#f8fbff',
    padding: 8,
    gap: 3,
  },
  mitigationTitle: {
    fontSize: 12,
    color: '#1e3a8a',
    fontWeight: '800',
  },
  mitigationBody: {
    fontSize: 12,
    lineHeight: 18,
    color: '#334155',
  },
  uploadTag: {
    marginTop: 4,
    fontSize: 11,
    color: '#0f7a2e',
    fontWeight: '600',
  },
  remarkLabel: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
  },
  remarkInput: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
    textAlignVertical: 'top',
  },
  remarkSaveBtn: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#0f172a',
    minWidth: 98,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remarkSaveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  disabledBtn: {
    opacity: 0.55,
  },
  bottomUploadWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 122,
    alignItems: 'center',
  },
  bottomUploadBtn: {
    backgroundColor: '#0f7a2e',
    borderRadius: 20,
    minWidth: 168,
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  bottomUploadBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
});
