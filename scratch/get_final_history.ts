import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { adminHealthService } from '../src/lib/health-service-admin';

function initApp() {
  if (!getApps().length) {
    initializeApp({ projectId: 'studio-4236902803-1eba2' });
  }
}

async function main() {
  initApp();
  const db = getFirestore();
  const userId = 'AdKrHbpEc7WZOKVNWWvzhf7KtWs1';
  const health = await adminHealthService.getHealthSummary(db, userId);
  const history = health?.history ?? [];

  const last10 = history.slice(-10);
  console.log(JSON.stringify(last10.map(h => ({
    date: h.date,
    isoDate: h.isoDate,
    gain: h.gain,
    status: h.status,
    equity: h.equity,
    proteinG: h.breakdown?.proteinG,
    deficit: h.breakdown?.deficit,
    detail: h.detail
  })), null, 2));
}

main().catch(console.error);
