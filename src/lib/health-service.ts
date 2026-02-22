
export interface HealthData {
  steps: number;
  hrv: number;
  sleepHours: number;
  recoveryStatus: 'low' | 'medium' | 'high';
  protein_g: number;
  visceral_fat_points: number;
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
};

export const mockHealthService = {
  async getHealthSummary(): Promise<HealthData> {
    // Simulating minor network latency
    await new Promise(resolve => setTimeout(resolve, 50));
    return { ...currentHealth };
  },

  async updateHealthData(updates: Partial<HealthData>): Promise<HealthData> {
    // This is the "Portfolio Transaction" logic.
    // We update the local state which triggers the dashboard refresh on the next fetch.
    currentHealth = { 
      ...currentHealth, 
      ...updates,
      protein_g: Math.max(0, (updates.protein_g !== undefined ? updates.protein_g : currentHealth.protein_g)),
      visceral_fat_points: Math.max(0, (updates.visceral_fat_points !== undefined ? updates.visceral_fat_points : currentHealth.visceral_fat_points))
    };
    return { ...currentHealth };
  },

  async requestPermissions(): Promise<boolean> {
    return true;
  }
};
