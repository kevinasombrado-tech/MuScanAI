import AsyncStorage from '@react-native-async-storage/async-storage';

import { type ScanHistoryItem } from '@/constants/scanHistory';

export type AppNotification = {
  id: string;
  type: 'missing-remark';
  title: string;
  message: string;
  createdAt: string;
  relatedScanId?: string;
};

const STORAGE_KEY = 'muscan.notifications.v1';

const toDisplayDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString();
};

export const readNotifications = async (): Promise<AppNotification[]> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
      .sort((a, b) => new Date(b.createdAt ?? '').getTime() - new Date(a.createdAt ?? '').getTime());
  } catch {
    return [];
  }
};

const writeNotifications = async (items: AppNotification[]): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
};

export const clearNotification = async (id: string): Promise<AppNotification[]> => {
  const current = await readNotifications();
  const next = current.filter((item) => item.id !== id);
  await writeNotifications(next);
  return next;
};

export const clearAllNotifications = async (): Promise<AppNotification[]> => {
  await writeNotifications([]);
  return [];
};

export const syncMissingRemarkNotifications = async (
  scans: ScanHistoryItem[]
): Promise<AppNotification[]> => {
  const current = await readNotifications();
  const missingRemarkScans = scans.filter((scan) => !(scan.remark ?? '').trim());

  const generated = missingRemarkScans.map((scan) => ({
    id: `missing-remark-${scan.id}`,
    type: 'missing-remark' as const,
    title: 'Scan needs a remark',
    message: `${scan.severity} scan from ${toDisplayDate(scan.scannedAt)} has no remark yet.`,
    createdAt: scan.scannedAt,
    relatedScanId: scan.id,
  }));

  const generatedIds = new Set(generated.map((item) => item.id));
  const keepManual = current.filter((item) => item.type !== 'missing-remark');
  const keepExistingMissing = current.filter(
    (item) => item.type === 'missing-remark' && generatedIds.has(item.id)
  );

  const existingIds = new Set(keepExistingMissing.map((item) => item.id));
  const newGenerated = generated.filter((item) => !existingIds.has(item.id));

  const next = [...keepManual, ...keepExistingMissing, ...newGenerated].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  await writeNotifications(next);
  return next;
};
