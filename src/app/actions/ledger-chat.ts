'use server';

import { ledgerAnalyst } from '@/ai/flows/personalized-ai-coaching';
import { getAdminFirestore, verifyIdTokenString } from '@/firebase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkServerEntitlement, recordAiAuditTurn } from '@/lib/entitlements-server';
import { fetchSlimUserContext } from '@/lib/user-context';

const AI_TIMEOUT_MS = 45_000;

export async function sendLedgerMessage(
  message: string,
  chatHistory: { role: 'user' | 'model'; content: string }[],
  userId: string,
  userName?: string,
  localDate?: string,
  idToken?: string,
) {
  try {
    if (!idToken) {
      throw new Error('Authentication token required for Ledger Analyst.');
    }
    const auth = await verifyIdTokenString(idToken);
    if (!auth || (userId && auth.uid !== userId)) {
      throw new Error('Unauthorized ledger request.');
    }

    const entitlement = await checkServerEntitlement(auth);
    if (!entitlement.allowed) {
      return {
        success: false,
        code: 'PAYWALL_LIMIT_REACHED',
        error: `You've used all ${entitlement.freeLimit} complimentary AI audits.`,
      };
    }

    const rateLimit = await checkRateLimit(auth.uid, 'chat');
    if (!rateLimit.ok) {
      throw new Error(`Rate limit exceeded (${rateLimit.scope}). Try again in ${rateLimit.retryAfter}s.`);
    }

    const resolvedDate = localDate ?? new Date().toISOString().split('T')[0];
    const firestore = getAdminFirestore();

    const userContext = await fetchSlimUserContext(firestore, auth.uid, resolvedDate).catch((err) => {
      console.error('[sendLedgerMessage] Preload context error (falling back):', err);
      return null;
    });

    const aiPromise = ledgerAnalyst({
      userId: auth.uid,
      userName,
      message,
      currentDay: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date()),
      localDate: resolvedDate,
      localTime: new Date().toLocaleTimeString('en-US'),
      preloadedContext: userContext ? JSON.stringify(userContext, null, 2) : undefined,
      chatHistory: chatHistory?.slice(-10),
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Ledger Analyst timed out.')), AI_TIMEOUT_MS)
    );

    const response = await Promise.race([aiPromise, timeoutPromise]);
    void recordAiAuditTurn(auth, false);
    return { success: true, response: response.response };
  } catch (error: any) {
    console.error('[LedgerAnalyst] Error:', error?.message ?? error);
    return { success: false, error: error?.message ?? 'Unknown error' };
  }
}
