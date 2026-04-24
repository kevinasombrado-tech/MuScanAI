import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { useAuth } from '@/context/AuthContext';
import { requestApi } from '@/constants/api';
import { readScanHistory, type ScanHistoryItem } from '@/constants/scanHistory';
import {
  clearNotification,
  readNotifications,
  syncMissingRemarkNotifications,
  type AppNotification,
} from '@/constants/notifications';
import HapticPressable from '@/components/HapticPressable';

const Pressable = HapticPressable;

type LibraryItem = {
  id: number;
  title: string;
  body: string;
  image: string;
};

type HomeView = 'home' | 'notifications';

type LibrarySyncResponse = {
  items: LibraryItem[];
};

const stripHtml = (value: string): string =>
  String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const BANNER_HEIGHT = 230;
const SCAN_CARD_HEIGHT = 130;
const RECENT_CARD_HEIGHT = 290;

async function fetchLibraryItems(): Promise<LibraryItem[]> {
  const res = await requestApi('/api/library/sync', {}, { requireOk: true, timeoutMs: 1400 });
  const data = (await res.json()) as LibrarySyncResponse;
  return Array.isArray(data.items) ? data.items : [];
}

const formatScanTime = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Unknown time';
  return parsed.toLocaleString();
};

const initialFromName = (name: string | undefined): string => {
  const clean = (name ?? '').trim();
  if (!clean) return 'F';
  return clean.charAt(0).toUpperCase();
};

export default function HomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [recentScans, setRecentScans] = useState<ScanHistoryItem[]>([]);
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [homeView, setHomeView] = useState<HomeView>('home');
  const [bannerWidth, setBannerWidth] = useState(0);
  const slideOffset = useState(() => new Animated.Value(0))[0];
  const isSlidingRef = useRef(false);

  const loadLibraryData = useCallback(async () => {
    const items = await fetchLibraryItems();
    setLibraryItems(items);
    setBannerIndex((prev) => {
      if (items.length === 0) return 0;
      return Math.min(prev, items.length - 1);
    });
  }, []);

  const loadRecentScans = useCallback(async () => {
    const scans = await readScanHistory();
    setRecentScans(scans.slice(0, 12));
    setScanHistory(scans);
    const synced = await syncMissingRemarkNotifications(scans);
    setNotifications(synced);
  }, []);

  const loadNotifications = useCallback(async () => {
    const items = await readNotifications();
    setNotifications(items);
  }, []);

  useEffect(() => {
    void loadLibraryData();
    void loadRecentScans();
    void loadNotifications();
  }, [loadLibraryData, loadNotifications, loadRecentScans]);

  useFocusEffect(
    useCallback(() => {
      void loadLibraryData();
      void loadRecentScans();
      void loadNotifications();
    }, [loadLibraryData, loadNotifications, loadRecentScans])
  );

  useEffect(() => {
    const unsub = (navigation as any).addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      setHomeView('home');
    });
    return unsub;
  }, [navigation]);

  const advanceBanner = useCallback(() => {
    if (libraryItems.length <= 1) return;
    if (isSlidingRef.current) return;

    if (bannerWidth <= 0) {
      setBannerIndex((prev) => (prev + 1) % libraryItems.length);
      return;
    }

    isSlidingRef.current = true;
    slideOffset.setValue(0);

    Animated.timing(slideOffset, {
      toValue: -bannerWidth,
      duration: 360,
      useNativeDriver: true,
    }).start(() => {
      setBannerIndex((prev) => (prev + 1) % libraryItems.length);
      slideOffset.setValue(0);
      isSlidingRef.current = false;
    });
  }, [bannerWidth, libraryItems.length, slideOffset]);

  useEffect(() => {
    if (libraryItems.length <= 1) return;
    const timer = setInterval(() => {
      advanceBanner();
    }, 5000);
    return () => clearInterval(timer);
  }, [advanceBanner, libraryItems.length]);

  const activeBannerItem = useMemo(() => {
    if (libraryItems.length === 0) return null;
    return libraryItems[bannerIndex % libraryItems.length] ?? null;
  }, [bannerIndex, libraryItems]);

  const nextBannerItem = useMemo(() => {
    if (libraryItems.length === 0) return null;
    if (libraryItems.length === 1) return libraryItems[0] ?? null;
    return libraryItems[(bannerIndex + 1) % libraryItems.length] ?? null;
  }, [bannerIndex, libraryItems]);

  const pendingRemarkNotifications = useMemo(
    () => notifications.filter((item) => item.type === 'missing-remark'),
    [notifications]
  );

  const alertNotifications = useMemo(
    () => notifications.filter((item) => item.type !== 'missing-remark'),
    [notifications]
  );

  const openNotification = useCallback(
    (item: AppNotification) => {
      if (item.type === 'missing-remark' && item.relatedScanId) {
        setHomeView('home');
        router.push({
          pathname: '/(tabs)/library',
          params: { section: 'history', historyId: item.relatedScanId },
        });
        return;
      }

      // Fallback: open history tab even when no linked scan id is present.
      setHomeView('home');
      router.push({
        pathname: '/(tabs)/library',
        params: { section: 'history' },
      });
    },
    [router]
  );

  if (homeView === 'notifications') {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.subpageHeaderRow}>
            <Pressable
              style={styles.backBtn}
              onPress={() => {
                setHomeView('home');
              }}
            >
              <Ionicons name="arrow-back" size={18} color="#0f172a" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.heading}>Notifications</Text>
              <Text style={styles.subheading}>Tap a remark reminder to open its scan result directly.</Text>
            </View>
          </View>

          <View style={styles.notificationsHeroCard}>
            <View style={styles.notificationsHeroTopRow}>
              <View>
                <Text style={styles.notificationsEyebrow}>Action needed</Text>
                <Text style={styles.notificationsHeroTitle}>Scan reminders</Text>
              </View>
              <View style={styles.notificationsHeroBadge}>
                <Text style={styles.notificationsHeroBadgeText}>{notifications.length}</Text>
              </View>
            </View>
            <Text style={styles.notificationsHeroText}>
              Review scan results that still need a remark, or clear general alerts when you’re done.
            </Text>
            <View style={styles.notificationsStatsRow}>
              <View style={styles.notificationsStatCard}>
                <Text style={styles.notificationsStatValue}>{pendingRemarkNotifications.length}</Text>
                <Text style={styles.notificationsStatLabel}>Need remarks</Text>
              </View>
              <View style={styles.notificationsStatCard}>
                <Text style={styles.notificationsStatValue}>{alertNotifications.length}</Text>
                <Text style={styles.notificationsStatLabel}>Other alerts</Text>
              </View>
            </View>
          </View>

          {notifications.length === 0 ? (
            <View style={styles.centerBlock}>
              <Text style={styles.centerText}>No notifications.</Text>
            </View>
          ) : (
            <View style={styles.notificationsList}>
              {notifications.map((item) => {
              const isPressable = item.type === 'missing-remark' && !!item.relatedScanId;
              const relatedScan = isPressable
                ? scanHistory.find((scan) => scan.id === item.relatedScanId) ?? null
                : null;
              const Container = isPressable ? Pressable : View;
              return (
                <Container
                  key={item.id}
                  style={[
                    styles.notificationCard,
                    isPressable && styles.notificationCardPressable,
                  ]}
                  {...(isPressable
                    ? {
                        onPress: () => openNotification(item),
                      }
                    : {})}
                >
                  {relatedScan ? (
                    <Image source={{ uri: relatedScan.imageUri }} style={styles.notificationCardImage} contentFit="cover" />
                  ) : (
                    <View style={styles.notificationCardIconWrap}>
                      <Ionicons name="notifications-outline" size={18} color="#2563eb" />
                    </View>
                  )}

                  <View style={styles.notificationCardBody}>
                    <Text style={styles.notificationItemTitle}>{item.title}</Text>
                    <Text style={styles.notificationItemMsg} numberOfLines={2}>{item.message}</Text>
                    {relatedScan ? (
                      <View style={styles.notificationPillRow}>
                        <View style={styles.notificationSeverityPill}>
                          <Text style={styles.notificationSeverityPillText}>{relatedScan.severity}</Text>
                        </View>
                        <Text style={styles.notificationScanMeta} numberOfLines={1}>
                          {new Date(relatedScan.scannedAt).toLocaleDateString()}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {isPressable ? (
                    <Ionicons name="chevron-forward" size={18} color="#64748b" />
                  ) : (
                    <Pressable
                      onPress={async () => {
                        const next = await clearNotification(item.id);
                        setNotifications(next);
                      }}
                    >
                      <Ionicons name="close-circle-outline" size={20} color="#64748b" />
                    </Pressable>
                  )}
                </Container>
              );
            })}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <Pressable style={styles.profileWrap} onPress={() => router.push('/(tabs)/profile')}>
          {user?.profile_image ? (
            <Image source={{ uri: user.profile_image }} style={styles.profileAvatarImage} contentFit="cover" />
          ) : (
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>{initialFromName(user?.name)}</Text>
            </View>
          )}
          <View>
            <Text style={styles.profileName}>{user?.name ?? 'Farmer'}</Text>
            <Text style={styles.welcomeText}>Welcome Back</Text>
          </View>
        </Pressable>

        <Pressable style={styles.notificationBtn} onPress={() => setHomeView('notifications')}>
          <Ionicons name="notifications-outline" size={22} color="#1f2937" />
          {notifications.length > 0 ? (
            <View style={styles.notificationBadge}>
              <Text style={styles.notificationBadgeText}>{notifications.length > 99 ? '99+' : notifications.length}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <Pressable
        style={[styles.sectionCard, { minHeight: BANNER_HEIGHT }]}
        onLayout={(e) => {
          const width = Math.round(e.nativeEvent.layout.width);
          if (width > 0 && width !== bannerWidth) {
            setBannerWidth(width);
          }
        }}
        onPress={() => {
          if (!activeBannerItem) return;
          router.push({
            pathname: '/(tabs)/library',
            params: { section: 'library', entryId: String(activeBannerItem.id) },
          });
        }}
      >
        {activeBannerItem ? (
          <View style={styles.bannerViewport}>
            <Animated.View
              style={[
                styles.bannerTrack,
                {
                  transform: [{ translateX: slideOffset }],
                },
              ]}
            >
              <View style={styles.bannerSlide}>
                <Image source={{ uri: activeBannerItem.image }} style={styles.bannerImage} contentFit="cover" />
                <View style={styles.bannerOverlay}>
                  <Text style={styles.bannerTitle} numberOfLines={1}>{activeBannerItem.title}</Text>
                  <Text style={styles.bannerBody} numberOfLines={2}>{stripHtml(activeBannerItem.body)}</Text>
                  <Text style={styles.bannerHint}>Carousel preview • Tap to open</Text>
                </View>
              </View>

              {nextBannerItem ? (
                <View style={styles.bannerSlide}>
                  <Image source={{ uri: nextBannerItem.image }} style={styles.bannerImage} contentFit="cover" />
                  <View style={styles.bannerOverlay}>
                    <Text style={styles.bannerTitle} numberOfLines={1}>{nextBannerItem.title}</Text>
                    <Text style={styles.bannerBody} numberOfLines={2}>{stripHtml(nextBannerItem.body)}</Text>
                    <Text style={styles.bannerHint}>Carousel preview • Tap to open</Text>
                  </View>
                </View>
              ) : null}
            </Animated.View>
          </View>
        ) : (
          <View style={styles.emptyBanner}>
            <Text style={styles.emptyBannerTitle}>No Latest News</Text>
            <Text style={styles.emptyBannerText}>Catch the latest banana news here!</Text>
          </View>
        )}
      </Pressable>

      <View style={[styles.sectionCard, styles.scanCard, { minHeight: SCAN_CARD_HEIGHT }]}> 
        <Text style={styles.scanCardTitle}>Ready to scan a new leaf?</Text>
        <Pressable
          style={styles.scanButton}
          onPress={() =>
            router.push({
              pathname: '/(tabs)/scan',
              params: { autoOpen: 'camera' },
            })
          }
        >
          <Text style={styles.scanButtonText}>Scan Now</Text>
        </Pressable>
      </View>

      <View style={[styles.sectionCard, styles.recentCard, { minHeight: RECENT_CARD_HEIGHT }]}> 
        <View style={styles.recentHeader}>
          <Text style={styles.recentTitle}>Recent Scans</Text>
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/(tabs)/library',
                params: { section: 'history' },
              })
            }
          >
            <Text style={styles.recentAction}>View all</Text>
          </Pressable>
        </View>

        {recentScans.length === 0 ? (
          <View style={styles.emptyRecentWrap}>
            <Text style={styles.emptyRecentText}>No recent scans yet.</Text>
          </View>
        ) : (
          <ScrollView style={styles.recentList} nestedScrollEnabled>
            {recentScans.map((scan) => (
              <View key={scan.id} style={styles.recentRow}>
                <Image source={{ uri: scan.imageUri }} style={styles.recentImage} contentFit="cover" />
                <View style={styles.recentMeta}>
                  <Text style={styles.recentSeverity}>{scan.severity}</Text>
                  <Text style={styles.recentTime} numberOfLines={1}>{formatScanTime(scan.scannedAt)}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 11,
    paddingTop: 20,
    paddingBottom: 130,
    gap: 9,
    backgroundColor: '#f7f8fa',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  profileWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#cbd5e1',
  },
  profileAvatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
  },
  profileName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  welcomeText: {
    marginTop: 1,
    fontSize: 13,
    color: '#64748b',
  },
  notificationBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e2e8f0',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  notificationsHeroCard: {
    borderRadius: 18,
    backgroundColor: '#0f172a',
    padding: 16,
    gap: 12,
  },
  notificationsHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  notificationsEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    color: '#93c5fd',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  notificationsHeroTitle: {
    marginTop: 4,
    fontSize: 22,
    fontWeight: '900',
    color: '#fff',
  },
  notificationsHeroText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#dbeafe',
  },
  notificationsHeroBadge: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  notificationsHeroBadgeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  notificationsStatsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  notificationsStatCard: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 4,
  },
  notificationsStatValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
  },
  notificationsStatLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#cbd5e1',
  },
  notificationsList: {
    gap: 10,
  },
  notificationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    padding: 12,
  },
  notificationCardPressable: {
    borderColor: '#bfdbfe',
    backgroundColor: '#f8fbff',
  },
  notificationCardImage: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
  },
  notificationCardIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationCardBody: {
    flex: 1,
    gap: 3,
  },
  notificationPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  notificationSeverityPill: {
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  notificationSeverityPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0f172a',
  },
  notificationScanMeta: {
    flex: 1,
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  notificationEmpty: {
    fontSize: 13,
    color: '#64748b',
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 8,
  },
  notificationItemTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  notificationItemMsg: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  subpageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCard: {
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  bannerImage: {
    width: '100%',
    height: BANNER_HEIGHT,
    backgroundColor: '#dbeafe',
  },
  bannerViewport: {
    width: '100%',
    height: BANNER_HEIGHT,
    overflow: 'hidden',
  },
  bannerTrack: {
    width: '200%',
    height: BANNER_HEIGHT,
    flexDirection: 'row',
  },
  bannerSlide: {
    width: '50%',
    height: BANNER_HEIGHT,
  },
  bannerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#0f172abf',
    gap: 2,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
  bannerBody: {
    fontSize: 13,
    color: '#e2e8f0',
  },
  bannerHint: {
    fontSize: 11,
    color: '#bfdbfe',
  },
  emptyBanner: {
    minHeight: BANNER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  emptyBannerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1f2937',
  },
  emptyBannerText: {
    marginTop: 4,
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  scanCard: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'space-between',
  },
  scanCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 10,
  },
  scanButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  recentCard: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  recentTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  recentAction: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563eb',
  },
  emptyRecentWrap: {
    flex: 1,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRecentText: {
    fontSize: 14,
    color: '#64748b',
  },
  recentList: {
    maxHeight: RECENT_CARD_HEIGHT - 58,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  recentImage: {
    width: 58,
    height: 58,
    borderRadius: 12,
    backgroundColor: '#e5e7eb',
  },
  recentMeta: {
    flex: 1,
    gap: 3,
  },
  recentSeverity: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  recentTime: {
    fontSize: 12,
    color: '#6b7280',
  },
});
