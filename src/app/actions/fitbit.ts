
'use server';

import { initializeFirebase } from '@/firebase/sdk';
import { fitbitService } from '@/lib/fitbit-service';
import { healthService } from '@/lib/health-service';

/**
 * Syncs today's Fitbit data for a verified user.
 * Refreshes the access token if needed, fetches steps/sleep/HRV,
 * and writes the updated metrics back to Firestore.
 */
export async function syncFitbitData(userId: string): Promise<{ success: boolean }> {
  const { firestore } = initializeFirebase();

  const result = await fitbitService.syncWithStoredTokens(firestore, userId);
  if (!result?.success) return { success: false };

  await healthService.updateHealthData(firestore, userId, {
    steps: result.steps.value,
    sleepHours: result.sleep.value,
    hrv: result.hrv.value,
  });

  return { success: true };
}
