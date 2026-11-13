'use client';

import type { FirebaseApp } from 'firebase/app';
import {
  getRemoteConfig,
  fetchAndActivate,
  getValue,
  isSupported,
  type RemoteConfig,
} from 'firebase/remote-config';

export type CfoPersonaStrictness = 'ruthless_wall_street' | 'balanced_advisor';
export type HybridDefaultModeKey =
  | 'PREFER_ON_DEVICE'
  | 'ONLY_ON_DEVICE'
  | 'PREFER_IN_CLOUD'
  | 'ONLY_IN_CLOUD';

export interface CfoRemoteConfigValues {
  cfoCloudModel: string;
  cfoPersonaStrictness: CfoPersonaStrictness;
  hybridDefaultMode: HybridDefaultModeKey;
  source: 'default' | 'remote' | 'static';
  lastSyncedAt: number | null;
}

export const CFO_REMOTE_CONFIG_DEFAULTS = {
  cfo_cloud_model: 'gemini-3.8-flash',
  cfo_persona_strictness: 'ruthless_wall_street',
  hybrid_default_mode: 'PREFER_ON_DEVICE',
} as const;

let rcInstance: RemoteConfig | null = null;
let lastSyncedAtMs: number | null = null;
let syncPromise: Promise<CfoRemoteConfigValues> | null = null;

/**
 * Enforces the #BuildHybridAI model rule: never allow retired gemini-2.0-*
 * model IDs even if stale cache or misconfigured remote parameters exist.
 */
export function sanitizeCloudModelName(rawModel?: string | null): string {
  const trimmed = (rawModel || '').trim();
  if (!trimmed || /^gemini-2\.0/i.test(trimmed) || /^gemini-1\./i.test(trimmed)) {
    return CFO_REMOTE_CONFIG_DEFAULTS.cfo_cloud_model;
  }
  return trimmed;
}

function normalizePersonaStrictness(raw?: string | null): CfoPersonaStrictness {
  if (raw === 'balanced_advisor') return 'balanced_advisor';
  return 'ruthless_wall_street';
}

function normalizeHybridMode(raw?: string | null): HybridDefaultModeKey {
  const upper = (raw || '').trim().toUpperCase();
  if (
    upper === 'PREFER_ON_DEVICE' ||
    upper === 'ONLY_ON_DEVICE' ||
    upper === 'PREFER_IN_CLOUD' ||
    upper === 'ONLY_IN_CLOUD'
  ) {
    return upper;
  }
  return 'PREFER_ON_DEVICE';
}

export function getOrInitRemoteConfig(firebaseApp: FirebaseApp): RemoteConfig | null {
  if (typeof window === 'undefined') return null;
  if (rcInstance) return rcInstance;

  try {
    const rc = getRemoteConfig(firebaseApp);
    rc.defaultConfig = { ...CFO_REMOTE_CONFIG_DEFAULTS };
    rc.settings = {
      fetchTimeoutMillis: 8_000,
      minimumFetchIntervalMillis:
        process.env.NODE_ENV === 'production' ? 3_600_000 : 60_000,
    };
    rcInstance = rc;
    return rc;
  } catch (err) {
    console.warn('[RemoteConfig] Initialization fallback to defaults:', err);
    return null;
  }
}

export function getCfoRemoteConfigSnapshot(
  firebaseApp?: FirebaseApp | null
): CfoRemoteConfigValues {
  if (typeof window === 'undefined' || !firebaseApp) {
    return {
      cfoCloudModel: CFO_REMOTE_CONFIG_DEFAULTS.cfo_cloud_model,
      cfoPersonaStrictness: CFO_REMOTE_CONFIG_DEFAULTS.cfo_persona_strictness,
      hybridDefaultMode: CFO_REMOTE_CONFIG_DEFAULTS.hybrid_default_mode,
      source: 'default',
      lastSyncedAt: null,
    };
  }

  const rc = getOrInitRemoteConfig(firebaseApp);
  if (!rc) {
    return {
      cfoCloudModel: CFO_REMOTE_CONFIG_DEFAULTS.cfo_cloud_model,
      cfoPersonaStrictness: CFO_REMOTE_CONFIG_DEFAULTS.cfo_persona_strictness,
      hybridDefaultMode: CFO_REMOTE_CONFIG_DEFAULTS.hybrid_default_mode,
      source: 'default',
      lastSyncedAt: lastSyncedAtMs,
    };
  }

  const modelVal = getValue(rc, 'cfo_cloud_model');
  const personaVal = getValue(rc, 'cfo_persona_strictness');
  const modeVal = getValue(rc, 'hybrid_default_mode');

  const source =
    modelVal.getSource() === 'remote' ||
    personaVal.getSource() === 'remote' ||
    modeVal.getSource() === 'remote'
      ? 'remote'
      : 'default';

  return {
    cfoCloudModel: sanitizeCloudModelName(modelVal.asString()),
    cfoPersonaStrictness: normalizePersonaStrictness(personaVal.asString()),
    hybridDefaultMode: normalizeHybridMode(modeVal.asString()),
    source,
    lastSyncedAt: lastSyncedAtMs,
  };
}

/**
 * Non-blocking Remote Config fetch & activate. Safe when browser is offline
 * (falls back instantaneously to cached / in-app defaultConfig).
 */
export async function syncCfoRemoteConfig(
  firebaseApp: FirebaseApp
): Promise<CfoRemoteConfigValues> {
  if (typeof window === 'undefined') {
    return getCfoRemoteConfigSnapshot(null);
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return getCfoRemoteConfigSnapshot(firebaseApp);
  }

  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    try {
      const supported = await isSupported().catch(() => false);
      if (!supported) {
        return getCfoRemoteConfigSnapshot(firebaseApp);
      }
      const rc = getOrInitRemoteConfig(firebaseApp);
      if (!rc) {
        return getCfoRemoteConfigSnapshot(firebaseApp);
      }
      await fetchAndActivate(rc);
      lastSyncedAtMs = Date.now();
    } catch {
      // Offline or RC backend unconfigured — cleanly retain defaultConfig.
    } finally {
      syncPromise = null;
    }
    return getCfoRemoteConfigSnapshot(firebaseApp);
  })();

  return syncPromise;
}
