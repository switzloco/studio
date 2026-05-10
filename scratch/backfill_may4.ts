import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const projectId = 'studio-4236902803-1eba2';
initializeApp({ projectId });
const db = getFirestore();

async function backfill() {
  let userSnap = await db.collection('users').where('email', '==', 'nicholas.switzer@gmail.com').get();
  
  if (userSnap.empty) {
    console.log('Email search failed, picking first user...');
    userSnap = await db.collection('users').limit(1).get();
  }

  if (userSnap.empty) {
    console.error('No users found in collection');
    return;
  }
  
  const uid = userSnap.docs[0].id;
  const foodLogs = [
    { date: '2026-05-04', consumedAt: '20:45', name: 'ISO, PBFit, Egg White', calories: 240, proteinG: 45, carbsG: 2, fatG: 5, meal: 'snack' },
    { date: '2026-05-04', consumedAt: '19:52', name: 'NA Guinness, Sashimi, Drumstick', calories: 210, proteinG: 18, carbsG: 12, fatG: 8, meal: 'dinner' },
    { date: '2026-05-04', consumedAt: '17:05', name: 'Bread + Honey', calories: 220, proteinG: 5, carbsG: 45, fatG: 1, meal: 'snack' },
    { date: '2026-05-04', consumedAt: '15:49', name: 'Pork Chop (6oz)', calories: 264, proteinG: 44, carbsG: 0, fatG: 8, meal: 'lunch' },
    { date: '2026-05-04', consumedAt: '13:27', name: 'Pork Chop (6oz)', calories: 264, proteinG: 44, carbsG: 0, fatG: 8, meal: 'lunch' },
    { date: '2026-05-04', consumedAt: '13:17', name: 'Garlic Naan', calories: 210, proteinG: 7, carbsG: 35, fatG: 4, meal: 'lunch' },
    { date: '2026-05-04', consumedAt: '11:24', name: 'Sardines on Sourdough', calories: 310, proteinG: 25, carbsG: 28, fatG: 12, meal: 'breakfast' },
  ];

  const exerciseLogs = [
    { date: '2026-05-04', performedAt: '19:00', name: 'Spinning', durationMin: 30, estimatedCaloriesBurned: 350, category: 'cardio', intensity: 'high' },
  ];

  console.log(`Backfilling for UID: ${uid}...`);

  for (const food of foodLogs) {
    await db.collection('users').doc(uid).collection('food_log').add({
      ...food,
      createdAt: Timestamp.now(),
      ignored: false
    });
  }

  for (const ex of exerciseLogs) {
    await db.collection('users').doc(uid).collection('exercise_log').add({
      ...ex,
      createdAt: Timestamp.now(),
      ignored: false
    });
  }

  console.log('Success.');
}

backfill().catch(console.error);
