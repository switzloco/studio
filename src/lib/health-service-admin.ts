import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { HealthData, HealthLog, HistoryEntry, UserPreferences, FitbitCredentials, FitbitDailySnapshot, OuraCredentials } from './health-service';
import type { FoodLogEntry, ExerciseLogEntry, FastLogEntry, CustomMetricEntry, CustomMetricDef } from './food-exercise-types';

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
      dailyCarbsG: 0,
      dailyCaloriesIn: 0,
      dailyCaloriesOut: 2000,
      visceralFatPoints: 0,
      history: [{
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        gain: 0,
        status: 'Stable' as const,
        detail: 'Account Created',
        equity: 0,
      }],
      isAnonymous: true,
      onboardingDay: 1,
      onboardingComplete: false,
      isDeviceVerified: false,
      lastActiveDate: new Date().toISOString().split('T')[0],
      createdAt: FieldValue.serverTimestamp(),
    };
    await docRef.set(initialData);
    return initialData as unknown as HealthData;
  },

  async updateHealthData(db: Firestore, userId: string, updates: Partial<HealthData>): Promise<void> {
    const docRef = db.doc(`users/${userId}`);
    await docRef.set({ ...updates, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  },

  /** 
   * Recursively removes undefined fields from an object or array. 
   * Firestore rejects documents containing undefined values.
   */
  deepClean<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClean(item)) as unknown as T;
    }
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, this.deepClean(v)])
    ) as unknown as T;
  },

  /** Writes a per-day Fitbit snapshot using dot-notation so other dates are not overwritten. */
  async saveFitbitDailySnapshot(db: Firestore, userId: string, date: string, snapshot: FitbitDailySnapshot): Promise<void> {
    const docRef = db.doc(`users/${userId}`);
    const cleanSnapshot = this.deepClean(snapshot);
    await docRef.update({ [`fitbitByDate.${date}`]: cleanSnapshot, updatedAt: FieldValue.serverTimestamp() });
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

  async deleteFitbitCredentials(db: Firestore, userId: string): Promise<void> {
    const docRef = db.doc(`users/${userId}/preferences/fitbit_tokens`);
    await docRef.delete();
  },

  async saveOuraCredentials(db: Firestore, userId: string, creds: OuraCredentials): Promise<void> {
    const docRef = db.doc(`users/${userId}/preferences/oura_tokens`);
    await docRef.set(creds);
  },

  async getOuraCredentials(db: Firestore, userId: string): Promise<OuraCredentials | null> {
    const docRef = db.doc(`users/${userId}/preferences/oura_tokens`);
    const snap = await docRef.get();
    return snap.exists ? (snap.data() as OuraCredentials) : null;
  },

  async deleteOuraCredentials(db: Firestore, userId: string): Promise<void> {
    const docRef = db.doc(`users/${userId}/preferences/oura_tokens`);
    await docRef.delete();
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
    const clean = Object.fromEntries(
      Object.entries({ ...entry, timestamp: FieldValue.serverTimestamp() }).filter(([, v]) => v !== undefined)
    );
    const docRef = await ref.add(clean);
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
    return snapshot.docs
      .map(d => ({ ...d.data(), id: d.id }) as FoodLogEntry)
      .filter(e => !e.ignored);
  },

  // --- Structured Exercise Log ---

  async logExercise(db: Firestore, userId: string, entry: Omit<ExerciseLogEntry, 'timestamp'>): Promise<string> {
    const ref = db.collection(`users/${userId}/exercise_log`);
    const clean = Object.fromEntries(
      Object.entries({ ...entry, timestamp: FieldValue.serverTimestamp() }).filter(([, v]) => v !== undefined)
    );
    const docRef = await ref.add(clean);
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
    return snapshot.docs
      .map(d => ({ ...d.data(), id: d.id }) as ExerciseLogEntry)
      .filter(e => !e.ignored);
  },

  // --- Ignore / Unignore (soft-delete) ---

  async setFoodEntryIgnored(db: Firestore, userId: string, entryId: string, ignored: boolean): Promise<FoodLogEntry | null> {
    const docRef = db.doc(`users/${userId}/food_log/${entryId}`);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    await docRef.update({ ignored });
    return { ...snap.data(), id: snap.id, ignored } as FoodLogEntry;
  },

  async setExerciseEntryIgnored(db: Firestore, userId: string, entryId: string, ignored: boolean): Promise<ExerciseLogEntry | null> {
    const docRef = db.doc(`users/${userId}/exercise_log/${entryId}`);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    await docRef.update({ ignored });
    return { ...snap.data(), id: snap.id, ignored } as ExerciseLogEntry;
  },

  // --- Structured Fast Log ---

  async logFast(db: Firestore, userId: string, entry: Omit<FastLogEntry, 'timestamp'>): Promise<string> {
    const ref = db.collection(`users/${userId}/fast_log`);
    const clean = Object.fromEntries(
      Object.entries({ ...entry, timestamp: FieldValue.serverTimestamp() }).filter(([, v]) => v !== undefined)
    );
    const docRef = await ref.add(clean);
    return docRef.id;
  },

  async queryFastLog(db: Firestore, userId: string, date?: string, limitCount = 20): Promise<FastLogEntry[]> {
    const ref = db.collection(`users/${userId}/fast_log`);
    let q: FirebaseFirestore.Query = ref;
    if (date) {
      q = q.where('date', '==', date).limit(limitCount);
    } else {
      q = q.orderBy('timestamp', 'desc').limit(limitCount);
    }
    const snapshot = await q.get();
    return snapshot.docs
      .map(d => ({ ...d.data(), id: d.id }) as FastLogEntry)
      .filter(e => !e.ignored);
  },

  async queryFastLogRange(db: Firestore, userId: string, startDate: string, endDate: string, limitCount = 50): Promise<FastLogEntry[]> {
    const ref = db.collection(`users/${userId}/fast_log`);
    const snapshot = await ref
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .limit(limitCount)
      .get();
    return snapshot.docs
      .map(d => ({ ...d.data(), id: d.id }) as FastLogEntry)
      .filter(e => !e.ignored);
  },

  async setFastEntryIgnored(db: Firestore, userId: string, entryId: string, ignored: boolean): Promise<FastLogEntry | null> {
    const docRef = db.doc(`users/${userId}/fast_log/${entryId}`);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    await docRef.update({ ignored });
    return { ...snap.data(), id: snap.id, ignored } as FastLogEntry;
  },

  // --- Custom Metrics (user-defined performance series, e.g. basketball shooting %) ---

  async upsertCustomMetricDef(
    db: Firestore,
    userId: string,
    def: Pick<CustomMetricDef, 'metricKey' | 'metricLabel' | 'unit'> & { higherIsBetter?: boolean }
  ): Promise<CustomMetricDef> {
    const docRef = db.doc(`users/${userId}/custom_metric_defs/${def.metricKey}`);
    const snap = await docRef.get();
    if (snap.exists) {
      const updates: Record<string, unknown> = {
        metricLabel: def.metricLabel,
        unit: def.unit,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (def.higherIsBetter !== undefined) updates.higherIsBetter = def.higherIsBetter;
      await docRef.set(updates, { merge: true });
      const merged = await docRef.get();
      return merged.data() as CustomMetricDef;
    }
    const payload = {
      metricKey: def.metricKey,
      metricLabel: def.metricLabel,
      unit: def.unit,
      ...(def.higherIsBetter !== undefined ? { higherIsBetter: def.higherIsBetter } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await docRef.set(payload);
    return payload as unknown as CustomMetricDef;
  },

  async listCustomMetricDefs(db: Firestore, userId: string): Promise<CustomMetricDef[]> {
    const ref = db.collection(`users/${userId}/custom_metric_defs`);
    const snapshot = await ref.get();
    return snapshot.docs.map(d => d.data() as CustomMetricDef);
  },

  async getCustomMetricDef(db: Firestore, userId: string, metricKey: string): Promise<CustomMetricDef | null> {
    const docRef = db.doc(`users/${userId}/custom_metric_defs/${metricKey}`);
    const snap = await docRef.get();
    return snap.exists ? (snap.data() as CustomMetricDef) : null;
  },

  async logCustomMetric(
    db: Firestore,
    userId: string,
    entry: Omit<CustomMetricEntry, 'timestamp' | 'id'>
  ): Promise<string> {
    const ref = db.collection(`users/${userId}/custom_metric_log`);
    const clean = Object.fromEntries(
      Object.entries({ ...entry, timestamp: FieldValue.serverTimestamp() }).filter(([, v]) => v !== undefined)
    );
    const docRef = await ref.add(clean);
    return docRef.id;
  },

  async queryCustomMetricLogRange(
    db: Firestore,
    userId: string,
    startDate: string,
    endDate: string,
    opts: { metricKey?: string; limit?: number } = {}
  ): Promise<{ entries: CustomMetricEntry[]; truncated: boolean }> {
    const ref = db.collection(`users/${userId}/custom_metric_log`);
    const limitCount = opts.limit ?? 500;
    let q: FirebaseFirestore.Query = ref
      .where('date', '>=', startDate)
      .where('date', '<=', endDate);
    if (opts.metricKey) q = q.where('metricKey', '==', opts.metricKey);
    // Descending so we keep the most recent entries when the limit is hit
    q = q.orderBy('date', 'desc').limit(limitCount);
    const snapshot = await q.get();
    const entries = snapshot.docs
      .map(d => ({ ...d.data(), id: d.id }) as CustomMetricEntry)
      .filter(e => !e.ignored);
    return { entries, truncated: snapshot.size === limitCount };
  },

  async setCustomMetricEntryIgnored(
    db: Firestore,
    userId: string,
    entryId: string,
    ignored: boolean
  ): Promise<CustomMetricEntry | null> {
    const docRef = db.doc(`users/${userId}/custom_metric_log/${entryId}`);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    await docRef.update({ ignored });
    return { ...snap.data(), id: snap.id, ignored } as CustomMetricEntry;
  },
};
