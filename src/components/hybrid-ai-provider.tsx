'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { doc } from 'firebase/firestore';
import {
  useFirebaseApp,
  useFirestore,
  useUser,
  useDoc,
  useMemoFirebase,
  ensureFirebaseAppCheck,
  getCfoRemoteConfigSnapshot,
  syncCfoRemoteConfig,
  type AppCheckTelemetry,
  type CfoRemoteConfigValues,
} from '@/firebase';
import { healthService, type UserPreferences } from '@/lib/health-service';
import {
  probeLocalNanoAvailability,
  warmLocalNanoEngine,
  type HybridExecutionReceipt,
  type LocalNanoStatus,
} from '@/lib/hybrid-ai';

const SEC_LOCK_STORAGE_KEY = 'cfo_sec_privacy_lock';

export interface HybridAiContextValue {
  nanoStatus: LocalNanoStatus;
  isWarmingNano: boolean;
  nanoDownloadPct: number | null;
  warmNanoError: string | null;
  warmNano: () => Promise<void>;
  refreshNanoStatus: () => Promise<void>;
  isOnline: boolean;
  secPrivacyLock: boolean;
  setSecPrivacyLock: (locked: boolean) => void;
  remoteConfig: CfoRemoteConfigValues;
  appCheck: AppCheckTelemetry;
  recentReceipts: HybridExecutionReceipt[];
  recordReceipt: (receipt: HybridExecutionReceipt) => void;
  earningsModalOpen: boolean;
  setEarningsModalOpen: (open: boolean) => void;
}

const HybridAiContext = createContext<HybridAiContextValue | undefined>(undefined);

export function HybridAiProvider({ children }: { children: React.ReactNode }) {
  const firebaseApp = useFirebaseApp();
  const db = useFirestore();
  const { user } = useUser();

  const prefsRef = useMemoFirebase(
    () => (user ? doc(db, 'users', user.uid, 'preferences', 'settings') : null),
    [db, user]
  );
  const { data: prefs } = useDoc<UserPreferences>(prefsRef);

  const [nanoStatus, setNanoStatus] = useState<LocalNanoStatus>('unavailable');
  const [isWarmingNano, setIsWarmingNano] = useState(false);
  const [nanoDownloadPct, setNanoDownloadPct] = useState<number | null>(null);
  const [warmNanoError, setWarmNanoError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [secPrivacyLock, setSecPrivacyLockState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SEC_LOCK_STORAGE_KEY) === 'true';
  });
  const [remoteConfig, setRemoteConfig] = useState<CfoRemoteConfigValues>(() =>
    getCfoRemoteConfigSnapshot(firebaseApp)
  );
  const [appCheck, setAppCheck] = useState<AppCheckTelemetry>(() =>
    ensureFirebaseAppCheck(firebaseApp)
  );
  const [recentReceipts, setRecentReceipts] = useState<HybridExecutionReceipt[]>([]);
  const [earningsModalOpen, setEarningsModalOpen] = useState(false);

  // Initialize App Check, sync Remote Config, and passively probe Chrome Prompt API availability
  useEffect(() => {
    setAppCheck(ensureFirebaseAppCheck(firebaseApp));
    setRemoteConfig(getCfoRemoteConfigSnapshot(firebaseApp));

    let cancelled = false;
    syncCfoRemoteConfig(firebaseApp).then((vals) => {
      if (!cancelled) setRemoteConfig(vals);
    });
    probeLocalNanoAvailability().then((status) => {
      if (!cancelled) setNanoStatus(status);
    });

    return () => {
      cancelled = true;
    };
  }, [firebaseApp]);

  // Keep network status reactive and re-sync Remote Config when returning online
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => {
      setIsOnline(true);
      syncCfoRemoteConfig(firebaseApp).then((vals) => setRemoteConfig(vals));
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [firebaseApp]);

  // Hydrate SEC Privacy Lock from Firestore preferences if explicitly stored
  useEffect(() => {
    if (typeof prefs?.secPrivacyLock === 'boolean') {
      setSecPrivacyLockState(prefs.secPrivacyLock);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SEC_LOCK_STORAGE_KEY, String(prefs.secPrivacyLock));
      }
    }
  }, [prefs?.secPrivacyLock]);

  const setSecPrivacyLock = useCallback(
    (locked: boolean) => {
      setSecPrivacyLockState(locked);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SEC_LOCK_STORAGE_KEY, String(locked));
      }
      if (user) {
        healthService
          .updateUserPreferences(db, user.uid, { secPrivacyLock: locked })
          .catch(() => {});
      }
    },
    [db, user]
  );

  const refreshNanoStatus = useCallback(async () => {
    const status = await probeLocalNanoAvailability();
    setNanoStatus(status);
  }, []);

  // Triggered strictly from 1-click user interaction
  const warmNano = useCallback(async () => {
    setIsWarmingNano(true);
    setWarmNanoError(null);
    setNanoDownloadPct(0);
    setNanoStatus('downloading');
    try {
      const nextStatus = await warmLocalNanoEngine(firebaseApp, (pct) => {
        setNanoDownloadPct(pct);
      });
      setNanoStatus(nextStatus === 'unavailable' ? 'available' : nextStatus);
      setNanoDownloadPct(100);
    } catch (err) {
      const status = await probeLocalNanoAvailability();
      setNanoStatus(status);
      setWarmNanoError(
        err instanceof Error
          ? err.message
          : 'Enable Chrome Built-in AI flags (`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`) to run Gemini Nano locally.'
      );
    } finally {
      setIsWarmingNano(false);
    }
  }, [firebaseApp]);

  const recordReceipt = useCallback((receipt: HybridExecutionReceipt) => {
    setRecentReceipts((prev) => [receipt, ...prev].slice(0, 20));
    if (receipt.inferenceSource === 'ON_DEVICE') {
      setNanoStatus('available');
    }
  }, []);

  const value = useMemo<HybridAiContextValue>(
    () => ({
      nanoStatus,
      isWarmingNano,
      nanoDownloadPct,
      warmNanoError,
      warmNano,
      refreshNanoStatus,
      isOnline,
      secPrivacyLock,
      setSecPrivacyLock,
      remoteConfig,
      appCheck,
      recentReceipts,
      recordReceipt,
      earningsModalOpen,
      setEarningsModalOpen,
    }),
    [
      nanoStatus,
      isWarmingNano,
      nanoDownloadPct,
      warmNanoError,
      warmNano,
      refreshNanoStatus,
      isOnline,
      secPrivacyLock,
      setSecPrivacyLock,
      remoteConfig,
      appCheck,
      recentReceipts,
      recordReceipt,
      earningsModalOpen,
    ]
  );

  return <HybridAiContext.Provider value={value}>{children}</HybridAiContext.Provider>;
}

export function useHybridAi(): HybridAiContextValue {
  const ctx = useContext(HybridAiContext);
  if (!ctx) {
    throw new Error('useHybridAi must be used within a HybridAiProvider.');
  }
  return ctx;
}
