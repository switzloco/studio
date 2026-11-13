'use client';

import type { FirebaseApp } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';

export type AppCheckTelemetryStatus = 'active' | 'debug_ready' | 'standby';

export interface AppCheckTelemetry {
  status: AppCheckTelemetryStatus;
  instance: AppCheck | null;
  debugMode: boolean;
}

let cachedTelemetry: AppCheckTelemetry | null = null;

function resolveRecaptchaSiteKey(): string {
  return (
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY?.trim() ||
    process.env.VITE_RECAPTCHA_SITE_KEY?.trim() ||
    ''
  );
}

function resolveDebugTokenSetting(): string | boolean | null {
  const explicitToken =
    process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN?.trim() ||
    process.env.VITE_APPCHECK_DEBUG_TOKEN?.trim();

  if (explicitToken) {
    if (explicitToken === 'true') return true;
    if (explicitToken === 'false') return null;
    return explicitToken;
  }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalHost =
      host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
    if (process.env.NODE_ENV !== 'production' || isLocalHost) {
      return true;
    }
  }

  return null;
}

/**
 * Initializes Firebase App Check with ReCaptchaEnterpriseProvider when
 * `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` is configured, and enables debug token
 * support in local/dev environments before calling `initializeAppCheck`.
 */
export function ensureFirebaseAppCheck(firebaseApp: FirebaseApp): AppCheckTelemetry {
  if (typeof window === 'undefined') {
    return { status: 'standby', instance: null, debugMode: false };
  }

  if (cachedTelemetry) {
    return cachedTelemetry;
  }

  const debugSetting = resolveDebugTokenSetting();
  if (debugSetting !== null && typeof self !== 'undefined') {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugSetting;
  }

  const siteKey = resolveRecaptchaSiteKey();
  if (!siteKey) {
    cachedTelemetry = {
      status: debugSetting !== null ? 'debug_ready' : 'standby',
      instance: null,
      debugMode: debugSetting !== null,
    };
    return cachedTelemetry;
  }

  try {
    const instance = initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    cachedTelemetry = {
      status: 'active',
      instance,
      debugMode: debugSetting !== null,
    };
    return cachedTelemetry;
  } catch (err) {
    console.warn('[AppCheck] Initialization warning:', err);
    cachedTelemetry = {
      status: debugSetting !== null ? 'debug_ready' : 'standby',
      instance: null,
      debugMode: debugSetting !== null,
    };
    return cachedTelemetry;
  }
}
