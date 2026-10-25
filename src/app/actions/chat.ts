'use server';

import { personalizedAICoaching } from '@/ai/flows/personalized-ai-coaching';
import { getAdminFirestore, verifyIdTokenString } from '@/firebase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkServerEntitlement, recordAiAuditTurn } from '@/lib/entitlements-server';
import { fetchSlimUserContext } from '@/lib/user-context';

function extractContentType(dataUri: string): string {
  const match = dataUri.match(/^data:([^;]+);/);
  return match?.[1] ?? 'image/jpeg';
}

/**
 * @fileOverview Server Action for sending chat messages to the CFO AI Coach.
 * Requires a verified Firebase ID token when invoked outside internal founder diagnostics.
 */

/** Timeout (ms) for the AI coaching flow — prevents infinite hangs when Genkit/Gemini is down. */
const AI_TIMEOUT_MS = 60_000;

export async function sendChatMessage(
  message: string,
  chatHistory: { role: 'user' | 'model', content: string }[],
  currentHealth: any,
  /** @deprecated Use photoDataUris instead. Kept for backward compat. */
  photoDataUri?: string,
  userId?: string,
  userName?: string,
  localDate?: string,
  localTime?: string,
  /** Array of base64 data URIs for multi-photo support. */
  photoDataUris?: string[],
  /** Parallel array of EXIF-derived times (HH:MM 24h) — one per photo, empty string if unknown. */
  photoTimestamps?: string[],
  /** Parallel array of EXIF-derived dates (YYYY-MM-DD) — one per photo, empty string if same as localDate. */
  photoDates?: string[],
  /** Verified Firebase ID token from the client. */
  idToken?: string,
) {
  try {
    if (!idToken) {
      throw new Error('Authentication token required for AI audit.');
    }
    const auth = await verifyIdTokenString(idToken);
    if (!auth || (userId && auth.uid !== userId)) {
      throw new Error('Unauthorized audit request.');
    }

    const entitlement = await checkServerEntitlement(auth);
    if (!entitlement.allowed) {
      return {
        success: false,
        code: 'PAYWALL_LIMIT_REACHED',
        error: `You've used all ${entitlement.freeLimit} complimentary AI Coach audits.`,
      };
    }

    const resolvedDate = localDate || new Date().toISOString().split('T')[0];
    const firestore = getAdminFirestore();

    const [rateLimit, userContext] = await Promise.all([
      checkRateLimit(auth.uid, 'chat'),
      fetchSlimUserContext(firestore, auth.uid, resolvedDate).catch((err) => {
        console.error('[sendChatMessage] Preload context error (falling back):', err);
        return null;
      }),
    ]);

    if (!rateLimit.ok) {
      throw new Error(`Rate limit exceeded (${rateLimit.scope}). Please try again in ${rateLimit.retryAfter}s.`);
    }

    const [yr, mo, dy] = resolvedDate.split('-').map(Number);
    const currentDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(yr, mo - 1, dy));

    const isNewDay = currentHealth?.lastActiveDate !== resolvedDate;
    const sanitizedHealth = isNewDay
      ? { ...currentHealth, dailyProteinG: 0, dailyCaloriesIn: 0, dailyCarbsG: 0 }
      : currentHealth;

    // Normalise to array — legacy single-photo callers still work
    const resolvedPhotoUris: string[] = photoDataUris && photoDataUris.length > 0
      ? photoDataUris
      : photoDataUri ? [photoDataUri] : [];

    const aiPromise = personalizedAICoaching({
      userId: auth.uid,
      userName,
      message,
      currentDay,
      localDate: resolvedDate,
      localTime: localTime || new Date().toLocaleTimeString('en-US'),
      preloadedContext: userContext ? JSON.stringify(userContext, null, 2) : undefined,
      // Keep only recent chat history (last 10 turns) to optimize LLM input token usage
      chatHistory: chatHistory?.slice(-10),
      currentHealth: sanitizedHealth,
      photoDataUris: resolvedPhotoUris.length > 0
        ? resolvedPhotoUris.map(uri => ({ url: uri, contentType: extractContentType(uri) }))
        : undefined,
      photoTimestamps: photoTimestamps?.length ? photoTimestamps : undefined,
      photoDates: photoDates?.length ? photoDates : undefined,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI coach timed out — check GOOGLE_GENAI_API_KEY and Genkit server.')), AI_TIMEOUT_MS)
    );

    const response = await Promise.race([aiPromise, timeoutPromise]);
    void recordAiAuditTurn(auth, false);

    return { success: true, response: response.response };
  } catch (error: any) {
    const detail = error?.message ?? String(error);
    console.error("CFO Audit Interrupted:", detail);
    return { success: false, error: `Audit Failed: ${detail}` };
  }
}
