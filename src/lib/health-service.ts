
import { doc, getDoc, setDoc, updateDoc, collection, addDoc, query, orderBy, limit, getDocs, where, Firestore, serverTimestamp, arrayUnion, FieldValue, Timestamp } from 'firebase/firestore';
import type { FoodLogEntry, ExerciseLogEntry, UserProfile } from './food-exercise-types';

/**
 * @fileOverview Health service for managing fitness portfolio data in Firestore.
 */

export type { FoodLogEntry, ExerciseLogEntry, UserProfile };

export interface HistoryEntry {
  date: string;
  gain: number;
  status: 'Bullish' | 'Stable' | 'Correction' | 'Bullish Entry';
  detail: string;
  equity: number;
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

export interface HealthData {
  id?: string;
  steps: number;
  hrv: number;
  sleepHours: number;
  recoveryStatus: 'low' | 'medium' | 'high';
  dailyProteinG: number;
  visceralFatPoints: number;
  heightCm?: number;
  weightKg?: number;
  history: HistoryEntry[];
  updatedAt?: FieldValue | Timestamp;
  createdAt?: FieldValue | Timestamp;
  isAnonymous: boolean;
  onboardingDay: number;
  onboardingComplete: boolean;
  isDeviceVerified: boolean;
}

export interface UserPreferences {
  weeklySchedule: string;
  equipment: string[];
  targets: {
    proteinGoal: number;
    fatPointsGoal: number;
  };
  profile: UserProfile;
}

export interface FitbitCredentials {
  accessToken: string;
  refreshToken: string;
  fitbitUserId: string;
  expiresAt: number; // Unix ms timestamp
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
      profile: {}
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
    return snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as FoodLogEntry);
  },

  // --- Structured Exercise Log ---

  async logExercise(db: Firestore, userId: string, entry: Omit<ExerciseLogEntry, 'timestamp'>): Promise<string> {
    const ref = collection(db, 'users', userId, 'exercise_log');
    const docRef = await addDoc(ref, { ...entry, timestamp: serverTimestamp() });
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
    return snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as ExerciseLogEntry);
  }
};
