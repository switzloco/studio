import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { adminHealthService } from '../src/lib/health-service-admin';
import { applyDailyProgress, replayHistoryToSheet } from '../src/lib/campaign/engine';

function initApp() {
  if (!getApps().length) {
    initializeApp({ projectId: 'studio-4236902803-1eba2' });
  }
  return getApp();
}

async function main() {
  const db = getFirestore(initApp());
  const userId = 'AdKrHbpEc7WZOKVNWWvzhf7KtWs1';
  const health = await adminHealthService.getHealthSummary(db, userId);
  const history = health?.history ?? [];

  console.log(`Testing replay for Nick Switzer (${history.length} history entries)...`);

  // Option B: Only positive days contribute to campaign level progress, or negative days floor at 0
  // Let's filter or floor rawScore in applyDailyProgress or in replay

  // Let's test flooring current_level_points at 0
  const validEntries = history
    .filter(e => e.isoDate || (e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date)))
    .map(e => ({ isoDate: e.isoDate || e.date!, gain: e.gain }))
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  console.log(`Valid entries: ${validEntries.length}`);

  // Test: what if rawScore for campaign level points is floored at 0 for negative days (so bad days don't subtract XP), OR what if negative days subtract but level_points floor at 0?
  // Let's test non-negative daily XP contribution (gain >= 0)
  const posOnlyHistory = validEntries.map(e => ({ ...e, gain: Math.max(0, e.gain) }));

  const resPosOnly = replayHistoryToSheet({
    history: posOnlyHistory,
    weightKg: health?.weightKg,
    bodyFatPct: health?.bodyFatPct,
  });

  console.log(`\nResults with non-negative daily XP (bad days = 0 pts loss):`);
  console.log(`  Current Level: ${resPosOnly.sheet.current_level}`);
  console.log(`  Lifetime Points: ${resPosOnly.sheet.lifetime_points}`);
  console.log(`  Current Level Points: ${resPosOnly.sheet.current_level_points}`);
  console.log(`  Days in Level: ${resPosOnly.sheet.days_in_current_level}`);
  console.log(`  Relics earned:`, resPosOnly.sheet.relics_earned);
  console.log(`  Items in inventory:`, resPosOnly.sheet.inventory);
  console.log(`  Chronicle level ups:`, resPosOnly.sheet.chronicle.filter(c => c.kind === 'level_up').map(c => `${c.iso}: L${c.level} ${c.summary}`));
}

main().catch(console.error);
