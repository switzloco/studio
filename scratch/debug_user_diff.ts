import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { adminHealthService } from '../src/lib/health-service-admin';
import { calculateDailyScore } from '../src/lib/visceral-fat-engine';

function initApp() {
  if (!getApps().length) {
    initializeApp({ projectId: 'studio-4236902803-1eba2' });
  }
}

async function main() {
  initApp();
  const db = getFirestore();
  const usersSnap = await db.collection('users').get();

  console.log(`Checking 2026-07-23 across all ${usersSnap.docs.length} users:`);

  for (const doc of usersSnap.docs) {
    const uid = doc.id;
    const food = await adminHealthService.queryLogRangeAll(db, uid, 'food_log', '2026-07-23', '2026-07-23');
    const ex = await adminHealthService.queryLogRangeAll(db, uid, 'exercise_log', '2026-07-23', '2026-07-23');
    
    let totalProtein = 0;
    for (const f of food as any[]) {
      totalProtein += f.proteinG ?? 0;
    }

    const health = await adminHealthService.getHealthSummary(db, uid);
    const historyEntry = (health?.history ?? []).find((h: any) => h.isoDate === '2026-07-23');

    console.log(`\nUser UID: ${uid}`);
    console.log(`  Food logs count: ${food.length}, total protein: ${totalProtein.toFixed(1)}g`);
    console.log(`  Exercise logs count: ${ex.length}`);
    console.log(`  History entry for 2026-07-23:`, historyEntry);
  }
}

main().catch(console.error);
