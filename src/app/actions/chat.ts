
'use server';

import { personalizedAICoaching } from '@/ai/flows/personalized-ai-coaching';
import { initializeFirebase } from '@/firebase/sdk';

/**
 * @fileOverview Server Action for sending chat messages to the CFO AI Coach.
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
) {
  try {
    if (!userId) throw new Error("Anonymous UID required for audit.");

    const resolvedDate = localDate || new Date().toISOString().split('T')[0];

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
      userId,
      userName,
      message,
      currentDay,
      localDate: resolvedDate,
      localTime: localTime || new Date().toLocaleTimeString('en-US'),
      chatHistory,
      currentHealth: sanitizedHealth,
      photoDataUris: resolvedPhotoUris.length > 0 ? resolvedPhotoUris : undefined,
      photoTimestamps: photoTimestamps?.length ? photoTimestamps : undefined,
      photoDates: photoDates?.length ? photoDates : undefined,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI coach timed out — check GOOGLE_GENAI_API_KEY and Genkit server.')), AI_TIMEOUT_MS)
    );

    const response = await Promise.race([aiPromise, timeoutPromise]);

    return { success: true, response: response.response };
  } catch (error: any) {
    const detail = error?.message ?? String(error);
    console.error("CFO Audit Interrupted:", detail);
    return { success: false, error: `Audit Failed: ${detail}` };
  }
}
