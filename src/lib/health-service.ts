export interface HistoryEntry {
  date: string;
  gain: number;
  status: 'Bullish' | 'Stable' | 'Correction';
  detail: string;
  equity: number;
}

export interface HealthData {
  steps: number;
  hrv: number;
  sleepHours: number;
  recoveryStatus: 'low' | 'medium' | 'high';
  protein_g: number;
  visceral_fat_points: number;
  history: HistoryEntry[];
}

/**
 * MOCK HEALTH SERVICE (MUTABLE SINGLETON)
 * 
 * In a real app, this would be a Firestore collection. 
 * For this MVP, we use a mutable singleton to allow the AI to 
 * 'write' to your portfolio in real-time.
 */
let currentHealth: HealthData = {
  steps: 8432,
  hrv: 62,
  sleepHours: 7.2,
  recoveryStatus: 'medium',
  protein_g: 110,
  visceral_fat_points: 1250,
  history: [
    { date: "Oct 24", gain: 350, status: "Bullish", detail: "High Protein Intake | Solvency Met", equity: 1250 },
    { date: "Oct 23", gain: 150, status: "Stable", detail: "Recovery Audit: Prime", equity: 900 },
    { date: "Oct 22", gain: 200, status: "Bullish", detail: "Capital Infusion: Leg Day", equity: 750 },
    { date: "Oct 21", gain: -50, status: "Correction", detail: "Liquidity Shortage | Sleep Debt", equity: 550 },
  ]
};

export const mockHealthService = {
  async getHealthSummary(): Promise<HealthData> {
    await new Promise(resolve => setTimeout(resolve, 50));
    return { ...currentHealth };
  },

  async updateHealthData(updates: Partial<HealthData>): Promise<HealthData> {
    currentHealth = { 
      ...currentHealth, 
      ...updates,
      protein_g: Math.max(0, (updates.protein_g !== undefined ? updates.protein_g : currentHealth.protein_g)),
      visceral_fat_points: Math.max(0, (updates.visceral_fat_points !== undefined ? updates.visceral_fat_points : currentHealth.visceral_fat_points)),
      history: updates.history || currentHealth.history
    };
    return { ...currentHealth };
  },

  async addHistoryEntry(entry: HistoryEntry) {
    currentHealth.history = [entry, ...currentHealth.history];
    if (currentHealth.history.length > 14) {
      currentHealth.history = currentHealth.history.slice(0, 14);
    }
    return currentHealth.history;
  },

  async updateHistoryEntry(date: string, updates: Partial<HistoryEntry>) {
    const index = currentHealth.history.findIndex(h => h.date === date);
    if (index !== -1) {
      currentHealth.history[index] = { ...currentHealth.history[index], ...updates };
      // If equity changed, we might need to re-calculate subsequent running totals, 
      // but for this MVP we update the specific record.
      if (updates.equity !== undefined && index === 0) {
        currentHealth.visceral_fat_points = updates.equity;
      }
    }
    return currentHealth.history;
  },

  async batchUpdateHistory(entries: HistoryEntry[]) {
    currentHealth.history = [...entries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (entries.length > 0) {
      currentHealth.visceral_fat_points = entries[0].equity;
    }
    return currentHealth.history;
  },

  async requestPermissions(): Promise<boolean> {
    return true;
  }
};
