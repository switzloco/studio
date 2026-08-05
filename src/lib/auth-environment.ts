/**
 * Sign-in transport selection.
 *
 * `signInWithPopup` opens a secondary browser window. A Capacitor WKWebView has
 * no `WKUIDelegate` that creates one, so the call fails immediately with
 * `auth/popup-blocked` — which is exactly what App Review hit on the "Start Your
 * Audit" button (rejection 2.1.0, App Completeness). iOS standalone PWAs and
 * embedded in-app browsers (Instagram, LinkedIn, Gmail) behave the same way.
 *
 * Anywhere popups are unavailable we use `signInWithRedirect`, which navigates
 * the existing WebView instead of asking for a new one.
 */

/** Codes that mean "the popup transport is unavailable", not "the user said no". */
const POPUP_UNAVAILABLE_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
  'auth/internal-error',
]);

/** True when the page is running inside the Capacitor native shell. */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; platform?: string };
  }).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
  return !!cap.platform && cap.platform !== 'web';
}

/**
 * True when `window.open` cannot yield a usable auth popup, so the redirect
 * transport must be used instead.
 */
export function shouldUseRedirectSignIn(): boolean {
  if (typeof window === 'undefined') return false;
  if (isNativeShell()) return true;

  // iOS home-screen PWA — `window.open` returns null.
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true;

  // Embedded in-app browsers that suppress popups.
  const ua = window.navigator.userAgent;
  if (/FBAN|FBAV|Instagram|Line\/|LinkedInApp|Twitter|Snapchat/i.test(ua)) return true;

  return false;
}

/** True when a failed popup attempt should be retried as a redirect. */
export function isPopupUnavailableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' && POPUP_UNAVAILABLE_CODES.has(code);
}

/** True when the user themselves dismissed the popup — never retry these. */
export function isUserCancelledError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/user-cancelled'
  );
}
