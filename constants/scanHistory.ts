import * as FileSystem from 'expo-file-system/legacy';

export type ScanMitigation = {
  title: string;
  description: string;
};

export type ScanHistoryItem = {
  id: string;
  imageUri: string;
  severity: string;
  mitigations: ScanMitigation[];
  scannedAt: string;
  mitigationVersion: number;
  mitigationSource: 'server' | 'cache';
  remark?: string;
  uploadedAt?: string | null;
  uploadStatus?: 'pending' | 'uploaded';
  farmId?: number | null;
  farmName?: string | null;
  gatekeeperVerified?: boolean; // true if user confirmed it's a banana after gatekeeper flagged as non-banana
};

const HISTORY_FILE = `${FileSystem.documentDirectory ?? ''}scan-history.json`;

const normalizeItem = (raw: unknown): ScanHistoryItem | null => {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;

  const mitigations = Array.isArray(rec.mitigations)
    ? rec.mitigations
        .map((m) => {
          if (!m || typeof m !== 'object') return null;
          const mm = m as Record<string, unknown>;
          const title = String(mm.title ?? '').trim();
          const description = String(mm.description ?? '').trim();
          if (!title || !description) return null;
          return { title, description };
        })
        .filter((m): m is ScanMitigation => !!m)
    : [];

  const id = String(rec.id ?? '').trim();
  const imageUri = String(rec.imageUri ?? '').trim();
  const severity = String(rec.severity ?? '').trim();
  const scannedAt = String(rec.scannedAt ?? '').trim();
  const mitigationVersion = Number(rec.mitigationVersion ?? 0);
  const mitigationSource = rec.mitigationSource === 'server' ? 'server' : 'cache';
  const remark = String(rec.remark ?? '').trim();
  const uploadedAt = rec.uploadedAt ? String(rec.uploadedAt) : null;
  const uploadStatus = rec.uploadStatus === 'uploaded' ? 'uploaded' : 'pending';
  const farmId = rec.farmId ? Number(rec.farmId) : null;
  const farmName = rec.farmName ? String(rec.farmName).trim() : null;
  const gatekeeperVerified = rec.gatekeeperVerified === true;

  if (!id || !imageUri || !severity || !scannedAt || mitigations.length === 0) {
    return null;
  }

  return {
    id,
    imageUri,
    severity,
    mitigations,
    scannedAt,
    mitigationVersion: Number.isFinite(mitigationVersion) ? Math.max(0, Math.floor(mitigationVersion)) : 0,
    mitigationSource,
    remark,
    uploadedAt,
    uploadStatus,
    farmId,
    farmName,
    gatekeeperVerified,
  };
};

const writeScanHistory = async (items: ScanHistoryItem[]): Promise<void> => {
  await FileSystem.writeAsStringAsync(HISTORY_FILE, JSON.stringify(items));
};

export const readScanHistory = async (): Promise<ScanHistoryItem[]> => {
  try {
    const info = await FileSystem.getInfoAsync(HISTORY_FILE);
    if (!info.exists) return [];

    const raw = await FileSystem.readAsStringAsync(HISTORY_FILE);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const items = parsed
      .map((item) => normalizeItem(item))
      .filter((item): item is ScanHistoryItem => !!item)
      .sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime());

    return items;
  } catch {
    return [];
  }
};

export const appendScanHistory = async (
  item: ScanHistoryItem,
  maxItems = 100
): Promise<ScanHistoryItem[]> => {
  const current = await readScanHistory();
  const next = [item, ...current]
    .sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime())
    .slice(0, maxItems);

  await writeScanHistory(next);
  return next;
};

export const deleteScanHistoryItem = async (id: string): Promise<ScanHistoryItem[]> => {
  const current = await readScanHistory();
  const next = current.filter((item) => item.id !== id);
  await writeScanHistory(next);
  return next;
};

export const updateScanHistoryItem = async (
  id: string,
  updater: (item: ScanHistoryItem) => ScanHistoryItem
): Promise<ScanHistoryItem[]> => {
  const current = await readScanHistory();
  const next = current.map((item) => (item.id === id ? updater(item) : item));
  await writeScanHistory(next);
  return next;
};

export const updateManyScanHistoryItems = async (
  ids: string[],
  updater: (item: ScanHistoryItem) => ScanHistoryItem
): Promise<ScanHistoryItem[]> => {
  const idSet = new Set(ids);
  const current = await readScanHistory();
  const next = current.map((item) => (idSet.has(item.id) ? updater(item) : item));
  await writeScanHistory(next);
  return next;
};

export const clearScanHistory = async (): Promise<void> => {
  await writeScanHistory([]);
};
