import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp(projectId: string) {
  const name = `app-${projectId}`;
  const existing = getApps().find(a => a.name === name);
  if (existing) return existing;
  return initializeApp({ projectId }, name);
}

async function inspectProject(projectId: string) {
  const db = getFirestore(getAdminApp(projectId));
  console.log(`\n==================================================`);
  console.log(`INSPECTING PROJECT: ${projectId}`);
  console.log(`==================================================`);

  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.docs.length} users in ${projectId}:`);

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const prefsSnap = await db.doc(`users/${doc.id}/preferences/settings`).get();
    const prefs = prefsSnap.exists ? prefsSnap.data() : null;

    const foodSnap = await db.collection(`users/${doc.id}/food_log`).get();
    const exSnap = await db.collection(`users/${doc.id}/exercise_log`).get();
    const fastSnap = await db.collection(`users/${doc.id}/fast_log`).get();

    console.log(`\nUser ID: ${doc.id}`);
    console.log(`  Weight: ${data.weightKg} kg (${data.weightKg ? (data.weightKg * 2.20462).toFixed(1) : 'N/A'} lbs), BodyFat: ${data.bodyFatPct}%`);
    console.log(`  Preferences Profile:`, JSON.stringify(prefs?.profile ?? {}));
    console.log(`  food_log: ${foodSnap.docs.length}, exercise_log: ${exSnap.docs.length}, fast_log: ${fastSnap.docs.length}`);
    console.log(`  history array length: ${data.history?.length ?? 0}`);
  }
}

async function main() {
  await inspectProject('studio-4236902803-1eba2');
  await inspectProject('studio-4236902803-c4aa9');
}

main().catch(console.error);
