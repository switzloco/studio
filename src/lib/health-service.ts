'use client';

import { doc, getDoc, setDoc, updateDoc, Firestore, serverTimestamp } from 'firebase/firestore';

export interface HistoryEntry {
  date: string;
  gain: number;
  status: 'Bullish' | 'Stable' | 'Correction';
  detail: string;
  equity: number;
}

export interface HealthData {
  id?: string;
  steps: number;
  hrv: number;
  sleepHours: number;
  recoveryStatus: 'low' | 'medium' | 'high';
  protein_g: number;
  visceral_fat_points: number;
  history: HistoryEntry[];
  updatedAt?: any;
  createdAt?: any;
  isAnonymous: boolean;
}

/**
 * HEALTH SERVICE (FIRESTORE BACKED)
 */
export const healthService = {
  async getHealthSummary(db: Firestore, userId: string): Promise<HealthData | null> {
    const docRef = doc(db, 'users', userId);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return docSnap.data() as HealthData;
    }
    
    // Initialize if doesn't exist
    const initialData: HealthData = {
      steps: 0,
      hrv: 50,
      sleepHours: 7,
      recoveryStatus: 'medium',
      protein_g: 0,
      visceral_fat_points: 0,
      history: [],
      isAnonymous: true,
      createdAt: serverTimestamp(),
    };
    
    await setDoc(docRef, initialData);
    return initialData;
  },

  async updateHealthData(db: Firestore, userId: string, updates: Partial<HealthData>): Promise<void> {
    const docRef = doc(db, 'users', userId);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  },

  async addHistoryEntry(db: Firestore, userId: string, entry: HistoryEntry) {
    const current = await this.getHealthSummary(db, userId);
    if (!current) return;
    
    const newHistory = [entry, ...current.history].slice(0, 30);
    await this.updateHealthData(db, userId, { history: newHistory });
  },

  async updateHistoryEntry(db: Firestore, userId: string, date: string, updates: Partial<HistoryEntry>) {
    const current = await this.getHealthSummary(db, userId);
    if (!current) return;

    const index = current.history.findIndex(h => h.date === date);
    if (index !== -1) {
      const updatedHistory = [...current.history];
      updatedHistory[index] = { ...updatedHistory[index], ...updates };
      
      const payload: Partial<HealthData> = { history: updatedHistory };
      if (updates.equity !== undefined && index === 0) {
        payload.visceral_fat_points = updates.equity;
      }
      
      await this.updateHealthData(db, userId, payload);
    }
  },

  async batchUpdateHistory(db: Firestore, userId: string, entries: HistoryEntry[]) {
    const sorted = [...entries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const payload: Partial<HealthData> = { 
      history: sorted,
      visceral_fat_points: sorted.length > 0 ? sorted[0].equity : 0
    };
    await this.updateHealthData(db, userId, payload);
  }
};
