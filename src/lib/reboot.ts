/**
 * Performs a thorough, self-healing reboot of the CFO Terminal.
 * 
 * Specifically designed to bypass aggressive mobile caching (e.g. iOS Safari) and Next.js router cache:
 * 1. Resets active tab states in sessionStorage.
 * 2. Purges all active Service Worker Cache Storage keys.
 * 3. Unregisters all active Service Workers to clear stale layout files.
 * 4. Forces a cache-busted hard redirect to the home page.
 */
export async function rebootTerminal(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    // 1. Clear session storage to reset transient UI states and active tab to 'chat'
    sessionStorage.clear();
    sessionStorage.setItem('cfo_activeTab', 'chat');
  } catch (e) {
    console.error('[CFO Reboot] Failed to clear session:', e);
  }

  try {
    // 2. Clear all cache storage (bypasses service worker cache matching)
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      console.log('[CFO Reboot] Cache storage purged.');
    }
  } catch (e) {
    console.error('[CFO Reboot] Failed to clear caches:', e);
  }

  try {
    // 3. Unregister all service workers (forces fresh script downloads on next load)
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
      console.log('[CFO Reboot] Service workers unregistered.');
    }
  } catch (e) {
    console.error('[CFO Reboot] Failed to unregister SW:', e);
  }

  // 4. Force a hard navigation with a cache-busting timestamp parameter
  window.location.href = '/?r=' + Date.now();
}
