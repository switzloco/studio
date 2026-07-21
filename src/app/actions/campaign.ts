'use server';

/**
 * @fileOverview Server Action for Campaign Mode's Daily Brief.
 * Generated on-demand (first Campaign tab open of the day) and cached to
 * Firestore so re-opening the tab never re-bills the model.
 */

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import { buildBriefContext, markBriefGenerated } from '@/lib/campaign/engine';
import { generateCampaignBrief } from '@/ai/flows/campaign-brief';

const AI_TIMEOUT_MS = 45_000;

export async function getDailyCampaignBrief(
  userId: string,
  userName: string | undefined,
  localDate: string,
): Promise<{ success: true; brief: string; cached: boolean } | { success: false; error: string }> {
  try {
    const firestore = getAdminFirestore();
    const [sheet, cached] = await Promise.all([
      healthService.getCampaignState(firestore, userId),
      healthService.getCampaignBrief(firestore, userId, localDate),
    ]);

    if (cached) {
      return { success: true, brief: cached.text, cached: true };
    }

    const briefContext = buildBriefContext(sheet, localDate);
    const briefPromise = generateCampaignBrief({ userName, briefContext });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Campaign brief timed out — check GOOGLE_GENAI_API_KEY and Genkit server.')), AI_TIMEOUT_MS),
    );
    const brief = await Promise.race([briefPromise, timeoutPromise]);

    await Promise.all([
      healthService.saveCampaignBrief(firestore, userId, localDate, brief),
      healthService.updateCampaignState(firestore, userId, markBriefGenerated(sheet, localDate)),
    ]);

    return { success: true, brief, cached: false };
  } catch (error: any) {
    const detail = error?.message ?? String(error);
    console.error('Campaign Brief Failed:', detail);
    return { success: false, error: `Brief generation failed: ${detail}` };
  }
}
