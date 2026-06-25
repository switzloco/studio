import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { HealthData, HealthLog, HistoryEntry, UserPreferences, FitbitCredentials, FitbitDailySnapshot, OuraCredentials, WithingsCredentials } from './health-service';
import type { FoodLogEntry, ExerciseLogEntry, FastLogEntry, ChatMessage, ChatSession, SharedMeal, SharedMealItem } from './food-exercise-types';

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

  async saveWithingsCredentials(db: Firestore, userId: string, creds: WithingsCredentials): Promise<void> {
    const docRef = db.doc(`users/${userId}/preferences/withings_tokens`);
    await docRef.set(creds);
  },

  async getWithingsCredentials(db: Firestore, userId: string): Promise<WithingsCredentials | null> {
    const docRef = db.doc(`users/${userId}/preferences/withings_tokens`);
    const snap = await docRef.get();
    return snap.exists ? (snap.data() as WithingsCredentials) : null;
  },

  async deleteWithingsCredentials(db: Firestore, userId: string): Promise<void> {
    const docRef = db.doc(`users/${userId}/preferences/withings_tokens`);
    await docRef.delete();
  },

  // --- Daily Chat Transcript ---

  /**
   * Appends messages to the day's chat transcript (one doc per day, ID == date).
   * Uses arrayUnion so concurrent turns can't clobber each other. Strips
   * undefined fields — Firestore rejects them. Display/visibility only; this is
   * never the AI's memory of record.
   */
  async appendChatMessages(db: Firestore, userId: string, date: string, messages: ChatMessage[]): Promise<void> {
    const clean = messages
      .filter(m => m && m.content)
      .map(m => this.deepClean(m));
    if (clean.length === 0) return;
    const docRef = db.doc(`users/${userId}/chat_sessions/${date}`);
    await docRef.set({
      date,
      messages: FieldValue.arrayUnion(...clean),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  },

  /** Reads a single day's chat transcript, or null if none exists yet. */
  async getChatSession(db: Firestore, userId: string, date: string): Promise<ChatSession | null> {
    const docRef = db.doc(`users/${userId}/chat_sessions/${date}`);
    const snap = await docRef.get();
    return snap.exists ? (snap.data() as ChatSession) : null;
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

  /**
   * Fetch ALL non-ignored log entries in a date range, paging past Firestore's
   * per-query ceiling so long lookbacks (e.g. 90–180 days for a heavy logger)
   * come back complete instead of silently truncated. Cursor pagination by the
   * document snapshot keeps multiple same-date entries intact.
   */
  async queryLogRangeAll(
    db: Firestore,
    userId: string,
    collectionName: 'food_log' | 'exercise_log',
    startDate: string,
    endDate: string,
    hardCap = 5000,
  ): Promise<Array<Record<string, unknown>>> {
    const ref = db.collection(`users/${userId}/${collectionName}`);
    const PAGE = 500;
    const out: Array<Record<string, unknown>> = [];
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    while (out.length < hardCap) {
      let q = ref
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .orderBy('date', 'asc')
        .limit(PAGE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      for (const d of snap.docs) out.push({ ...d.data(), id: d.id });
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < PAGE) break;
    }
    return out.filter((e) => !(e as { ignored?: boolean }).ignored);
  },

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

  // --- Shared Meals (public link sharing) ---

  /** Fetches specific food_log entries by ID for a user (preserves request order, skips missing). */
  async getFoodEntriesByIds(db: Firestore, userId: string, ids: string[]): Promise<FoodLogEntry[]> {
    const out: FoodLogEntry[] = [];
    for (const id of ids) {
      const snap = await db.doc(`users/${userId}/food_log/${id}`).get();
      if (snap.exists) out.push({ ...snap.data(), id: snap.id } as FoodLogEntry);
    }
    return out;
  },

  /**
   * Creates a public, token-addressable shared meal at root `shared_meals/{id}`.
   * Computes totals from the snapshot items. The auto-generated doc ID is the
   * unguessable link token. Returns the share ID.
   */
  async createMealShare(
    db: Firestore,
    params: { createdBy: string; createdByName?: string; items: SharedMealItem[]; title: string },
  ): Promise<string> {
    const totals = params.items.reduce(
      (acc, it) => ({
        calories: acc.calories + (it.calories || 0),
        proteinG: acc.proteinG + (it.proteinG || 0),
        carbsG: acc.carbsG + (it.carbsG || 0),
        fatG: acc.fatG + (it.fatG || 0),
        fiberG: acc.fiberG + (it.fiberG || 0),
      }),
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
    );

    const docRef = db.collection('shared_meals').doc();
    const data = this.deepClean({
      id: docRef.id,
      createdBy: params.createdBy,
      createdByName: params.createdByName,
      items: params.items,
      title: params.title,
      totals,
      visibility: 'link' as const,
      logCount: 0,
      viewCount: 0,
      revoked: false,
      expiresAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    await docRef.set(data);
    return docRef.id;
  },

  /** Reads a shared meal by ID, or null if it doesn't exist. */
  async getSharedMeal(db: Firestore, shareId: string): Promise<SharedMeal | null> {
    const snap = await db.doc(`shared_meals/${shareId}`).get();
    if (!snap.exists) return null;
    return { ...snap.data(), id: snap.id } as SharedMeal;
  },

  /** Caches the generated CFO welcome greeting on the share. Best-effort — never throws. */
  async saveShareAssessment(db: Firestore, shareId: string, assessment: string): Promise<void> {
    try {
      await db.doc(`shared_meals/${shareId}`).update({ cfoAssessment: assessment });
    } catch {
      /* non-fatal — we'll just regenerate next view */
    }
  },

  /** Best-effort view counter bump — never throws (view tracking must not break the page). */
  async incrementShareViewCount(db: Firestore, shareId: string): Promise<void> {
    try {
      await db.doc(`shared_meals/${shareId}`).update({ viewCount: FieldValue.increment(1) });
    } catch {
      /* non-fatal */
    }
  },

  /** Returns all non-expired shares created by the given user, newest first. */
  async getSharesByUser(db: Firestore, userId: string): Promise<SharedMeal[]> {
    const snap = await db
      .collection('shared_meals')
      .where('createdBy', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return snap.docs.map(d => ({ ...d.data(), id: d.id }) as SharedMeal);
  },

  async revokeShare(db: Firestore, shareId: string, requestingUserId: string): Promise<boolean> {
    const docRef = db.doc(`shared_meals/${shareId}`);
    const snap = await docRef.get();
    if (!snap.exists) return false;
    const data = snap.data() as SharedMeal;
    if (data.createdBy !== requestingUserId) return false;
    await docRef.update({ revoked: true });
    return true;
  },
};
