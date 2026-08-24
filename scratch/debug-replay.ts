import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { adminHealthService } from '../src/lib/health-service-admin';
import { backfillScoreHistory } from '../src/lib/score-history-sync';
import { replayHistoryToSheet } from '../src/lib/campaign/engine';

function initApp() {
  if (!getApps().length) {
    initializeApp({ projectId: 'studio-4236902803-1eba2' });
  }
  return getApp();
}

async function main() {
  const db = getFirestore(initApp());
  const userId = 'AdKrHbpEc7WZOKVNWWvzhf7KtWs1';
  const todayIso = new Date().toISOString().split('T')[0];

  console.log(`Step 1: Running backfillScoreHistory for ${userId}...`);
  const scoreRes = await backfillScoreHistory(userId, todayIso, 365);
  console.log(`backfillScoreHistory result: scoredDays=${scoreRes.scoredDays}`);

  const health = await adminHealthService.getHealthSummary(db, userId);
  console.log(`Health history count: ${health?.history?.length}`);

  console.log(`\nSample of history entries:`);
  console.log(JSON.stringify(health?.history?.slice(0, 5), null, 2));

  console.log(`\nStep 2: Running replayHistoryToSheet...`);
  const { sheet, daysReplayed } = replayHistoryToSheet({
    history: health?.history ?? [],
    weightKg: health?.weightKg,
    bodyFatPct: health?.bodyFatPct,
  });

  console.log(`\nReplayed ${daysReplayed} days:`);
  console.log(`  Current Level: ${sheet.current_level}`);
  console.log(`  Lifetime Points: ${sheet.lifetime_points}`);
  console.log(`  Current Level Points: ${sheet.current_level_points}`);
  console.log(`  Days in Level: ${sheet.days_in_current_level}`);
  console.log(`  Level Started Iso: ${sheet.level_started_iso}`);
  console.log(`  Status: ${sheet.status}`);
  console.log(`  Chronicle count: ${sheet.chronicle?.length}`);
  console.log(`  Chronicle summaries:`, sheet.chronicle.map(c => `${c.iso} (L${c.level}): ${c.summary}`));

  console.log(`\nStep 3: Saving updated campaign state to Firestore...`);
  await adminHealthService.updateCampaignState(db, userId, sheet);
  console.log(`Campaign state updated in Firestore successfully!`);
}

main().catch(console.error);
