
import { doc, getDoc, setDoc, updateDoc, collection, addDoc, query, orderBy, limit, getDocs, where, Firestore, serverTimestamp, arrayUnion, FieldValue, Timestamp, deleteDoc } from 'firebase/firestore';
import type { FoodLogEntry, ExerciseLogEntry, UserProfile } from './food-exercise-types';

/**
 * @fileOverview Health service for managing fitness portfolio data in Firestore.
 */

export type { FoodLogEntry, ExerciseLogEntry, UserProfile };

export interface VFBreakdown {
  caloriesIn: number;
  caloriesOut: number;
  proteinG: number;
  proteinGoal: number;
  fastingHours: number;
  alcoholDrinks: number;
  sleepHours: number;
  seedOilMeals: number;
  // Alpert-based scoring (new)
  alpertNumber?: number;
  deficit?: number;
  proteinMet?: boolean;
  fastingActive?: boolean;
  alcoholFlag?: boolean;
  poorSleep?: boolean;
  // Legacy rule-based fields (kept for backward compat with old history entries)
  baseScore?: number;
  fastingOverride?: boolean;
  alcoholCap?: boolean;
  alcoholPenalty?: number;
  cortisolMultiplier?: number;
  seedOilPenalty?: number;
}

export interface HistoryEntry {
  date: string;
  isoDate?: string;          // "YYYY-MM-DD" for reliable date lookups
  gain: number;
  status: 'Bullish' | 'Stable' | 'Correction' | 'Bullish Entry';
  detail: string;
  equity: number;
  breakdown?: VFBreakdown;   // full scoring breakdown for day-detail view
}

export interface HealthLog {
  id?: string;
  userId: string;
  timestamp: FieldValue | Timestamp;
  category: 'explosiveness' | 'strength' | 'food' | 'recovery' | 'health_sync' | 'vanity_audit';
  content: string;
  metrics: string[];
  verified?: boolean;
}

/** Per-day Fitbit metrics snapshot — keyed by YYYY-MM-DD in fitbitByDate. */
export interface FitbitDailySnapshot {
  steps?: number;
  hrv?: number;
  sleepHours?: number;
  recoveryStatus?: 'low' | 'medium' | 'high';
  caloriesOut?: number;
}

export interface HealthData {
  id?: string;
  steps: number;
  hrv: number;
  sleepHours: number;
  recoveryStatus: 'low' | 'medium' | 'high';
  dailyProteinG: number;
  dailyCarbsG: number;
  dailyCaloriesIn: number;
  dailyCaloriesOut: number;
  visceralFatPoints: number;
  heightCm?: number;
  weightKg?: number;
  bodyFatPct?: number;    // 0-100, from DEXA/assessment; used for glycogen capacity estimate
  history: HistoryEntry[];
  fitbitByDate?: Record<string, FitbitDailySnapshot>; // per-day Fitbit snapshots keyed by YYYY-MM-DD
  updatedAt?: FieldValue | Timestamp;
  createdAt?: FieldValue | Timestamp;
  isAnonymous: boolean;
  onboardingDay: number;
  onboardingComplete: boolean;
  isDeviceVerified: boolean;
  connectedDevice?: 'fitbit' | 'oura'; // which wearable is currently linked
  lastActiveDate?: string;
}

export interface FoodNickname {
  nickname: string;          // e.g. "The IPO"
  description: string;       // e.g. "Double protein shake"
  items: string[];           // e.g. ["2 scoops whey protein", "almond milk", "banana"]
  totalCalories: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
}

export interface TemporaryContext {
  context: string;   // free-text description, e.g. "Traveling to Vegas for 4 days"
  expiresAt: string; // "YYYY-MM-DD" — context is ignored after this date
}

export interface UserPreferences {
  weeklySchedule: string;
  equipment: string[];
  targets: {
    proteinGoal: number;
    fatPointsGoal: number;
  };
  profile: UserProfile;
  foodNicknames?: Record<string, FoodNickname>; // keyed by lowercase nickname
  temporaryContext?: TemporaryContext;           // short-term schedule/situation override
  autoChatEnabled?: boolean;                    // auto-start chat on Coach tab mount (default true)
}

export interface FitbitCredentials {
  accessToken: string;
  refreshToken: string;
  fitbitUserId: string;
  expiresAt: number; // Unix ms timestamp
  lastSyncedAt?: number; // Unix ms timestamp of last successful data sync
}

export interface OuraCredentials {
  accessToken: string;
  refreshToken: string;
  ouraUserId: string;
  expiresAt: number; // Unix ms timestamp
  lastSyncedAt?: number; // Unix ms timestamp of last successful data sync
}

export const healthService = {
  async getHealthSummary(db: Firestore, userId: string): Promise<HealthData | null> {
    const docRef = doc(db, 'users', userId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) return docSnap.data() as HealthData;

    const initialData: HealthData = {
      steps: 0,
      hrv: 50,
      sleepHours: 7,
      recoveryStatus: 'medium',
      dailyProteinG: 0,
      dailyCarbsG: 0,
      dailyCaloriesIn: 0,
      dailyCaloriesOut: 2000, // Default estimate
      visceralFatPoints: 1250, // Starting equity
      history: [{
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        gain: 0,
        status: 'Stable',
        detail: 'Portfolio Initialized',
        equity: 1250
      }],
      isAnonymous: true,
      onboardingDay: 1,
      onboardingComplete: false,
      isDeviceVerified: false,
      lastActiveDate: new Date().toISOString().split('T')[0],
      createdAt: serverTimestamp(),
    };
    await setDoc(docRef, initialData);
    return initialData;
  },

  async updateHealthData(db: Firestore, userId: string, updates: Partial<HealthData>): Promise<void> {
    const docRef = doc(db, 'users', userId);
    await updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
  },

  async recordEquityEvent(db: Firestore, userId: string, entry: HistoryEntry): Promise<void> {
    const docRef = doc(db, 'users', userId);
    await updateDoc(docRef, {
      history: arrayUnion(entry),
      updatedAt: serverTimestamp()
    });
  },

  async getUserPreferences(db: Firestore, userId: string): Promise<UserPreferences | null> {
    const docRef = doc(db, 'users', userId, 'preferences', 'settings');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) return docSnap.data() as UserPreferences;

    const defaultPrefs: UserPreferences = {
      weeklySchedule: JSON.stringify({
        "Mon": "Pending Audit",
        "Tue": "Pending Audit",
        "Wed": "Pending Audit",
        "Thu": "Pending Audit",
        "Fri": "Pending Audit",
        "Sat": "Pending Audit",
        "Sun": "Pending Audit"
      }, null, 2),
      equipment: [],
      targets: { proteinGoal: 150, fatPointsGoal: 3000 },
      profile: {},
      autoChatEnabled: true,
    };
    await setDoc(docRef, defaultPrefs, { merge: true });
    return defaultPrefs;
  },

  async updateUserPreferences(db: Firestore, userId: string, updates: Partial<UserPreferences>): Promise<void> {
    const docRef = doc(db, 'users', userId, 'preferences', 'settings');
    await setDoc(docRef, updates, { merge: true });
  },

  async saveFitbitCredentials(db: Firestore, userId: string, creds: FitbitCredentials): Promise<void> {
    const docRef = doc(db, 'users', userId, 'preferences', 'fitbit_tokens');
    await setDoc(docRef, creds);
  },

  async getFitbitCredentials(db: Firestore, userId: string): Promise<FitbitCredentials | null> {
    const docRef = doc(db, 'users', userId, 'preferences', 'fitbit_tokens');
    const snap = await getDoc(docRef);
    return snap.exists() ? (snap.data() as FitbitCredentials) : null;
  },

  async deleteFitbitCredentials(db: Firestore, userId: string): Promise<void> {
    const docRef = doc(db, 'users', userId, 'preferences', 'fitbit_tokens');
    await deleteDoc(docRef);
  },

  async saveOuraCredentials(db: Firestore, userId: string, creds: OuraCredentials): Promise<void> {
    const docRef = doc(db, 'users', userId, 'preferences', 'oura_tokens');
    await setDoc(docRef, creds);
  },

  async getOuraCredentials(db: Firestore, userId: string): Promise<OuraCredentials | null> {
    const docRef = doc(db, 'users', userId, 'preferences', 'oura_tokens');
    const snap = await getDoc(docRef);
    return snap.exists() ? (snap.data() as OuraCredentials) : null;
  },

  async deleteOuraCredentials(db: Firestore, userId: string): Promise<void> {
    const docRef = doc(db, 'users', userId, 'preferences', 'oura_tokens');
    await deleteDoc(docRef);
  },

  async logActivity(db: Firestore, userId: string, log: Omit<HealthLog, 'userId' | 'timestamp'>) {
    const logsRef = collection(db, 'users', userId, 'logs');
    await addDoc(logsRef, { ...log, userId, timestamp: serverTimestamp() });
  },

  async queryLogs(db: Firestore, userId: string, category?: string, limitCount: number = 10): Promise<HealthLog[]> {
    const logsRef = collection(db, 'users', userId, 'logs');
    let q = query(logsRef, orderBy('timestamp', 'desc'), limit(limitCount));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as HealthLog);
  },

  // --- Structured Food Log ---

  async logFood(db: Firestore, userId: string, entry: Omit<FoodLogEntry, 'timestamp'>): Promise<string> {
    const ref = collection(db, 'users', userId, 'food_log');
    const docRef = await addDoc(ref, { ...entry, timestamp: serverTimestamp() });
    return docRef.id;
  },

  async queryFoodLog(db: Firestore, userId: string, date?: string, limitCount: number = 20): Promise<FoodLogEntry[]> {
    const ref = collection(db, 'users', userId, 'food_log');
    let q;
    if (date) {
      // Single-field filter avoids composite index requirement
      q = query(ref, where('date', '==', date), limit(limitCount));
    } else {
      q = query(ref, orderBy('timestamp', 'desc'), limit(limitCount));
    }
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map(d => ({ ...d.data(), id: d.id }) as FoodLogEntry)
      .filter(e => !e.ignored);
  },

  // --- Structured Exercise Log ---

  async logExercise(db: Firestore, userId: string, entry: Omit<ExerciseLogEntry, 'timestamp'>): Promise<string> {
    const ref = collection(db, 'users', userId, 'exercise_log');
    // Strip undefined fields — Firestore rejects documents containing undefined values.
    const clean = Object.fromEntries(
      Object.entries({ ...entry, timestamp: serverTimestamp() }).filter(([, v]) => v !== undefined)
    );
    const docRef = await addDoc(ref, clean);
    return docRef.id;
  },

  async queryExerciseLog(db: Firestore, userId: string, date?: string, limitCount: number = 20): Promise<ExerciseLogEntry[]> {
    const ref = collection(db, 'users', userId, 'exercise_log');
    let q;
    if (date) {
      q = query(ref, where('date', '==', date), limit(limitCount));
    } else {
      q = query(ref, orderBy('timestamp', 'desc'), limit(limitCount));
    }
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map(d => ({ ...d.data(), id: d.id }) as ExerciseLogEntry)
      .filter(e => !e.ignored);
  }
};
