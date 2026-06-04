import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncFitbitSnapshot } from '../fitbit-sync';
import { adminHealthService } from '../health-service-admin';
import { fitbitService } from '../fitbit-service';
import type { HistoryEntry } from '../health-service';

// Mock getAdminFirestore
vi.mock('@/firebase/admin', () => ({
  getAdminFirestore: vi.fn(() => ({})),
}));

// Mock fitbitService
vi.mock('../fitbit-service', () => ({
  fitbitService: {
    syncTodayData: vi.fn(),
    refreshAccessToken: vi.fn(),
  },
  FitbitApiError: class extends Error {
    constructor(public status: number, public endpoint: string, message: string) {
      super(message);
    }
  },
}));

// Mock adminHealthService
vi.mock('../health-service-admin', () => ({
  adminHealthService: {
    getFitbitCredentials: vi.fn(),
    saveFitbitCredentials: vi.fn(),
    saveFitbitDailySnapshot: vi.fn(),
    queryFoodLog: vi.fn(),
    queryExerciseLog: vi.fn(),
    getHealthSummary: vi.fn(),
    getUserPreferences: vi.fn(),
    updateHealthData: vi.fn(),
  },
}));

describe('syncFitbitSnapshot score recalculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates fitbit snapshot but skips score recalculation if no history entry exists', async () => {
    // 1. Mock Fitbit credentials (not expired)
    vi.mocked(adminHealthService.getFitbitCredentials).mockResolvedValue({
      accessToken: 'valid-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 1000 * 60 * 60, // 1 hour in future
      fitbitUserId: 'user1',
      lastSyncedAt: Date.now(),
      timezoneOffset: 0,
    });

    // 2. Mock Fitbit sync API response
    vi.mocked(fitbitService.syncTodayData).mockResolvedValue({
      success: true,
      steps: { value: 10000, source: 'device' },
      sleep: { value: 7.5, source: 'device' },
      hrv: { value: 45, source: 'device' },
      caloriesOut: { value: 3000, source: 'device' },
      isVerified: true,
    });

    // 3. Mock logs and health summary (no history entry matching '2026-05-24')
    vi.mocked(adminHealthService.queryFoodLog).mockResolvedValue([]);
    vi.mocked(adminHealthService.queryExerciseLog).mockResolvedValue([]);
    vi.mocked(adminHealthService.getUserPreferences).mockResolvedValue({
      weeklySchedule: '',
      equipment: [],
      targets: { proteinGoal: 150, fatPointsGoal: 3000 },
      profile: {},
    });
    vi.mocked(adminHealthService.getHealthSummary).mockResolvedValue({
      steps: 0,
      hrv: 50,
      sleepHours: 7,
      recoveryStatus: 'medium',
      dailyProteinG: 0,
      dailyCarbsG: 0,
      dailyCaloriesIn: 0,
      dailyCaloriesOut: 2000,
      visceralFatPoints: 100,
      history: [
        {
          date: 'May 23',
          isoDate: '2026-05-23',
          gain: 10,
          status: 'Bullish',
          detail: 'Created',
          equity: 10,
        },
      ],
      isAnonymous: false,
      onboardingDay: 1,
      onboardingComplete: true,
      isDeviceVerified: true,
    });

    const result = await syncFitbitSnapshot('user-123', '2026-05-24', 0);
    expect(result.success).toBe(true);

    // Verify snapshot is saved
    expect(adminHealthService.saveFitbitDailySnapshot).toHaveBeenCalledWith(
      expect.any(Object),
      'user-123',
      '2026-05-24',
      {
        steps: 10000,
        sleepHours: 7.5,
        hrv: 45,
        recoveryStatus: 'medium',
        caloriesOut: 2700, // 3000 * 0.9
      }
    );

    // Verify health summary was NOT updated (since no history entry matched '2026-05-24')
    expect(adminHealthService.updateHealthData).not.toHaveBeenCalled();
  });

  it('recalculates daily score and updates history + cumulative visceralFatPoints if history entry exists', async () => {
    // 1. Mock Fitbit credentials (not expired)
    vi.mocked(adminHealthService.getFitbitCredentials).mockResolvedValue({
      accessToken: 'valid-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 1000 * 60 * 60,
      fitbitUserId: 'user1',
      lastSyncedAt: Date.now(),
      timezoneOffset: 0,
    });

    // 2. Mock Fitbit sync API response (new caloriesOut = 3300 -> adjusted = 2970)
    vi.mocked(fitbitService.syncTodayData).mockResolvedValue({
      success: true,
      steps: { value: 12000, source: 'device' },
      sleep: { value: 8, source: 'device' },
      hrv: { value: 60, source: 'device' },
      caloriesOut: { value: 3300, source: 'device' }, // adjusted will be 2970
      isVerified: true,
    });

    // 3. Mock Food/Exercise logs
    // Food log has 1500 kcal, 160g protein, 0 drinks
    vi.mocked(adminHealthService.queryFoodLog).mockResolvedValue([
      {
        id: 'f1',
        date: '2026-05-24',
        calories: 1500,
        proteinG: 160,
        carbsG: 100,
        fatG: 50,
        portionG: 200,
        fiberG: 5,
        source: 'user_estimate',
        meal: 'lunch',
        timestamp: {} as any,
        name: 'Meal 1',
      },
    ]);
    vi.mocked(adminHealthService.queryExerciseLog).mockResolvedValue([]);

    vi.mocked(adminHealthService.getUserPreferences).mockResolvedValue({
      weeklySchedule: '',
      equipment: [],
      targets: { proteinGoal: 150, fatPointsGoal: 3000 },
      profile: {},
    });

    // 4. Mock Health summary with history entry for '2026-05-24'
    // Old caloriesOut was 4200 (adjusted = 3780) -> old deficit = 3780 - 1500 = 2280 -> score = 228 points
    // New caloriesOut is 2970 -> new deficit = 2970 - 1500 = 1470 -> score = 147 points
    // Difference is 147 - 228 = -81 points
    const initialHistory: HistoryEntry[] = [
      {
        date: 'May 23',
        isoDate: '2026-05-23',
        gain: 10,
        status: 'Bullish',
        detail: 'Created',
        equity: 10,
      },
      {
        date: 'May 24',
        isoDate: '2026-05-24',
        gain: 228,
        status: 'Bullish',
        detail: 'Old detail',
        equity: 238,
        breakdown: {
          caloriesIn: 1500,
          caloriesOut: 3780,
          proteinG: 160,
          proteinGoal: 150,
          fastingHours: 0,
          alcoholDrinks: 0,
          sleepHours: 8,
          seedOilMeals: 0,
        },
      },
      {
        date: 'May 25',
        isoDate: '2026-05-25',
        gain: 20,
        status: 'Bullish',
        detail: 'Other day',
        equity: 258,
      },
    ];

    vi.mocked(adminHealthService.getHealthSummary).mockResolvedValue({
      steps: 0,
      hrv: 50,
      sleepHours: 7,
      recoveryStatus: 'medium',
      dailyProteinG: 0,
      dailyCarbsG: 0,
      dailyCaloriesIn: 0,
      dailyCaloriesOut: 2000,
      visceralFatPoints: 258,
      history: initialHistory,
      isAnonymous: false,
      onboardingDay: 1,
      onboardingComplete: true,
      isDeviceVerified: true,
    });

    const result = await syncFitbitSnapshot('user-123', '2026-05-24', 0);
    expect(result.success).toBe(true);

    // Verify snapshot is saved
    expect(adminHealthService.saveFitbitDailySnapshot).toHaveBeenCalledWith(
      expect.any(Object),
      'user-123',
      '2026-05-24',
      {
        steps: 12000,
        sleepHours: 8,
        hrv: 60,
        recoveryStatus: 'high',
        caloriesOut: 2970, // 3300 * 0.9
      }
    );

    // Verify health summary was updated with recalculated history and points
    expect(adminHealthService.updateHealthData).toHaveBeenCalled();
    const mockCalls = vi.mocked(adminHealthService.updateHealthData).mock.calls;
    const updates = mockCalls[0][2]; // first call, third arg (or second arg if 0 is db, 1 is userId, 2 is updates)
    // Wait, updateHealthData signature in health-service-admin: (db, userId, updates)
    // So arguments are: (firestore, 'user-123', updates)
    const updatePayload = mockCalls[0][2] as any;
    
    // Difference: newScore (28) - oldScore (228) = -200
    // New visceralFatPoints = 258 - 200 = 58
    // (Alpert-normalized v2: 654 kcal fat burned ÷ 813 (70% of 1162 Alpert) × 100,
    //  less 412 kcal stored — a far cry from the old deficit/10 = 228.)
    expect(updatePayload.visceralFatPoints).toBe(58);

    // Verify history entries:
    // entry 1: equity remains 10
    // entry 2: gain=28, equity=10+28=38
    // entry 3: gain=20, equity=38+20=58
    const newHistory = updatePayload.history;
    expect(newHistory[0].equity).toBe(10);

    expect(newHistory[1].gain).toBe(28);
    expect(newHistory[1].equity).toBe(38);
    expect(newHistory[1].breakdown.caloriesOut).toBe(2970);
    expect(newHistory[1].breakdown.deficit).toBe(1470); // 2970 - 1500

    expect(newHistory[2].equity).toBe(58);
  });
});
