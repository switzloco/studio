'use server';

import { backfillScoreHistory as _backfillScoreHistory } from '@/lib/score-history-sync';

/** Auto-score backdated days into the equity history (default 90-day window). */
export async function backfillScoreHistory(
  userId: string,
  localDate: string,
  days = 90,
): Promise<{ ok: boolean; scoredDays: number }> {
  return _backfillScoreHistory(userId, localDate, days);
}
