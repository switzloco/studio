import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from './health-service-admin';

export interface WeeklyMetrics {
  dateRange: {
    start: string;
    end: string;
  };
  totalUsers: number;
  dau: number; // Daily Active Users (last 24h)
  wau: number; // Weekly Active Users (last 7d)
  newUsersWeek: number;
  totalFoodLogsWeek: number;
  totalExerciseLogsWeek: number;
  totalLLMCallsWeek: number; // Estimated
}

/**
 * Aggregates usage metrics for the weekly report.
 */
export async function getWeeklyMetrics(): Promise<WeeklyMetrics> {
  const db = getAdminFirestore();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const nowIso = now.toISOString().split('T')[0];
  const weekAgoIso = oneWeekAgo.toISOString().split('T')[0];

  // 1. Get User Counts
  const usersSnapshot = await db.collection('users').get();
  const totalUsers = usersSnapshot.size;

  let dau = 0;
  let wau = 0;
  let newUsersWeek = 0;

  usersSnapshot.forEach(doc => {
    const data = doc.data();
    const lastActive = data.updatedAt?.toDate() || data.createdAt?.toDate();
    const createdAt = data.createdAt?.toDate();

    if (lastActive && lastActive > oneDayAgo) dau++;
    if (lastActive && lastActive > oneWeekAgo) wau++;
    if (createdAt && createdAt > oneWeekAgo) newUsersWeek++;
  });

  // 2. Aggregate Activity Logs (Food/Exercise)
  // We'll sample logs from the last week. 
  // For a true count, we'd need a collectionGroup query or to iterate all users.
  // Given we are in a cron job, iterating all users is fine if the count is low.
  let totalFoodLogsWeek = 0;
  let totalExerciseLogsWeek = 0;

  // Process in batches if user count grows, but for now simple loop
  for (const userDoc of usersSnapshot.docs) {
    const foodRef = db.collection(`users/${userDoc.id}/food_log`);
    const exerciseRef = db.collection(`users/${userDoc.id}/exercise_log`);

    const [foodSnap, exerciseSnap] = await Promise.all([
      foodRef.where('date', '>=', weekAgoIso).get(),
      exerciseRef.where('date', '>=', weekAgoIso).get()
    ]);

    totalFoodLogsWeek += foodSnap.size;
    totalExerciseLogsWeek += exerciseSnap.size;
  }

  // 3. Estimated LLM Calls
  // We can look at the 'logs' subcollection if we log AI interactions there.
  let totalLLMCallsWeek = 0;
  for (const userDoc of usersSnapshot.docs) {
    const logsRef = db.collection(`users/${userDoc.id}/logs`);
    const aiLogsSnap = await logsRef
      .where('category', '==', 'ai_coaching') // assuming this category for AI calls
      .where('timestamp', '>=', oneWeekAgo)
      .get();
    totalLLMCallsWeek += aiLogsSnap.size;
  }

  return {
    dateRange: {
      start: weekAgoIso,
      end: nowIso,
    },
    totalUsers,
    dau,
    wau,
    newUsersWeek,
    totalFoodLogsWeek,
    totalExerciseLogsWeek,
    totalLLMCallsWeek,
  };
}
