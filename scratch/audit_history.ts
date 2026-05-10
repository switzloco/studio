
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();

const db = getFirestore();
const userId = 'AdKrHbpEc7WZOKVNWWvzhf7KtWs1';

async function audit() {
  const userDoc = await db.doc(`users/${userId}`).get();
  const userData = userDoc.data();
  if (!userData) {
    console.log('User not found');
    return;
  }

  const weightKg = userData.weightKg || 70;
  const bodyFatPct = userData.bodyFatPct || 20;

  // Get date range (last 21 days)
  const today = new Date();
  const dates = [];
  for (let i = 0; i < 21; i++) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    dates.push(d.toLocaleDateString('en-CA'));
  }

  console.log(`Auditing ${dates.length} days for ${userId}...`);

  let totalOldPoints = 0;
  let totalNewPoints = 0;
  const auditResults = [];

  for (const dateStr of dates) {
    const [foodSnap, exSnap] = await Promise.all([
      db.collection(`users/${userId}/food_log`).where('date', '==', dateStr).get(),
      db.collection(`users/${userId}/exercise_log`).where('date', '==', dateStr).get()
    ]);

    const foodLogs = foodSnap.docs.map(d => d.data());
    const exLogs = exSnap.docs.map(d => d.data());

    const caloriesIn = foodLogs.reduce((s, e) => s + (e.calories || 0), 0);
    const proteinG = foodLogs.reduce((s, e) => s + (e.proteinG || 0), 0);
    const alcoholDrinks = foodLogs.reduce((s, e) => s + (e.alcoholDrinks || 0), 0);
    const seedOilMeals = foodLogs.filter(e => e.hasSeedOils).length;
    
    // Get stored data from history or fitbit snapshot
    const fitbitData = userData.fitbitByDate?.[dateStr] || {};
    const caloriesOut = fitbitData.caloriesOut || 2000;
    const hrv = fitbitData.hrv || null;

    // SIMULATED OLD LOGIC (Simple deficit / 10, no alcohol penalty beyond calories)
    const oldBase = Math.round((caloriesOut - caloriesIn) / 10);
    const oldScore = proteinG < 150 ? Math.round(oldBase * (proteinG / 150)) : oldBase;
    
    // NEW LOGIC (with alcohol penalties, HRV multipliers, etc.)
    const deficit = caloriesOut - caloriesIn;
    let newScore = Math.round(deficit / 10);
    
    // Protein Modifier
    if (proteinG < 150 && newScore > 0) {
        newScore = Math.round(newScore * (proteinG / 150));
    }
    
    // Alcohol Penalty
    const alcoholPenalty = alcoholDrinks > 3 ? (3 * -5) + ((alcoholDrinks - 3) * -10) : alcoholDrinks * -5;
    newScore += alcoholPenalty;
    
    // HRV Multiplier
    if (hrv) {
        if (hrv < 30) newScore = Math.round(newScore * 0.85);
        else if (hrv > 80) newScore = Math.round(newScore * 1.10);
    }
    
    // Seed Oil Penalty
    newScore += (seedOilMeals * -5);

    totalOldPoints += oldScore;
    totalNewPoints += newScore;

    auditResults.push({
      date: dateStr,
      oldScore,
      newScore,
      alcoholDrinks,
      hrv,
      diff: newScore - oldScore
    });
  }

  console.log('\n--- AUDIT SUMMARY ---');
  console.log(`Total Old Points: ${totalOldPoints}`);
  console.log(`Total New Points: ${totalNewPoints}`);
  console.log(`Net Change: ${totalNewPoints - totalOldPoints}`);
  console.log('\nDetailed Breakdown (Top 10 Changes):');
  auditResults
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 10)
    .forEach(r => {
      console.log(`${r.date}: ${r.oldScore} -> ${r.newScore} (Diff: ${r.diff}) [Alcohol: ${r.alcoholDrinks}, HRV: ${r.hrv}]`);
    });
}

audit();
