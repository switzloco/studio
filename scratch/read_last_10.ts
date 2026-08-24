import { initializeApp, getApps, getApp } from 'firebase-admin/app';
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

  console.log(`Total history entries: ${history.length}`);
  const last10 = history.slice(-10);
  console.log(JSON.stringify(last10, null, 2));
}

main().catch(console.error);
