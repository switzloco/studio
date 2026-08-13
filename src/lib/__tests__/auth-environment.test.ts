import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isNativeShell,
  shouldUseRedirectSignIn,
  isPopupUnavailableError,
  isUserCancelledError,
} from '../auth-environment';

/**
 * These guard the transport choice behind Google sign-in.
 *
 * App Review rejected build 1.0 (1) under 2.1.0 because `signInWithPopup`
 * threw `auth/popup-blocked` inside the Capacitor WKWebView — there is no
 * popup for it to open, so the primary sign-in button was a dead end. The
 * regression is invisible in a desktop browser (popups work there), and it is
 * not reachable from jsdom either, so the detection logic is pinned here
 * instead.
 */

const UA_IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Capacitor's WKWebView — note the absent `Safari/` token. */
const UA_CAPACITOR =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
}

function setStandalone(value: boolean | undefined) {
  Object.defineProperty(window.navigator, 'standalone', {
    value,
    configurable: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUserAgent(UA_IPHONE_SAFARI);
  setStandalone(undefined);
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('isNativeShell', () => {
  it('is false in a plain browser with no Capacitor global', () => {
    expect(isNativeShell()).toBe(false);
  });

  it('is true when Capacitor reports a native platform', () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
    };
    expect(isNativeShell()).toBe(true);
  });

  it('is false when Capacitor is present but running on web', () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => false,
    };
    expect(isNativeShell()).toBe(false);
  });

  it('falls back to the platform string when isNativePlatform is absent', () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = { platform: 'ios' };
    expect(isNativeShell()).toBe(true);

    (window as unknown as { Capacitor: unknown }).Capacitor = { platform: 'web' };
    expect(isNativeShell()).toBe(false);
  });
});

describe('shouldUseRedirectSignIn', () => {
  it('uses popup in mobile Safari — the case that masked the bug', () => {
    setUserAgent(UA_IPHONE_SAFARI);
    expect(shouldUseRedirectSignIn()).toBe(false);
  });

  it('uses redirect inside the Capacitor native shell', () => {
    setUserAgent(UA_CAPACITOR);
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
    };
    expect(shouldUseRedirectSignIn()).toBe(true);
  });

  it('uses redirect in an iOS standalone PWA, where window.open returns null', () => {
    setStandalone(true);
    expect(shouldUseRedirectSignIn()).toBe(true);
  });

  it('uses redirect in embedded in-app browsers that suppress popups', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone) FBAN/FBIOS;FBAV/400.0',
      'Mozilla/5.0 (iPhone) Instagram 300.0.0.0',
      'Mozilla/5.0 (iPhone) LinkedInApp/9.0',
    ]) {
      setUserAgent(ua);
      expect(shouldUseRedirectSignIn()).toBe(true);
    }
  });
});

describe('isPopupUnavailableError', () => {
  it('matches the exact code App Review hit', () => {
    expect(isPopupUnavailableError({ code: 'auth/popup-blocked' })).toBe(true);
  });

  it('matches the other transport-unavailable codes', () => {
    expect(
      isPopupUnavailableError({ code: 'auth/operation-not-supported-in-this-environment' })
    ).toBe(true);
    expect(isPopupUnavailableError({ code: 'auth/web-storage-unsupported' })).toBe(true);
  });

  it('does not treat a user dismissal as a transport failure', () => {
    expect(isPopupUnavailableError({ code: 'auth/popup-closed-by-user' })).toBe(false);
  });

  it('tolerates malformed errors', () => {
    expect(isPopupUnavailableError(null)).toBe(false);
    expect(isPopupUnavailableError(undefined)).toBe(false);
    expect(isPopupUnavailableError({})).toBe(false);
    expect(isPopupUnavailableError(new Error('boom'))).toBe(false);
  });
});

describe('isUserCancelledError', () => {
  it('matches the dismissal codes so they are never retried as a redirect', () => {
    expect(isUserCancelledError({ code: 'auth/popup-closed-by-user' })).toBe(true);
    expect(isUserCancelledError({ code: 'auth/cancelled-popup-request' })).toBe(true);
    expect(isUserCancelledError({ code: 'auth/user-cancelled' })).toBe(true);
  });

  it('does not match a blocked popup, which must fall back to redirect', () => {
    expect(isUserCancelledError({ code: 'auth/popup-blocked' })).toBe(false);
  });

  it('tolerates malformed errors', () => {
    expect(isUserCancelledError(null)).toBe(false);
    expect(isUserCancelledError({})).toBe(false);
  });
});
