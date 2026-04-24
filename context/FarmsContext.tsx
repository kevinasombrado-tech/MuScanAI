import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { requestApi } from '@/constants/api';
import { useAuth } from './AuthContext';

export type Farm = {
  id: number;
  farm_name: string;
  farm_address: string;
  farmer_user_id: number;
  geotag_id: string;
  created_at: string;
  modified_at: string;
  farmer_name?: string;
  farmer_contact_number?: string;
};

type FarmsContextValue = {
  farms: Farm[];
  selectedFarmId: number | null;
  loading: boolean;
  error: string | null;
  setSelectedFarmId: (farmId: number | null) => void;
  refreshFarms: () => Promise<void>;
  createFarm: (farmName: string, farmAddress: string, geotagId: string) => Promise<Farm | null>;
  updateFarm: (farmId: number, farmName: string, farmAddress: string, geotagId: string) => Promise<Farm | null>;
  deleteFarm: (farmId: number) => Promise<boolean>;
};

const FarmsContext = createContext<FarmsContextValue | null>(null);

const SELECTED_FARM_KEY = 'muscan.selected_farm_id';

const readErrorMessage = async (res: Response): Promise<string> => {
  try {
    const raw = (await res.json()) as { detail?: unknown; message?: unknown };
    if (typeof raw.detail === 'string' && raw.detail.trim()) return raw.detail;
    if (Array.isArray(raw.detail) && raw.detail.length > 0) {
      const first = raw.detail[0] as { msg?: unknown };
      if (typeof first?.msg === 'string' && first.msg.trim()) return first.msg;
    }
    if (typeof raw.message === 'string' && raw.message.trim()) return raw.message;
    return `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
};

export function FarmsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [farms, setFarms] = useState<Farm[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load farms and selected farm on auth state change
  useEffect(() => {
    const initializeFarms = async () => {
      if (!auth || !auth.isAuthenticated || !auth.user) {
        setFarms([]);
        setSelectedFarmId(null);
        return;
      }

      await loadFarmsForUser(auth.user.id);
      await loadSelectedFarmId();
    };

    initializeFarms();
  }, [auth?.isAuthenticated, auth?.user?.id]);

  const loadFarmsForUser = async (userId: number) => {
    try {
      setLoading(true);
      setError(null);
      const res = await requestApi(`/api/farms/current-user/${userId}`, { method: 'GET' });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      const data = (await res.json()) as Farm[];
      setFarms(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load farms');
      setFarms([]);
    } finally {
      setLoading(false);
    }
  };

  const loadSelectedFarmId = async () => {
    try {
      const stored = await AsyncStorage.getItem(SELECTED_FARM_KEY);
      if (stored) {
        setSelectedFarmId(Number(stored));
      }
    } catch {
      // Ignore storage errors
    }
  };

  const updateSelectedFarmId = async (farmId: number | null) => {
    setSelectedFarmId(farmId);
    if (farmId === null) {
      try {
        await AsyncStorage.removeItem(SELECTED_FARM_KEY);
      } catch {
        // Ignore storage errors
      }
    } else {
      try {
        await AsyncStorage.setItem(SELECTED_FARM_KEY, String(farmId));
      } catch {
        // Ignore storage errors
      }
    }
  };

  const refreshFarms = async () => {
    if (!auth?.user) return;
    await loadFarmsForUser(auth.user.id);
  };

  const createFarm = async (farmName: string, farmAddress: string, geotagId: string): Promise<Farm | null> => {
    if (!auth?.user) return null;

    try {
      setError(null);
      const res = await requestApi('/api/farms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farm_name: farmName,
          farm_address: farmAddress,
          farmer_user_id: auth.user.id,
          geotag_id: geotagId,
          actor_role: auth.user.role,
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }

      const newFarm = (await res.json()) as Farm;
      setFarms((prev) => [newFarm, ...prev.filter((f) => f.id !== newFarm.id)]);
      return newFarm;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create farm';
      setError(msg);
      return null;
    }
  };

  const updateFarm = async (
    farmId: number,
    farmName: string,
    farmAddress: string,
    geotagId: string
  ): Promise<Farm | null> => {
    if (!auth?.user) return null;

    try {
      setError(null);
      const res = await requestApi(`/api/farms/${farmId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farm_name: farmName,
          farm_address: farmAddress,
          farmer_user_id: auth.user.id,
          geotag_id: geotagId,
          actor_role: auth.user.role,
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }

      const updatedFarm = (await res.json()) as Farm;
      setFarms((prev) => {
        const mapped = prev.map((f) => (f.id === farmId ? updatedFarm : f));
        const seen = new Set<number>();
        return mapped.filter((f) => {
          if (seen.has(f.id)) return false;
          seen.add(f.id);
          return true;
        });
      });
      return updatedFarm;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update farm';
      setError(msg);
      return null;
    }
  };

  const deleteFarm = async (farmId: number): Promise<boolean> => {
    if (!auth?.user) return false;

    try {
      setError(null);
      const res = await requestApi(`/api/farms/${farmId}?actor_role=${encodeURIComponent(auth.user.role)}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }

      const result = (await res.json()) as { deleted?: boolean };
      if (result.deleted === true) {
        setFarms((prev) => prev.filter((f) => f.id !== farmId));
        if (selectedFarmId === farmId) {
          await updateSelectedFarmId(null);
        }
        return true;
      }
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete farm';
      setError(msg);
      return false;
    }
  };

  const value: FarmsContextValue = {
    farms,
    selectedFarmId,
    loading,
    error,
    setSelectedFarmId: updateSelectedFarmId,
    refreshFarms,
    createFarm,
    updateFarm,
    deleteFarm,
  };

  return <FarmsContext.Provider value={value}>{children}</FarmsContext.Provider>;
}

export function useFarms(): FarmsContextValue {
  const context = useContext(FarmsContext);
  if (!context) {
    throw new Error('useFarms must be used within FarmsProvider');
  }
  return context;
}
