import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { HealthData, HealthLog, HistoryEntry, UserPreferences, FitbitCredentials } from './health-service';
import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';

/**
 * @fileOverview Server-side health service using the Firebase Admin SDK.
 * Used exclusively by Genkit flows and Server Actions — bypasses Firestore
 * security rules via ADC (Application Default Credentials).
 */

export const adminHealthService = {
  async getHealthSummary(db: Firestore, userId: string): Promise<HealthData | null> {
    const docRef = db.doc(`users/${userId}`);
    const docSnap = await docRef.get();
    if (docSnap.exists) return docSnap.data() as HealthData;

    const initialData = {
      steps: 0,
      hrv: 50,
      sleepHours: 7,
      recoveryStatus: 'medium' as const,
      dailyProteinG: 0,
      dailyCaloriesIn: 0,
      dailyCaloriesOut: 2000,
      visceralFatPoints: 1250,
      history: [{
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        gain: 0,
        status: 'Stable' as const,
        detail: 'Portfolio Initialized',
        equity: 1250,
      }],
      isAnonymous: true,
      onboardingDay: 1,
      onboardingComplete: false,
      isDeviceVerified: false,
      createdAt: FieldValue.serverTimestamp(),
    };
    await docRef.set(initialData);
    return initialData as unknown as HealthData;
  },

  async updateHealthData(db: Firestore, userId: string, updates: Partial<HealthData>): Promise<void> {
    const docRef = db.doc(`users/${userId}`);
    await docRef.set({ ...updates, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  },

  async recordEquityEvent(db: Firestore, userId: string, entry: HistoryEntry): Promise<void> {
    const docRef = db.doc(`users/${userId}`);
    await docRef.update({
      history: FieldValue.arrayUnion(entry),
      updatedAt: FieldValue.serverTimestamp(),
    });
  },

  async getUserPreferences(db: Firestore, userId: string): Promise<UserPreferences | null> {
    const docRef = db.doc(`users/${userId}/preferences/settings`);
    const docSnap = await docRef.get();
    if (docSnap.exists) return docSnap.data() as UserPreferences;

    const defaultPrefs: UserPreferences = {
      weeklySchedule: JSON.stringify({
        Mon: 'Pending Audit', Tue: 'Pending Audit', Wed: 'Pending Audit',
        Thu: 'Pending Audit', Fri: 'Pending Audit', Sat: 'Pending Audit', Sun: 'Pending Audit',
      }, null, 2),
      equipment: [],
      targets: { proteinGoal: 150, fatPointsGoal: 3000 },
      profile: {},
    };
    await docRef.set(defaultPrefs, { merge: true });
    return defaultPrefs;
  },

  async updateUserPreferences(db: Firestore, userId: string, updates: Partial<UserPreferences>): Promise<void> {
    const docRef = db.doc(`users/${userId}/preferences/settings`);
    await docRef.set(updates, { merge: true });
  },

  async saveFitbitCredentials(db: Firestore, userId: string, creds: FitbitCredentials): Promise<void> {
    const docRef = db.doc(`users/${userId}/preferences/fitbit_tokens`);
    await docRef.set(creds);
  },

  async getFitbitCredentials(db: Firestore, userId: string): Promise<FitbitCredentials | null> {
    const docRef = db.doc(`users/${userId}/preferences/fitbit_tokens`);
    const snap = await docRef.get();
    return snap.exists ? (snap.data() as FitbitCredentials) : null;
  },

  async logActivity(db: Firestore, userId: string, log: Omit<HealthLog, 'userId' | 'timestamp'>): Promise<void> {
    const logsRef = db.collection(`users/${userId}/logs`);
    await logsRef.add({ ...log, userId, timestamp: FieldValue.serverTimestamp() });
  },

  async queryLogs(db: Firestore, userId: string, _category?: string, limitCount = 10): Promise<HealthLog[]> {
    const logsRef = db.collection(`users/${userId}/logs`);
    const snapshot = await logsRef.orderBy('timestamp', 'desc').limit(limitCount).get();
    return snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as HealthLog);
  },

  // --- Structured Food Log ---

  async logFood(db: Firestore, userId: string, entry: Omit<FoodLogEntry, 'timestamp'>): Promise<string> {
    const ref = db.collection(`users/${userId}/food_log`);
    const docRef = await ref.add({ ...entry, timestamp: FieldValue.serverTimestamp() });
    return docRef.id;
  },

  async queryFoodLog(db: Firestore, userId: string, date?: string, limitCount = 20): Promise<FoodLogEntry[]> {
    const ref = db.collection(`users/${userId}/food_log`);
    let q: FirebaseFirestore.Query = ref;
    if (date) {
      // Single-field filter avoids composite index requirement
      q = q.where('date', '==', date).limit(limitCount);
    } else {
      q = q.orderBy('timestamp', 'desc').limit(limitCount);
    }
    const snapshot = await q.get();
    return snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as FoodLogEntry);
  },

  // --- Structured Exercise Log ---

  async logExercise(db: Firestore, userId: string, entry: Omit<ExerciseLogEntry, 'timestamp'>): Promise<string> {
    const ref = db.collection(`users/${userId}/exercise_log`);
    const docRef = await ref.add({ ...entry, timestamp: FieldValue.serverTimestamp() });
    return docRef.id;
  },

  async queryExerciseLog(db: Firestore, userId: string, date?: string, limitCount = 20): Promise<ExerciseLogEntry[]> {
    const ref = db.collection(`users/${userId}/exercise_log`);
    let q: FirebaseFirestore.Query = ref;
    if (date) {
      q = q.where('date', '==', date).limit(limitCount);
    } else {
      q = q.orderBy('timestamp', 'desc').limit(limitCount);
    }
    const snapshot = await q.get();
    return snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as ExerciseLogEntry);
  },
};
