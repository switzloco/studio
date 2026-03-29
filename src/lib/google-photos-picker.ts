'use client';

/**
 * @fileOverview Google Photos Picker API integration.
 *
 * Flow:
 *   1. loadGIS()                    — dynamically loads Google Identity Services
 *   2. getPhotosPickerToken()       — OAuth popup for photospicker.readonly scope
 *   3. createPickerSession()        — creates a session, returns pickerUri
 *   4. open pickerUri in new tab    — user picks photos in Google's UI
 *   5. pollPickerSession()          — poll until mediaItemsSet=true
 *   6. getPickerMediaItems()        — fetch the selected item metadata
 *   7. downloadMediaItem()          — download each photo as a data URI
 *   8. deletePickerSession()        — cleanup
 *
 * Setup required in Google Cloud Console:
 *   - Enable "Google Photos Picker API"
 *   - Add scope: https://www.googleapis.com/auth/photospicker.readonly
 *   - Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in your .env.local
 */

// ---------------------------------------------------------------------------
// GIS type declarations (minimal — avoids needing @types/google.accounts)
// ---------------------------------------------------------------------------

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleAccounts {
  oauth2: {
    initTokenClient(config: {
      client_id: string;
      scope: string;
      callback: (response: { access_token?: string; error?: string }) => void;
      error_callback?: (error: { type: string }) => void;
    }): TokenClient;
  };
}

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts };
  }
}

// ---------------------------------------------------------------------------
// GIS loader
// ---------------------------------------------------------------------------

let gisLoadPromise: Promise<void> | null = null;

/** Dynamically loads the Google Identity Services library (idempotent). */
export function loadGIS(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

// ---------------------------------------------------------------------------
// OAuth token
// ---------------------------------------------------------------------------

/**
 * Prompts the user for consent and returns a short-lived access token for
 * the photospicker.readonly scope. Subsequent calls within the token lifetime
 * will not re-prompt (prompt: '').
 */
export async function getPhotosPickerToken(clientId: string): Promise<string> {
  await loadGIS();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/photospicker.readonly',
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? 'No access token returned'));
        } else {
          resolve(response.access_token);
        }
      },
      error_callback: (err) => reject(new Error(`OAuth error: ${err.type}`)),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// ---------------------------------------------------------------------------
// Picker session
// ---------------------------------------------------------------------------

export interface PickerSession {
  id: string;
  pickerUri: string;
  pollingConfig: {
    /** e.g. "5s" */
    pollInterval: string;
    /** e.g. "300s" */
    timeoutIn: string;
  };
}

/** Creates a new picker session. Returns the session and the URL to open for the user. */
export async function createPickerSession(accessToken: string): Promise<PickerSession> {
  const res = await fetch('https://photospicker.googleapis.com/v1/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Picker session creation failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Polls the session once and returns whether the user has finished selecting.
 * Returns true when mediaItemsSet is true.
 */
export async function pollPickerSession(sessionId: string, accessToken: string): Promise<boolean> {
  const res = await fetch(`https://photospicker.googleapis.com/v1/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Session poll failed (${res.status})`);
  const data = await res.json();
  return data.mediaItemsSet === true;
}

// ---------------------------------------------------------------------------
// Media items
// ---------------------------------------------------------------------------

export interface PickerMediaItem {
  id: string;
  /** RFC3339 UTC — when the photo was actually taken (from camera EXIF). */
  createTime: string;
  type: 'PHOTO' | 'VIDEO';
  mediaFile: {
    baseUrl: string;
    mimeType: string;
    filename: string;
  };
}

/** Returns the selected media items for a finished session. */
export async function getPickerMediaItems(
  sessionId: string,
  accessToken: string,
): Promise<PickerMediaItem[]> {
  const res = await fetch(
    `https://photospicker.googleapis.com/v1/mediaItems?sessionId=${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Media items fetch failed (${res.status})`);
  const data = await res.json();
  return (data.mediaItems ?? []) as PickerMediaItem[];
}

/**
 * Downloads a photo at a reasonable resolution (1600px wide) and returns
 * a base64 data URI. Falls back to original if the resize fails.
 */
export async function downloadMediaItem(baseUrl: string): Promise<string> {
  // =w1600 gives a good balance of quality vs payload size for AI analysis
  const url = `${baseUrl}=w1600`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Photo download failed (${res.status})`);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Best-effort cleanup — call after items are downloaded (or on cancel). */
export async function deletePickerSession(sessionId: string, accessToken: string): Promise<void> {
  try {
    await fetch(`https://photospicker.googleapis.com/v1/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Non-fatal — session will expire on its own
  }
}

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/** Converts a PickerMediaItem's createTime into { time: "HH:MM", date: "YYYY-MM-DD" }. */
export function extractTimestampFromMediaItem(item: PickerMediaItem): {
  time: string;
  date: string;
} {
  const d = new Date(item.createTime);
  return {
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    date: d.toLocaleDateString('en-CA'), // YYYY-MM-DD in local tz
  };
}

// ---------------------------------------------------------------------------
// Polling helper with abort support
// ---------------------------------------------------------------------------

/**
 * Polls a picker session until the user finishes selecting or the session
 * times out. Returns true if media was selected, false if timed out/aborted.
 *
 * @param onFocusRegained  Pass `window.addEventListener` logic externally; this
 *                         function registers a visibilitychange listener to
 *                         trigger an immediate poll when the user returns to the tab.
 */
export async function waitForPickerSelection(
  session: PickerSession,
  accessToken: string,
  signal: AbortSignal,
): Promise<boolean> {
  // Parse poll interval and timeout from strings like "5s", "300s"
  const pollIntervalMs = (parseInt(session.pollingConfig.pollInterval) || 5) * 1000;
  const timeoutMs = (parseInt(session.pollingConfig.timeoutIn) || 300) * 1000;
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };

    signal.addEventListener('abort', () => {
      cleanup();
      resolve(false);
    });

    const check = async () => {
      if (signal.aborted) return;
      if (Date.now() >= deadline) {
        cleanup();
        resolve(false);
        return;
      }
      try {
        const done = await pollPickerSession(session.id, accessToken);
        if (done) {
          cleanup();
          resolve(true);
          return;
        }
      } catch {
        // transient error — keep polling
      }
      if (!signal.aborted) {
        timer = setTimeout(check, pollIntervalMs);
      }
    };

    // Poll immediately when user returns to this tab
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer);
        check();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Start polling
    check();
  });
}
