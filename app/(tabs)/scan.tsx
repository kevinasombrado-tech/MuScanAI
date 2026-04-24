import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import Ionicons from '@expo/vector-icons/Ionicons';

import { requestApi } from '@/constants/api';
import { appendScanHistory, readScanHistory, updateScanHistoryItem } from '@/constants/scanHistory';
import MitigationInstruction from '@/components/MitigationInstruction';
import FarmSelectorModal from '@/components/FarmSelectorModal';
import HapticPressable from '@/components/HapticPressable';
import { useFarms } from '@/context/FarmsContext';
import { runTflite, type RunResult, runGatekeeper, type GatekeeperResult } from '@/native/TfliteModule';

const Pressable = HapticPressable;

const MAX_IMAGES = 10;
const CACHE_FILE = `${FileSystem.documentDirectory ?? ''}mitigation-cache.json`;
const SCAN_IMAGE_DIR = `${FileSystem.documentDirectory ?? ''}scan-images`;

type Severity = 'Functional' | 'Mild' | 'Moderate' | 'Severe';
const ALL_SEVERITIES: Severity[] = ['Functional', 'Mild', 'Moderate', 'Severe'];

type Mitigation = {
  id: number;
  severity: string;
  title: string;
  description: string;
  instruction?: string;
};

type SyncResponse = {
  severity: Severity;
  version: number;
  items: Mitigation[];
};

type VersionsResponse = {
  versions: Record<string, { version: number; updated_at: string }>;
};

type MitigationCache = {
  versions: Record<Severity, number>;
  items: Record<Severity, Mitigation[]>;
};

type QueueStatus = 'queued' | 'analyzing' | 'done' | 'error' | 'not-banana-review';

type QueueItem = {
  id: string;
  historyId?: string;
  uri: string;
  status: QueueStatus;
  farmId?: number | null;
  farmName?: string | null;
  result?: RunResult;
  gatekeeperResult?: GatekeeperResult;
  mitigationsLoading?: boolean;
  mitigations?: Mitigation[];
  mitigationVersion?: number;
  mitigationSource?: 'server' | 'cache';
  feedback?: string;
  feedbackSubmittedAt?: string;
  error?: string;
};

const defaultMitigations: Record<Severity, Mitigation[]> = {
  Functional: [
    {
      id: -1001,
      severity: 'Functional',
      title: 'No immediate intervention required',
      description:
        'Leaf appears healthy. Continue routine monitoring, sanitation, and balanced fertilization.',
    },
  ],
  Mild: [
    {
      id: -1002,
      severity: 'Mild',
      title: 'Start preventive management',
      description:
        'Prune lightly infected leaves, improve air circulation, and begin scheduled fungicide prevention.',
    },
  ],
  Moderate: [
    {
      id: -1003,
      severity: 'Moderate',
      title: 'Apply curative treatment plan',
      description:
        'Increase fungicide frequency per label, remove infected foliage, and closely monitor nearby plants.',
    },
  ],
  Severe: [
    {
      id: -1004,
      severity: 'Severe',
      title: 'Urgent containment required',
      description:
        'Isolate heavily infected plants, remove severely damaged leaves, and execute immediate intensive treatment.',
    },
  ],
};

const emptyCache = (): MitigationCache => ({
  versions: {
    Functional: 1,
    Mild: 1,
    Moderate: 1,
    Severe: 1,
  },
  items: {
    Functional: [...defaultMitigations.Functional],
    Mild: [...defaultMitigations.Mild],
    Moderate: [...defaultMitigations.Moderate],
    Severe: [...defaultMitigations.Severe],
  },
});

const normalizeCache = (raw: unknown): MitigationCache => {
  const base = emptyCache();
  if (!raw || typeof raw !== 'object') return base;

  const maybe = raw as Partial<MitigationCache>;
  const versions = maybe.versions ?? ({} as Partial<Record<Severity, number>>);
  const items = maybe.items ?? ({} as Partial<Record<Severity, Mitigation[]>>);

  for (const severity of ALL_SEVERITIES) {
    const v = Number((versions as Record<string, unknown>)[severity]);
    if (!Number.isNaN(v)) {
      base.versions[severity] = Math.max(1, Math.floor(v));
    }
    const arr = (items as Record<string, unknown>)[severity];
    if (Array.isArray(arr) && arr.length > 0) {
      base.items[severity] = arr as Mitigation[];
    }
  }

  return base;
};

const normalizeSeverity = (label: string): Severity | null => {
  const value = label.trim().toLowerCase();
  if (value === 'functional' || value === 'healthy') return 'Functional';
  if (value === 'mild') return 'Mild';
  if (value === 'moderate') return 'Moderate';
  if (value === 'severe') return 'Severe';
  return null;
};

const getSeverityColor = (label?: string): string => {
  const severity = label ? normalizeSeverity(label) : null;
  if (severity === 'Functional') return '#4f7146';
  if (severity === 'Mild') return '#eb9c35';
  if (severity === 'Moderate') return '#c4501a';
  if (severity === 'Severe') return '#e53535';
  return '#ffffff';
};

const getResultConfidence = (result?: RunResult | null): number => {
  if (!result?.probs?.length) return 0;
  const labelIndex = normalizeSeverity(result.label);
  if (labelIndex) {
    const indexMap: Record<Severity, number> = {
      Functional: 0,
      Mild: 1,
      Moderate: 2,
      Severe: 3,
    };
    const confidence = result.probs[indexMap[labelIndex]] ?? 0;
    return Math.max(0, Math.min(1, confidence));
  }
  return Math.max(...result.probs, 0);
};

const persistAnalyzedImage = async (uri: string): Promise<string> => {
  try {
    await FileSystem.makeDirectoryAsync(SCAN_IMAGE_DIR, { intermediates: true });
    const extMatch = uri.match(/\.[a-zA-Z0-9]+($|\?)/);
    const ext = extMatch ? extMatch[0].replace('?', '') : '.jpg';
    const target = `${SCAN_IMAGE_DIR}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    await FileSystem.copyAsync({ from: uri, to: target });
    return target;
  } catch {
    return uri;
  }
};

export default function ScanScreen() {
  const params = useLocalSearchParams<{ autoOpen?: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const { farms, selectedFarmId, setSelectedFarmId } = useFarms();
  const [showFarmSelector, setShowFarmSelector] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [cache, setCache] = useState<MitigationCache>(emptyCache());
  const [cameraVisible, setCameraVisible] = useState(false);
  const [capturedUris, setCapturedUris] = useState<string[]>([]);
  const [flashMode, setFlashMode] = useState<'off' | 'on'>('off');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [historyRemarks, setHistoryRemarks] = useState<Record<string, string>>({});
  const didWarmSyncRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  const cameraRef = useRef<CameraView | null>(null);
  const quickLaunchHandledRef = useRef(false);
  const waitingOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    if (farms.length === 0) return;
    const exists = selectedFarmId != null && farms.some((farm) => farm.id === selectedFarmId);
    if (!exists) {
      void setSelectedFarmId(farms[0].id);
    }
  }, [farms, selectedFarmId, setSelectedFarmId]);

  const ensureFarmSelected = useCallback(() => {
    if (selectedFarmId != null && farms.some((farm) => farm.id === selectedFarmId)) {
      return true;
    }
    Alert.alert('Farm required', 'Please select a farm first before scanning or analyzing images.');
    setShowFarmSelector(true);
    return false;
  }, [farms, selectedFarmId]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(waitingOpacity, {
          toValue: 0.35,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(waitingOpacity, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [waitingOpacity]);

  useEffect(() => {
    const loadCache = async () => {
      try {
        const info = await FileSystem.getInfoAsync(CACHE_FILE);
        if (!info.exists) {
          const initial = emptyCache();
          setCache(initial);
          await FileSystem.writeAsStringAsync(CACHE_FILE, JSON.stringify(initial));
          return;
        }
        const raw = await FileSystem.readAsStringAsync(CACHE_FILE);
        const parsed = normalizeCache(JSON.parse(raw));
        setCache(parsed);
        await FileSystem.writeAsStringAsync(CACHE_FILE, JSON.stringify(parsed));
      } catch {
        const fallback = emptyCache();
        setCache(fallback);
      }
    };
    void loadCache();
  }, []);

  const persistCache = useCallback(async (nextCache: MitigationCache) => {
    setCache(nextCache);
    await FileSystem.writeAsStringAsync(CACHE_FILE, JSON.stringify(nextCache));
  }, []);

  const activeQueueItems = useMemo(
    () => queue.filter((item) => item.status === 'queued' || item.status === 'analyzing' || item.status === 'error' || item.status === 'not-banana-review'),
    [queue]
  );
  const completedItems = useMemo(() => queue.filter((item) => item.status === 'done'), [queue]);
  const hasQueuedItems = useMemo(
    () => activeQueueItems.some((item) => item.status === 'queued'),
    [activeQueueItems]
  );
  const queueAtCapacity = useMemo(() => activeQueueItems.length >= MAX_IMAGES, [activeQueueItems.length]);
  const remainingSlots = useMemo(
    () => Math.max(0, MAX_IMAGES - activeQueueItems.length),
    [activeQueueItems.length]
  );

  const addToQueue = useCallback((uris: string[]) => {
    if (uris.length === 0) return;
    const allowed = uris.slice(0, remainingSlots);
    const next = allowed.map((uri) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      uri,
      status: 'queued' as QueueStatus,
    }));
    setQueue((prev) => [...prev, ...next]);
    if (allowed.length < uris.length) {
      Alert.alert('Queue limit reached', `Only ${MAX_IMAGES} images are allowed.`);
    }
  }, [remainingSlots]);

  const pickFromGallery = useCallback(async () => {
    if (!ensureFarmSelected()) return;
    if (remainingSlots === 0) {
      Alert.alert('Queue full', `Maximum ${MAX_IMAGES} images reached.`);
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow gallery access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: remainingSlots,
    });
    if (result.canceled || !result.assets?.length) return;
    addToQueue(result.assets.map((a) => a.uri));
  }, [addToQueue, ensureFarmSelected, remainingSlots]);

  const openCustomCamera = useCallback(async () => {
    if (!ensureFarmSelected()) return;
    if (remainingSlots === 0) {
      Alert.alert('Queue full', `Maximum ${MAX_IMAGES} images reached.`);
      return;
    }

    let granted = cameraPermission?.granted ?? false;
    if (!granted) {
      const permission = await requestCameraPermission();
      granted = permission.granted;
    }

    if (!granted) {
      Alert.alert('Permission needed', 'Please allow camera access.');
      return;
    }

    setCapturedUris([]);
    setFlashMode('off');
    setCameraVisible(true);
  }, [cameraPermission?.granted, ensureFarmSelected, remainingSlots, requestCameraPermission]);

  const pickFromGalleryInCamera = useCallback(async () => {
    const localRemaining = remainingSlots - capturedUris.length;
    if (localRemaining <= 0) {
      Alert.alert('Queue full', `Maximum ${MAX_IMAGES} images reached.`);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow gallery access.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: localRemaining,
    });

    if (result.canceled || !result.assets?.length) return;

    const pickedUris = result.assets.map((a) => a.uri).slice(0, localRemaining);
    const combinedUris = [...capturedUris, ...pickedUris];
    addToQueue(combinedUris);
    setCapturedUris([]);
    setCameraVisible(false);
  }, [addToQueue, capturedUris, remainingSlots]);

  const captureFromCamera = useCallback(async () => {
    const localRemaining = remainingSlots - capturedUris.length;
    if (localRemaining <= 0) {
      Alert.alert('Queue full', `Maximum ${MAX_IMAGES} images reached.`);
      return;
    }

    const shot = await cameraRef.current?.takePictureAsync({ quality: 1, skipProcessing: true });
    if (!shot?.uri) return;
    setCapturedUris((prev) => [...prev, shot.uri]);
  }, [capturedUris.length, remainingSlots]);

  const finishCameraCapture = useCallback(() => {
    if (capturedUris.length > 0) {
      addToQueue(capturedUris);
    }
    setCapturedUris([]);
    setCameraVisible(false);
  }, [addToQueue, capturedUris]);

  useEffect(() => {
    const autoOpen = typeof params.autoOpen === 'string' ? params.autoOpen : undefined;

    if (autoOpen !== 'camera') {
      quickLaunchHandledRef.current = false;
      return;
    }

    if (quickLaunchHandledRef.current) return;
    quickLaunchHandledRef.current = true;

    // Launch camera immediately when arriving from Home "Scan Now".
    void openCustomCamera();
    router.replace('/(tabs)/scan');
  }, [openCustomCamera, params.autoOpen, router]);

  useEffect(() => {
    navigation.setOptions({
      tabBarStyle: cameraVisible ? { display: 'none' } : undefined,
    });

    return () => {
      navigation.setOptions({ tabBarStyle: undefined });
    };
  }, [cameraVisible, navigation]);

  useEffect(() => {
    const unsub = (navigation as any).addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      setSelectedItemId(null);
      setCameraVisible(false);
      setCapturedUris([]);
    });
    return unsub;
  }, [navigation]);

  const removeItem = (id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id));
    if (selectedItemId === id) {
      setSelectedItemId(null);
    }
  };

  const clearAllCompleted = () => {
    const completedIds = completedItems.map((item) => item.id);
    setQueue((prev) => prev.filter((q) => !completedIds.includes(q.id)));
    setSelectedItemId(null);
  };

  const updateQueueItem = (id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const handleGatekeeperConfirmation = async (itemId: string, isConfirmedBanana: boolean) => {
    if (isConfirmedBanana) {
      // User confirmed it's a banana - re-analyze with Black Sigatoka
      const item = queue.find((q) => q.id === itemId);
      if (!item) return;

      updateQueueItem(itemId, {
        status: 'analyzing',
        gatekeeperResult: undefined,
      });

      try {
        const result = await runTflite(item.uri);
        const severity = normalizeSeverity(result.label);
        if (!severity) {
          throw new Error(`Unsupported severity label: ${result.label}`);
        }

        const immediateMitigations =
          cache.items[severity] && cache.items[severity].length > 0
            ? cache.items[severity]
            : defaultMitigations[severity];
        const immediateVersion = Math.max(1, cache.versions[severity] ?? 1);

        updateQueueItem(itemId, {
          status: 'done',
          result,
          mitigationsLoading: true,
        });

        // Update history with the verified banana result
        if (item.historyId) {
          try {
            await updateScanHistoryItem(item.historyId, (histItem) => ({
              ...histItem,
              severity: result.label,
              mitigations: immediateMitigations.map((m) => ({
                title: m.title,
                description: m.instruction || m.description,
              })),
              gatekeeperVerified: true,
            }));
          } catch {
            // History update not critical
          }
        }

        // Fetch updated mitigations
        void (async () => {
          try {
            const liveItem = queueRef.current.find((q) => q.id === itemId);
            if (!liveItem || liveItem.status === 'error') return;

            const mitigationData = await getMitigationsForSeverity(severity, cache);
            updateQueueItem(itemId, {
              mitigations: mitigationData.items,
              mitigationVersion: mitigationData.version,
              mitigationSource: mitigationData.source,
              mitigationsLoading: false,
            });
          } catch {
            updateQueueItem(itemId, { mitigationsLoading: false });
          }
        })();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Re-analysis failed';
        updateQueueItem(itemId, { status: 'error', error: message });
      }
    } else {
      // User confirmed it's NOT a banana - remove from queue and history
      removeItem(itemId);
      const item = queue.find((q) => q.id === itemId);
      if (item?.historyId) {
        try {
          const history = await readScanHistory();
          const filtered = history.filter((h) => h.id !== item.historyId);
          // Would need to implement a write function if history storage supports it
        } catch {
          // History removal not critical
        }
      }
    }

    setSelectedItemId(null);
  };

  const selectedItem = useMemo(
    () => (selectedItemId ? queue.find((q) => q.id === selectedItemId) ?? null : null),
    [queue, selectedItemId]
  );

  const loadHistoryRemarks = useCallback(async () => {
    const scans = await readScanHistory();
    const next: Record<string, string> = {};
    for (const scan of scans) {
      next[scan.id] = scan.remark ?? '';
    }
    setHistoryRemarks(next);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHistoryRemarks();
    }, [loadHistoryRemarks])
  );

  const getEffectiveRemark = useCallback(
    (item: QueueItem | null) => {
      if (!item) return '';
      if (item.historyId) {
        return historyRemarks[item.historyId] ?? item.feedback ?? '';
      }
      return item.feedback ?? '';
    },
    [historyRemarks]
  );

  const submitFeedback = async () => {
    const content = feedbackDraft.trim();
    if (!selectedItem || !content) {
      Alert.alert('Missing feedback', 'Please type your remark before submitting.');
      return;
    }

    setSubmittingFeedback(true);
    try {
      if (selectedItem.historyId) {
        await updateScanHistoryItem(selectedItem.historyId, (item) => ({
          ...item,
          remark: content,
        }));
        setHistoryRemarks((prev) => ({ ...prev, [selectedItem.historyId as string]: content }));
      }

      updateQueueItem(selectedItem.id, {
        feedback: content,
        feedbackSubmittedAt: new Date().toISOString(),
      });
      setFeedbackDraft(content);
      Alert.alert('Feedback submitted', 'Thank you for your feedback.');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const getMitigationsForSeverity = useCallback(async (
    severity: Severity,
    localCache: MitigationCache
  ): Promise<{ items: Mitigation[]; version: number; source: 'server' | 'cache' }> => {
    const cachedItems = localCache.items[severity] ?? [];
    const cachedVersion = localCache.versions[severity] ?? 0;

    try {
      const syncRes = await requestApi(`/api/mitigations/sync/${severity}`, {}, { requireOk: true, timeoutMs: 1400 });
      if (!syncRes.ok) throw new Error('Sync API unavailable');
      const data = (await syncRes.json()) as SyncResponse;

      const changed =
        data.version !== cachedVersion ||
        JSON.stringify(cachedItems) !== JSON.stringify(data.items);

      if (changed) {
        const nextCache: MitigationCache = {
          versions: { ...localCache.versions, [severity]: data.version },
          items: { ...localCache.items, [severity]: data.items },
        };
        await persistCache(nextCache);
      }

      return { items: data.items, version: data.version, source: 'server' };
    } catch {
      // Fallback path in case /sync route fails on a specific backend build.
      try {
        const [itemsRes, versionsRes] = await Promise.all([
          requestApi(`/api/mitigations/by-severity/${severity}`, {}, { requireOk: true, timeoutMs: 1400 }),
          requestApi('/api/mitigations/versions', {}, { requireOk: true, timeoutMs: 1400 }),
        ]);

        if (!itemsRes.ok || !versionsRes.ok) {
          throw new Error('Fallback API unavailable');
        }

        const items = (await itemsRes.json()) as Mitigation[];
        const versions = (await versionsRes.json()) as VersionsResponse;

        const version = versions.versions?.[severity]?.version ?? Math.max(1, cachedVersion);

        const changed =
          version !== cachedVersion || JSON.stringify(cachedItems) !== JSON.stringify(items);

        if (changed) {
          const nextCache: MitigationCache = {
            versions: { ...localCache.versions, [severity]: version },
            items: { ...localCache.items, [severity]: items },
          };
          await persistCache(nextCache);
        }

        return { items, version, source: 'server' };
      } catch {
        return { items: cachedItems, version: cachedVersion, source: 'cache' };
      }
    }
  }, [persistCache]);

  useEffect(() => {
    if (didWarmSyncRef.current) return;
    didWarmSyncRef.current = true;

    const warmSync = async () => {
      let workingCache = cache;

      for (const severity of ALL_SEVERITIES) {
        const data = await getMitigationsForSeverity(severity, workingCache);
        workingCache = {
          versions: { ...workingCache.versions, [severity]: data.version },
          items: { ...workingCache.items, [severity]: data.items },
        };
      }
    };

    void warmSync();
  }, [cache, getMitigationsForSeverity]);

  const analyzeAll = async () => {
    if (analyzing) return;

    const queueSnapshot = queue.filter((item) => item.status === 'queued');
    if (queueSnapshot.length === 0) return;

    const selectedFarmAtAnalyze = farms.find((f) => f.id === selectedFarmId) ?? null;
    if (!selectedFarmAtAnalyze) {
      Alert.alert('Farm required', 'Please select a farm first before analyzing the queue.');
      setShowFarmSelector(true);
      return;
    }
    const selectedFarmNameAtAnalyze = selectedFarmAtAnalyze?.farm_name ?? null;

    setAnalyzing(true);
    const mitigationLookup = new Map<
      Severity,
      Promise<{ items: Mitigation[]; version: number; source: 'server' | 'cache' }>
    >();

    for (const item of queueSnapshot) {
      updateQueueItem(item.id, {
        status: 'analyzing',
        error: undefined,
      });

      try {
        // Step 1: Run gatekeeper model to check if it's a banana
        const gatekeeperResult = await runGatekeeper(item.uri);
        
        updateQueueItem(item.id, {
          gatekeeperResult,
        });

        if (gatekeeperResult.label === 'Not Banana') {
          // Image is likely not a banana - mark for review
          updateQueueItem(item.id, {
            status: 'not-banana-review',
            farmId: selectedFarmAtAnalyze?.id ?? null,
            farmName: selectedFarmNameAtAnalyze,
          });
          continue;
        }

        // Step 2: If gatekeeper confirms banana, run Black Sigatoka analysis
        const result = await runTflite(item.uri);
        const severity = normalizeSeverity(result.label);
        if (!severity) {
          throw new Error(`Unsupported severity label: ${result.label}`);
        }

        const immediateMitigations =
          cache.items[severity] && cache.items[severity].length > 0
            ? cache.items[severity]
            : defaultMitigations[severity];
        const immediateVersion = Math.max(1, cache.versions[severity] ?? 1);

        updateQueueItem(item.id, {
          status: 'done',
          result,
          farmId: selectedFarmAtAnalyze?.id ?? null,
          farmName: selectedFarmNameAtAnalyze,
          mitigationsLoading: true,
        });

        if (!item.historyId) {
          try {
            const savedImageUri = await persistAnalyzedImage(item.uri);
            const historyId = `${item.id}-${Date.now()}`;
            await appendScanHistory({
              id: historyId,
              imageUri: savedImageUri,
              severity: result.label,
              mitigations: immediateMitigations.map((m) => ({
                title: m.title,
                description: m.instruction || m.description,
              })),
              scannedAt: new Date().toISOString(),
              mitigationVersion: immediateVersion,
              mitigationSource: 'cache',
              farmId: selectedFarmAtAnalyze?.id ?? undefined,
              farmName: selectedFarmNameAtAnalyze ?? undefined,
            });
            updateQueueItem(item.id, { historyId });
          } catch {
            // Do not fail the scan item when history persistence fails.
          }
        }

        void (async () => {
          try {
            const liveItem = queueRef.current.find((q) => q.id === item.id);
            if (!liveItem || liveItem.status === 'error') return;

            let mitigationPromise = mitigationLookup.get(severity);
            if (!mitigationPromise) {
              mitigationPromise = getMitigationsForSeverity(severity, cache);
              mitigationLookup.set(severity, mitigationPromise);
            }
            const mitigationData = await mitigationPromise;

            updateQueueItem(item.id, {
              mitigations: mitigationData.items,
              mitigationVersion: mitigationData.version,
              mitigationSource: mitigationData.source,
              mitigationsLoading: false,
            });
          } catch {
            updateQueueItem(item.id, { mitigationsLoading: false });
          }
        })();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Inference failed';
        updateQueueItem(item.id, { status: 'error', error: message });
      }
    }

    setAnalyzing(false);
  };

  if (cameraVisible) {
    const localRemaining = Math.max(0, remainingSlots - capturedUris.length);

    return (
      <View style={styles.cameraScreen}>
        <CameraView
          ref={(ref) => {
            cameraRef.current = ref;
          }}
          style={StyleSheet.absoluteFill}
          facing="back"
          flash={flashMode}
        />

        <Pressable
          style={styles.cameraBackButton}
          onPress={() => {
            setCapturedUris([]);
            setCameraVisible(false);
          }}
        >
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>

        <View style={styles.cameraTopBar}>
          <Pressable
            style={styles.flashButton}
            onPress={() => setFlashMode((prev) => (prev === 'off' ? 'on' : 'off'))}
          >
            <Text style={styles.flashButtonText}>{flashMode === 'on' ? 'Flash On' : 'Flash Off'}</Text>
          </Pressable>
        </View>

        <View style={styles.cameraBottomOverlay}>
          <View style={styles.cameraCounterRow}>
            <Text style={styles.cameraCounterText}>Captured {capturedUris.length}/10</Text>
            <Text style={styles.cameraCounterText}>Remaining {localRemaining}</Text>
          </View>

          <View style={styles.cameraControlRow}>
            <Pressable
              style={[styles.sideControlButton, capturedUris.length === 0 && styles.disabledButton]}
              onPress={finishCameraCapture}
              disabled={capturedUris.length === 0}
            >
              <Text style={styles.sideControlText}>Done</Text>
            </Pressable>

            <View style={styles.captureStack}>
              <View style={styles.capturedListWrap}>
                <FlatList
                  horizontal
                  data={capturedUris}
                  keyExtractor={(uri, idx) => `${uri}-${idx}`}
                  contentContainerStyle={styles.capturedListContent}
                  renderItem={({ item }) => (
                    <Image source={{ uri: item }} style={styles.capturedThumb} contentFit="cover" />
                  )}
                  ListEmptyComponent={<Text style={styles.emptyCapturedText}>No photos yet</Text>}
                  showsHorizontalScrollIndicator={false}
                />
              </View>

              <Pressable
                style={[styles.captureButton, localRemaining === 0 && styles.disabledButton]}
                onPress={() => void captureFromCamera()}
                disabled={localRemaining === 0}
              >
                <View style={styles.captureInner} />
              </Pressable>
            </View>

            <Pressable style={styles.galleryButton} onPress={() => void pickFromGalleryInCamera()}>
              <Text style={styles.galleryButtonText}>Gallery</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (selectedItem) {
    // Handle not-banana-review status with confirmation dialog
    if (selectedItem.status === 'not-banana-review') {
      return (
        <>
          <ScrollView contentContainerStyle={styles.detailContainer}>
            <Pressable style={styles.navBackButton} onPress={() => setSelectedItemId(null)}>
              <Ionicons name="arrow-back" size={20} color="#0f172a" />
            </Pressable>

            <Text style={styles.title}>Gatekeeper Review</Text>
            <Image source={{ uri: selectedItem.uri }} style={styles.detailImage} contentFit="cover" />

            <View style={styles.detailCard}>
              <Text style={styles.resultLabel}>Not a Banana Leaf Detected</Text>
              <Text style={styles.probText}>
                The gatekeeper model has detected a non-banana leaf image. Is this image a banana leaf?
              </Text>
              <Text style={styles.smallInfo}>
                Confidence: {((selectedItem.gatekeeperResult?.confidence ?? 0) * 100).toFixed(1)}%
              </Text>
            </View>

            <View style={styles.detailCard}>
              <Text style={styles.resultLabel}>What would you like to do?</Text>
              <Pressable
                style={[styles.button, styles.primary]}
                onPress={() => handleGatekeeperConfirmation(selectedItem.id, true)}
              >
                <Text style={styles.buttonText}>Yes, it is a banana image</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.secondary]}
                onPress={() => handleGatekeeperConfirmation(selectedItem.id, false)}
              >
                <Text style={styles.buttonText}>Not a banana image</Text>
              </Pressable>
            </View>
          </ScrollView>
        </>
      );
    }

    return (
      <>
        <ScrollView contentContainerStyle={styles.detailContainer}>
        <Pressable style={styles.navBackButton} onPress={() => setSelectedItemId(null)}>
          <Ionicons name="arrow-back" size={20} color="#0f172a" />
        </Pressable>

        <Text style={styles.title}>Scan Result</Text>
        <Image source={{ uri: selectedItem.uri }} style={styles.detailImage} contentFit="cover" />

        {selectedItem.result ? (
          <>
            <View style={styles.detailCard}>
              <Text style={styles.resultLabel}>Scan Result</Text>
              <View
                style={[
                  styles.resultBadge,
                  { backgroundColor: getSeverityColor(selectedItem.result.label) },
                ]}
              >
                <Text style={styles.resultBadgeText}>{selectedItem.result.label}</Text>
                <Text style={styles.resultBadgeConfidence}>
                  {`${(getResultConfidence(selectedItem.result) * 100).toFixed(1)}% Confidence.`}
                </Text>
              </View>
              <Text style={styles.smallInfo}>Saved to {selectedItem.farmName || 'Unassigned'}</Text>
            </View>

            <View style={styles.detailCard}>
              <Text style={styles.resultLabel}>Mitigation Recommendation</Text>
              {selectedItem.mitigationsLoading ? (
                <Text style={styles.probText}>Fetching recommended mitigation steps...</Text>
              ) : (selectedItem.mitigations ?? []).length === 0 ? (
                <Text style={styles.probText}>No mitigations available.</Text>
              ) : (
                selectedItem.mitigations?.map((m) => (
                  <View key={m.id} style={styles.mitigationItem}>
                    <Text style={styles.mitigationTitle}>{m.title}</Text>
                    <MitigationInstruction instruction={m.instruction || m.description} />
                  </View>
                ))
              )}
            </View>

            <View style={styles.detailCard}>
              <Text style={styles.resultLabel}>Remarks</Text>
              <TextInput
                value={feedbackDraft}
                onChangeText={setFeedbackDraft}
                placeholder="Share your feedback on this result..."
                multiline
                style={styles.remarksInput}
              />

              <Pressable
                style={[styles.button, styles.primary, submittingFeedback && styles.disabledButton]}
                disabled={submittingFeedback}
                onPress={submitFeedback}
              >
                {submittingFeedback ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Submit Feedback</Text>
                )}
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.detailCard}>
            <Text style={styles.probText}>No result for this image.</Text>
          </View>
        )}
        </ScrollView>
        <FarmSelectorModal
          visible={showFarmSelector}
          onClose={() => setShowFarmSelector(false)}
          onSelect={(farmId) => void setSelectedFarmId(farmId)}
          selectedFarmId={selectedFarmId}
        />
      </>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Scan Leaf</Text>
        <Text style={styles.subtitle}>Capture or select images, then analyze for Black Sigatoka severity.</Text>

        <View style={styles.queueHeader}>
          <Text style={styles.resultLabel}>Queue ({activeQueueItems.length}/{MAX_IMAGES})</Text>
          <Pressable
            style={styles.farmSelector}
            onPress={() => setShowFarmSelector(true)}
          >
            <Text style={styles.farmSelectorLabel}>
              {selectedFarmId && farms.length > 0
                ? `${farms.find((f) => f.id === selectedFarmId)?.farm_name || 'Unknown'}`
                : 'Select Farm'}
            </Text>
            <Ionicons name="chevron-down" size={14} color="#2e7d32" />
          </Pressable>
        </View>

        <View style={styles.queueScrollWrap}>
          {activeQueueItems.length === 0 ? (
            <View style={styles.resultCard}>
              <Text style={styles.probText}>No images queued yet.</Text>
            </View>
          ) : (
            <ScrollView style={styles.queueScroll} nestedScrollEnabled>
              <View style={styles.queueList}>
                {activeQueueItems.map((item) => (
                  <Pressable
                    key={item.id}
                    style={styles.card}
                    onPress={() => {
                      setSelectedItemId(item.id);
                      setFeedbackDraft(getEffectiveRemark(item));
                    }}
                  >
                    <Image source={{ uri: item.uri }} style={styles.preview} contentFit="cover" />

                    <View style={styles.cardBody}>
                      {item.status === 'queued' && (
                        <Animated.Text style={[styles.waitingText, { opacity: waitingOpacity }]}>Waiting for Results</Animated.Text>
                      )}
                      {item.status === 'analyzing' && <Text style={styles.smallInfo}>Analyzing...</Text>}
                      {item.status === 'not-banana-review' && (
                        <>
                          <Text style={styles.mitigationTitle}>Gatekeeper Review Needed</Text>
                          <Text style={styles.smallInfo}>Tap to confirm if this is a banana leaf.</Text>
                          <Text style={styles.smallInfo}>
                            Banana confidence: {((item.gatekeeperResult?.confidence ?? 0) * 100).toFixed(1)}%
                          </Text>
                        </>
                      )}
                      {item.status === 'error' && <Text style={[styles.smallInfo, styles.errorText]}>{item.error}</Text>}

                    </View>

                    <Pressable style={styles.deleteBtn} onPress={() => removeItem(item.id)}>
                      <Ionicons name="close" size={18} color="#fff" />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
        </View>

        <View style={styles.actionsWrap}>
          {hasQueuedItems && (
            <Pressable
              style={[styles.button, styles.analyzeAction, styles.analyzeButtonTop, analyzing && styles.disabledButton]}
              onPress={() => void analyzeAll()}
              disabled={analyzing}
            >
              {analyzing ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Analyze Queue</Text>}
            </Pressable>
          )}

          {!queueAtCapacity ? (
            <View style={styles.buttonRow}>
              <Pressable
                style={[styles.button, styles.primary, styles.actionButton]}
                onPress={() => void openCustomCamera()}
              >
                <Text style={styles.buttonText}>Scan Leaf</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.secondary, styles.actionButton]}
                onPress={pickFromGallery}
              >
                <Text style={styles.buttonTextSecondary}>Choose from Gallery</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.completedSection}>
          <View style={styles.completedHeaderRow}>
            <Text style={styles.resultLabel}>Completed Analysis ({completedItems.length})</Text>
            {completedItems.length > 0 && (
              <Pressable
                style={styles.clearAllBtn}
                onPress={clearAllCompleted}
              >
                <Text style={styles.clearAllBtnText}>Clear All</Text>
              </Pressable>
            )}
          </View>
          {completedItems.length === 0 ? (
            <View style={styles.resultCard}>
              <Text style={styles.probText}>No completed analysis yet.</Text>
            </View>
          ) : (
            <View style={styles.queueList}>
              {completedItems.map((item) => (
                <Pressable
                  key={item.id}
                  style={[
                    styles.card,
                    item.result ? { backgroundColor: getSeverityColor(item.result.label) } : null,
                  ]}
                  onPress={() => {
                    setSelectedItemId(item.id);
                    setFeedbackDraft(getEffectiveRemark(item));
                  }}
                >
                  <Image source={{ uri: item.uri }} style={styles.preview} contentFit="cover" />

                  <View style={styles.cardBody}>
                    {item.status === 'not-banana-review' ? (
                      <>
                        <Text style={styles.mitigationTitle}>Not a Banana Leaf</Text>
                        <Text style={styles.smallInfo}>Farm: {item.farmName || 'Unassigned'}</Text>
                        <Text style={styles.smallInfo}>
                          Gatekeeper confidence: {((item.gatekeeperResult?.confidence ?? 0) * 100).toFixed(1)}%
                        </Text>
                      </>
                    ) : item.result ? (
                      <>
                        <Text style={styles.completedSeverityText}>{item.result.label}</Text>
                        <Text style={styles.completedMetaText}>Saved to {item.farmName || 'Unassigned'}</Text>
                      </>
                    ) : (
                      <Text style={styles.smallInfo}>Result unavailable.</Text>
                    )}
                  </View>

                  <Pressable style={styles.deleteBtn} onPress={() => removeItem(item.id)}>
                    <Ionicons name="close" size={18} color="#fff" />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      <FarmSelectorModal
        visible={showFarmSelector}
        onClose={() => setShowFarmSelector(false)}
        onSelect={(farmId) => void setSelectedFarmId(farmId)}
        selectedFarmId={selectedFarmId}
      />
    </>
  );
}

const styles = StyleSheet.create({
  cameraScreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraTopBar: {
    position: 'absolute',
    top: 18,
    right: 16,
    zIndex: 3,
  },
  cameraBackButton: {
    position: 'absolute',
    top: 18,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ffffff55',
    backgroundColor: '#00000088',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  flashButton: {
    backgroundColor: '#00000088',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#ffffff55',
  },
  flashButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  cameraBottomOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    backgroundColor: '#00000088',
    gap: 12,
  },
  cameraCounterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cameraCounterText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  cameraControlRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 24,
  },
  captureStack: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
  },
  capturedListWrap: {
    width: '100%',
    minHeight: 64,
    maxHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff44',
    backgroundColor: '#00000055',
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  capturedListContent: {
    gap: 6,
    alignItems: 'center',
  },
  capturedThumb: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#334155',
  },
  emptyCapturedText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  captureButton: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff22',
  },
  sideControlButton: {
    minWidth: 84,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#165DFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideControlText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  captureInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#fff',
  },
  galleryButton: {
    minWidth: 84,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  container: {
    padding: 20,
    gap: 9,
    paddingBottom: 130,
  },
  detailContainer: {
    padding: 20,
    paddingBottom: 130,
    gap: 12,
  },
  navBackButton: {
    alignSelf: 'flex-start',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailImage: {
    width: '100%',
    height: 230,
    borderRadius: 14,
    backgroundColor: '#e5e7eb',
  },
  detailCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    padding: 12,
  },
  detailSeverity: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  resultBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 6,
  },
  resultBadgeText: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '900',
  },
  resultBadgeConfidence: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
    opacity: 0.95,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  actionsWrap: {
    gap: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'stretch',
  },
  analyzeButtonTop: {
    minHeight: 52,
  },
  analyzePlaceholder: {
    minHeight: 52,
  },
  actionButton: {
    flex: 1,
    minHeight: 52,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#2e7d32',
  },
  secondary: {
    borderWidth: 1,
    borderColor: '#2e7d32',
  },
  analyzeAction: {
    backgroundColor: '#111827',
  },
  buttonText: {
    color: '#ffffff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
    buttonTextSecondary: {
    color: '#2e7d32',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  farmSelector: {
    flexDirection: 'row',
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '45%',
    alignItems: 'center',
    gap: 4,
  },
  farmSelectorLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2e7d32',
  },
  disabledButton: {
    opacity: 0.5,
  },
  completedSection: {
    gap: 8,
    marginTop: 10,
  },
  completedHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#dc2626',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearAllBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  resultCard: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#fafafa',
  },
  resultLabel: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  queueList: {
    flexDirection: 'column',
    gap: 1,
  },
  queueScrollWrap: {
    maxHeight: 450,
    maxWidth: 500,
    borderRadius: 60,
  },
  queueScroll: {
    maxHeight: 500,
  },
  card: {
    width: '100%',
    borderWidth: 0,
    borderColor: '#ddd',
    borderRadius: 14,
    overflow: 'visible',
    backgroundColor: '#fff',
    marginBottom: 6,
    padding: 8,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  preview: {
    width: 80,
    height: 70,
    borderRadius: 9,
    backgroundColor: '#eee',
  },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#ff0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    minHeight: 54,
    justifyContent: 'center',
  },
  waitingText: {
    fontSize: 15,
    color: '#2563eb',
    fontWeight: '800',
  },
  mitigationItem: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  mitigationTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 4,
  },
  completedSeverityText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    marginBottom: 2,
  },
  completedMetaText: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '700',
  },
  probText: {
    fontSize: 14,
  },
  smallInfo: {
    fontSize: 12,
    color: '#6b7280',
  },
  errorText: {
    color: '#b91c1c',
  },
  remarksInput: {
    marginTop: 8,
    minHeight: 92,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    color: '#0f172a',
  },
  savedFeedbackText: {
    marginTop: 8,
    fontSize: 12,
    color: '#334155',
  },
  savedFeedbackBlock: {
    marginTop: 8,
    gap: 8,
  },
  editFeedbackBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#eff6ff',
  },
  editFeedbackBtnText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '700',
  },
});
