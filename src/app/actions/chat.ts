
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
  photoDataUri?: string,
  userId?: string,
  userName?: string,
  localDate?: string,
  localTime?: string
) {
  try {
    if (!userId) throw new Error("Anonymous UID required for audit.");

    const resolvedDate = localDate || new Date().toISOString().split('T')[0];

    // Derive day-of-week from the client's local date, not the server clock
    const [yr, mo, dy] = resolvedDate.split('-').map(Number);
    const currentDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(yr, mo - 1, dy));

    // Zero out daily user-logged intake if it's a new day, matching the
    // dashboard's isNewDay guard so the AI never sees yesterday's protein/calories.
    const isNewDay = currentHealth?.lastActiveDate !== resolvedDate;
    const sanitizedHealth = isNewDay
      ? { ...currentHealth, dailyProteinG: 0, dailyCaloriesIn: 0, dailyCarbsG: 0 }
      : currentHealth;

    const aiPromise = personalizedAICoaching({
      userId,
      userName,
      message,
      currentDay,
      localDate: resolvedDate,
      localTime: localTime || new Date().toLocaleTimeString('en-US'),
      photoDataUri,
      chatHistory,
      currentHealth: sanitizedHealth,
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
