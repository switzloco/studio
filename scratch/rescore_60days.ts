import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { backfillScoreHistory } from '../src/lib/score-history-sync';

function initApp() {
  if (!getApps().length) {
    initializeApp({ projectId: 'studio-4236902803-1eba2' });
  }
}

async function rescoreAll() {
  initApp();
  const db = getFirestore();
  const usersSnap = await db.collection('users').get();
  const todayIso = new Date().toISOString().slice(0, 10);
  console.log(`Found ${usersSnap.docs.length} user(s). Rescoring last 60 days (2 months) as of ${todayIso}...`);

  for (const doc of usersSnap.docs) {
    const userId = doc.id;
    console.log(`Rescoring user ${userId}...`);
    try {
      const res = await backfillScoreHistory(userId, todayIso, 60);
      console.log(`  -> User ${userId} complete: ok=${res.ok}, scoredDays=${res.scoredDays}`);
    } catch (err) {
      console.error(`  -> Failed to rescore for user ${userId}:`, err);
    }
  }
  console.log('All user rescoring completed successfully.');
}

rescoreAll().catch(console.error);
