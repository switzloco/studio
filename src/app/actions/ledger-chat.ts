
'use server';

import { ledgerAnalyst } from '@/ai/flows/personalized-ai-coaching';
import { getAdminFirestore } from '@/firebase/admin';
import { fetchSlimUserContext } from '@/lib/user-context';

const AI_TIMEOUT_MS = 45_000;

export async function sendLedgerMessage(
  message: string,
  chatHistory: { role: 'user' | 'model'; content: string }[],
  userId: string,
  userName?: string,
  localDate?: string,
) {
  try {
    const resolvedDate = localDate ?? new Date().toISOString().split('T')[0];
    const firestore = getAdminFirestore();

    const userContext = await fetchSlimUserContext(firestore, userId, resolvedDate).catch((err) => {
      console.error('[sendLedgerMessage] Preload context error (falling back):', err);
      return null;
    });

    const aiPromise = ledgerAnalyst({
      userId,
      userName,
      message,
      currentDay: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date()),
      localDate: resolvedDate,
      localTime: new Date().toLocaleTimeString('en-US'),
      preloadedContext: userContext ? JSON.stringify(userContext, null, 2) : undefined,
      chatHistory,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Ledger Analyst timed out.')), AI_TIMEOUT_MS)
    );

    const response = await Promise.race([aiPromise, timeoutPromise]);
    return { success: true, response: response.response };
  } catch (error: any) {
    console.error('[LedgerAnalyst] Error:', error?.message ?? error);
    return { success: false, error: error?.message ?? 'Unknown error' };
  }
}
