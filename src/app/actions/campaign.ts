'use server';

/**
 * @fileOverview Server Action for Campaign Mode's Daily Brief.
 * Generated on-demand (first Campaign tab open of the day) and cached to
 * Firestore so re-opening the tab never re-bills the model.
 */

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import { buildBriefContext, markBriefGenerated, replayHistoryToSheet } from '@/lib/campaign/engine';
import { generateCampaignBrief } from '@/ai/flows/campaign-brief';
import { CharacterSheet } from '@/lib/campaign/types';
import { backfillScoreHistory } from '@/lib/score-history-sync';

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

export async function backfillCampaignFromHistory(
  userId: string,
): Promise<{ success: true; sheet: CharacterSheet; daysReplayed: number } | { success: false; error: string }> {
  try {
    const firestore = getAdminFirestore();
    const todayIso = new Date().toISOString().split('T')[0];

    // 1. Build & sync VF score history from logged food and exercise entries over the past 365 days
    await backfillScoreHistory(userId, todayIso, 365);

    // 2. Load the populated health summary
    const health = await healthService.getHealthSummary(firestore, userId);
    if (!health || !health.history || health.history.length === 0) {
      return { success: false, error: 'No health scoring history found to replay.' };
    }

    // 3. Replay all historical VF scores into the Campaign CharacterSheet
    const { sheet, daysReplayed } = replayHistoryToSheet({
      history: health.history,
      weightKg: health.weightKg,
      bodyFatPct: health.bodyFatPct,
    });

    await healthService.updateCampaignState(firestore, userId, sheet);

    return { success: true, sheet, daysReplayed };
  } catch (error: any) {
    const detail = error?.message ?? String(error);
    console.error('Backfill Campaign Failed:', detail);
    return { success: false, error: `Backfill failed: ${detail}` };
  }
}


