import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { adminHealthService } from '../src/lib/health-service-admin';

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

  let totalPos = 0;
  let totalNeg = 0;
  let posCount = 0;
  let negCount = 0;

  for (const h of history) {
    if (h.gain > 0) {
      totalPos += h.gain;
      posCount++;
    } else if (h.gain < 0) {
      totalNeg += h.gain;
      negCount++;
    }
  }

  console.log(`History summary for Nick Switzer (${history.length} total entries):`);
  console.log(`  Positive days: ${posCount} days, sum = +${totalPos} pts`);
  console.log(`  Negative days: ${negCount} days, sum = ${totalNeg} pts`);
  console.log(`  Net sum = ${totalPos + totalNeg} pts`);
}

main().catch(console.error);
