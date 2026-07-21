'use server';

/**
 * @fileOverview Server Action for narrating a cached Campaign Daily Brief
 * via Google Cloud Text-to-Speech. Synthesizes on demand (button click) —
 * not persisted server-side; the client caches the result for the session
 * so repeated plays of the same day don't re-bill Cloud TTS.
 */

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import { synthesizeCampaignBrief } from '@/ai/tts';

const TTS_TIMEOUT_MS = 30_000;

export async function getCampaignBriefAudio(
  userId: string,
  isoDate: string,
): Promise<{ success: true; audioBase64: string } | { success: false; error: string }> {
  try {
    const firestore = getAdminFirestore();
    const brief = await healthService.getCampaignBrief(firestore, userId, isoDate);
    if (!brief?.text) {
      return { success: false, error: 'No Brief text found for that date yet.' };
    }

    const synthPromise = synthesizeCampaignBrief(brief.text);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Narration timed out.')), TTS_TIMEOUT_MS),
    );
    const audioBase64 = await Promise.race([synthPromise, timeoutPromise]);

    return { success: true, audioBase64 };
  } catch (error: any) {
    const detail = error?.message ?? String(error);
    console.error('Campaign Brief Narration Failed:', detail);
    return { success: false, error: `Narration failed: ${detail}` };
  }
}
