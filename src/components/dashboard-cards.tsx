
'use client';

import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Target, Zap, DollarSign, Briefcase, Loader2, ShieldAlert, CloudLightning, ShieldCheck, Scale, Ruler, RefreshCw, Unplug, CalendarIcon, RotateCcw, AlertTriangle } from "lucide-react";
import { HealthData, UserPreferences, FitbitCredentials, OuraCredentials, healthService } from '@/lib/health-service';
import { fitbitService } from '@/lib/fitbit-service';
import { ouraService } from '@/lib/oura-service';
import { syncFitbitData, syncFitbitSnapshot, SyncResult } from '@/app/actions/fitbit';
import { syncOuraData, OuraSyncResult } from '@/app/actions/oura';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { DashboardCharts, computeMaxGlycogenKcal, LIVER_MAX_KCAL } from './dashboard-charts';
import { computeAlpertNumber, calculateDailyVFScore } from '@/lib/vf-scoring';
import { runMetabolicSimulation } from '@/lib/metabolic-engine';
import { useToast } from '@/hooks/use-toast';
import { doc, collection, query, where, limit, Timestamp } from 'firebase/firestore';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { FoodLogEntry, ExerciseLogEntry } from '@/lib/food-exercise-types';

function formatTimeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface DashboardCardsProps {
  data: HealthData | null;
  isLoading?: boolean;
}

export function DashboardCards({ data, isLoading }: DashboardCardsProps) {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  // Read targets from user preferences instead of hardcoding
  const prefsRef = useMemoFirebase(
    () => user ? doc(db, 'users', user.uid, 'preferences', 'settings') : null,
    [db, user]
  );
  const { data: prefs } = useDoc<UserPreferences>(prefsRef);

  // Read Fitbit credentials to show lastSyncedAt in the UI.
  const fitbitTokensRef = useMemoFirebase(
    () => user ? doc(db, 'users', user.uid, 'preferences', 'fitbit_tokens') : null,
    [db, user]
  );
  const { data: fitbitCreds } = useDoc<FitbitCredentials>(fitbitTokensRef);

  // Read Oura credentials to show lastSyncedAt in the UI.
  const ouraTokensRef = useMemoFirebase(
    () => user ? doc(db, 'users', user.uid, 'preferences', 'oura_tokens') : null,
    [db, user]
  );
  const { data: ouraCreds } = useDoc<OuraCredentials>(ouraTokensRef);

  // Today's date string (YYYY-MM-DD)
  const todayStr = React.useMemo(() => {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');
  }, []);

  // Selected date for viewing (defaults to today)
  const [selectedDateStr, setSelectedDateStr] = React.useState<string>(todayStr);
  const [calendarOpen, setCalendarOpen] = React.useState(false);

  const isViewingToday = selectedDateStr === todayStr;

  // Previous day ISO string — used to query yesterday's logs for glycogen carry-over
  const prevDateStr = React.useMemo(() => {
    const [y, m, d] = selectedDateStr.split('-').map(Number);
    const prev = new Date(y, m - 1, d - 1);
    return prev.getFullYear() + '-'
      + String(prev.getMonth() + 1).padStart(2, '0') + '-'
      + String(prev.getDate()).padStart(2, '0');
  }, [selectedDateStr]);

  const selectedDateObj = React.useMemo(() => {
    const [y, m, d] = selectedDateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [selectedDateStr]);

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    const str = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, '0') + "-" + String(date.getDate()).padStart(2, '0');
    setSelectedDateStr(str);
    setCalendarOpen(false);
  };

  // History entry for the selected date (used to get calories out on past days)
  const historyEntry = React.useMemo(() => {
    if (!data?.history || isViewingToday) return null;
    return data.history.find(h => (h.isoDate || h.date) === selectedDateStr) ?? null;
  }, [data?.history, selectedDateStr, isViewingToday]);

  // Compute protein/calorie totals from the food log for the selected date
  const foodLogQuery = useMemoFirebase(
    () => user ? query(
      collection(db, 'users', user.uid, 'food_log'),
      where('date', '==', selectedDateStr),
      limit(50)
    ) : null,
    [db, user, selectedDateStr]
  );
  const { data: todayFoodLogs } = useCollection<FoodLogEntry>(foodLogQuery);

  // Exercise logs for the selected date (used for intraday glycogen timing)
  const exerciseLogQuery = useMemoFirebase(
    () => user ? query(
      collection(db, 'users', user.uid, 'exercise_log'),
      where('date', '==', selectedDateStr),
      limit(20)
    ) : null,
    [db, user, selectedDateStr]
  );
  const { data: todayExerciseLogs } = useCollection<ExerciseLogEntry>(exerciseLogQuery);

  // Previous day logs — needed for accurate muscle glycogen carry-over
  const prevFoodLogQuery = useMemoFirebase(
    () => user ? query(
      collection(db, 'users', user.uid, 'food_log'),
      where('date', '==', prevDateStr),
      limit(50)
    ) : null,
    [db, user, prevDateStr]
  );
  const { data: prevFoodLogs } = useCollection<FoodLogEntry>(prevFoodLogQuery);

  const prevExerciseLogQuery = useMemoFirebase(
    () => user ? query(
      collection(db, 'users', user.uid, 'exercise_log'),
      where('date', '==', prevDateStr),
      limit(20)
    ) : null,
    [db, user, prevDateStr]
  );
  const { data: prevExerciseLogs } = useCollection<ExerciseLogEntry>(prevExerciseLogQuery);

  // Morning muscle glycogen % — chains from previous day's end-of-day state.
  // Uses actual exercise + food logs from prev day when available; falls back to
  // history breakdown aggregate only if logs haven't loaded yet.
  const morningGlycogenPct = React.useMemo(() => {
    const totalMax  = computeMaxGlycogenKcal(data?.weightKg, data?.bodyFatPct);
    const muscleMax = Math.max(400, totalMax - LIVER_MAX_KCAL);

    // Tier → fraction of exercise calories that depletes muscle glycogen
    const MUSCLE_FRACTION: Record<string, number> = {
      tier1_walking:    0.40,  // mostly fat oxidation
      tier2_steady_state: 0.65,
      tier3_anaerobic:  0.85,  // high glycolytic demand (basketball, HIIT, weights)
    };

    // --- Use actual prev-day logs when available (most accurate) ---
    if (prevFoodLogs !== undefined && prevExerciseLogs !== undefined) {
      const activePrevFood = (prevFoodLogs ?? []).filter(e => !e.ignored);
      const activePrevEx   = (prevExerciseLogs ?? []).filter(e => !e.ignored);

      // Carb replenishment: total carbs → liver priority 30g (120 kcal) → rest to muscle
      const prevCarbKcal = activePrevFood.reduce((s, e) => s + ((e.carbsG || 0) * 4), 0);
      const muscleCarbs  = Math.max(0, prevCarbKcal - 120);

      // Exercise glycogen burn: per-exercise tier × adjusted calories
      const activeBurn = activePrevEx.reduce((s, e) => {
        const frac = e.activityTier ? (MUSCLE_FRACTION[e.activityTier] ?? 0.65) : 0.65;
        return s + ((e.adjustedCalories || 0) * frac);
      }, 0);

      const prevMuscleKcal = muscleMax; // yesterday morning assumed full
      const endMuscleKcal  = Math.max(0, Math.min(muscleMax, prevMuscleKcal - activeBurn + muscleCarbs));
      return Math.round((endMuscleKcal / muscleMax) * 100);
    }

    // --- Fallback: use history entry breakdown aggregate ---
    const history = data?.history;
    if (!history || history.length === 0) return 100;
    const prevEntry = history.find(h => (h.isoDate || h.date) === prevDateStr);
    if (!prevEntry?.breakdown) return 100;

    const { caloriesIn, caloriesOut } = prevEntry.breakdown;
    const activeBurnFallback = Math.max(0, caloriesOut - 1800) * 0.65;
    const totalCarbKcal  = caloriesIn * 0.35;
    const muscleCarbs    = Math.max(0, totalCarbKcal - 120);
    const endMuscleKcal  = Math.max(0, Math.min(muscleMax, muscleMax - activeBurnFallback + muscleCarbs));
    return Math.round((endMuscleKcal / muscleMax) * 100);
  }, [prevFoodLogs, prevExerciseLogs, data?.history, data?.weightKg, data?.bodyFatPct, prevDateStr]);

  // Sum from non-ignored entries
  const computedTotals = React.useMemo(() => {
    if (!todayFoodLogs) return null;
    const active = todayFoodLogs.filter(e => !e.ignored);
    return {
      proteinG: active.reduce((s, e) => s + (e.proteinG || 0), 0),
      caloriesIn: active.reduce((s, e) => s + (e.calories || 0), 0),
      carbsG: active.reduce((s, e) => s + (e.carbsG || 0), 0),
    };
  }, [todayFoodLogs]);

  const [isSyncing, setIsSyncing] = React.useState(false);
  const [isOuraSyncing, setIsOuraSyncing] = React.useState(false);

  // For past dates, read the stored Fitbit snapshot so steps/HRV show historical values.
  const fitbitForDate = !isViewingToday ? (data?.fitbitByDate?.[selectedDateStr] ?? null) : null;

  // Use computed totals from food_log (accurate) or fall back to user doc counter
  const dailyProteinG = computedTotals?.proteinG ?? (data?.dailyProteinG || 0);
  const dailyCaloriesIn = computedTotals?.caloriesIn ?? (data?.dailyCaloriesIn || 0);
  const dailyCarbsG = computedTotals?.carbsG ?? (data?.dailyCarbsG || 0);
  // For past dates, prefer the history breakdown, then the Fitbit/Oura snapshot, then current doc value.
  const dailyCaloriesOut = isViewingToday
    ? (data?.dailyCaloriesOut || 2000)
    : (historyEntry?.breakdown?.caloriesOut || fitbitForDate?.caloriesOut || data?.dailyCaloriesOut || 2000);

  // Fitbit auto-detected activities — used as glycogen fallback when no manual exercise is logged.
  // For today, use the live snapshot that was written on the last Fitbit sync.
  const fitbitActivities = isViewingToday
    ? data?.fitbitByDate?.[new Date().toLocaleDateString('en-CA')]?.activities
    : fitbitForDate?.activities;

  const visceralFatPoints = data?.visceralFatPoints || 0;
  const proteinGoal = prefs?.targets?.proteinGoal ?? 150;
  const fatPointsGoal = prefs?.targets?.fatPointsGoal ?? 3000;

  // Alpert daily score
  const alpertNumber = computeAlpertNumber(data?.weightKg || 0, data?.bodyFatPct || 0);
  const alpertDeficit = dailyCaloriesOut - dailyCaloriesIn;

  // For past days use stored score; for today run the 5-rule scoring engine.
  // Returns null when no food has been logged yet (avoid misleading estimates).
  const dailyAlpertScore = React.useMemo(() => {
    if (!data) return null;
    if (!isViewingToday && historyEntry) return historyEntry.gain;
    if (dailyCaloriesOut <= 0) return null;
    // Don't show a score before the user has logged any food — caloriesIn=0 with
    // no explicit fasting hours would produce a wildly optimistic estimate.
    if (isViewingToday && dailyCaloriesIn <= 0) return null;
    const result = calculateDailyVFScore({
      caloriesIn: dailyCaloriesIn,
      caloriesOut: dailyCaloriesOut,
      proteinG: dailyProteinG,
      proteinGoal,
      fastingHours: 0,   // not auto-tracked; user tells CFO coach
      alcoholDrinks: 0,  // not auto-tracked; user tells CFO coach
      sleepHours: data.sleepHours ?? 7,
      seedOilMeals: 0,   // not auto-tracked; user tells CFO coach
      weightKg: data.weightKg,
      bodyFatPct: data.bodyFatPct,
      foodLogs: todayFoodLogs ?? undefined,
      exerciseLogs: todayExerciseLogs ?? undefined,
      fitbitActivities,
    });
    return result.score;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isViewingToday, historyEntry, dailyCaloriesOut, dailyCaloriesIn, dailyProteinG,
      proteinGoal, alpertNumber, todayFoodLogs, todayExerciseLogs, fitbitActivities]);

  // Hourly Alpert pace — warn when the current deficit rate exceeds the sustainable ceiling.
  // alpertNumber is kcal/day; hourly budget = alpertNumber / 24.
  // If deficit so far > (alpertNumber × hoursElapsed / 24), the pace is unsustainable.
  const alpertPace = React.useMemo(() => {
    if (!data || !isViewingToday || dailyCaloriesIn <= 0 || dailyCaloriesOut <= 0 || alpertDeficit <= 0) return null;
    const now = new Date();
    const hoursElapsed = now.getHours() + now.getMinutes() / 60;
    if (hoursElapsed < 1) return null; // too early to project
    const hourlyBudget = alpertNumber / 24;
    const budgetSoFar = alpertNumber * (hoursElapsed / 24);
    if (alpertDeficit <= budgetSoFar) return null; // on pace, no warning
    const currentHourlyRate = alpertDeficit / hoursElapsed;
    const projectedDaily = Math.round(currentHourlyRate * 24);
    return { currentHourlyRate: Math.round(currentHourlyRate), hourlyBudget: Math.round(hourlyBudget), projectedDaily };
  }, [data, isViewingToday, dailyCaloriesIn, dailyCaloriesOut, alpertDeficit, alpertNumber]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full space-y-6 p-6 md:p-12 lg:p-16 bg-background">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest italic">Live Market Audit</h2>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-[12px] font-bold text-muted-foreground uppercase">Syncing Ledger...</span>
          </div>
        </div>
        <div className="space-y-6">
          <div className="h-32 bg-muted/50 animate-pulse rounded-2xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="h-40 bg-muted/50 animate-pulse rounded-2xl" />
            <div className="h-40 bg-muted/50 animate-pulse rounded-2xl" />
            <div className="h-40 bg-muted/50 animate-pulse rounded-2xl hidden lg:block" />
          </div>
          <div className="h-40 bg-muted/50 animate-pulse rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[500px] p-6 text-center bg-background space-y-8">
        <div className="p-6 bg-primary/10 rounded-full">
          <ShieldAlert className="w-16 h-16 text-primary animate-pulse" />
        </div>
        <div className="space-y-4">
          <h2 className="text-2xl font-black tracking-tight">Portfolio Discovery</h2>
          <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
            The CFO is initializing your personal ledger. This secure handshake ensures your assets are properly allocated before the first audit begins.
          </p>
        </div>
        <div className="flex items-center gap-3 text-primary">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[12px] font-black uppercase tracking-widest">Establishing Connection...</span>
        </div>
      </div>
    );
  }


  const proteinProgress = Math.min(100, (dailyProteinG / proteinGoal) * 100);
  const fatProgress = Math.min(100, (visceralFatPoints / fatPointsGoal) * 100);

  const scoreHasFoodPending = isViewingToday && dailyCaloriesIn === 0;
  const scoreHasDevicePending = isViewingToday && (data && !data.isDeviceVerified);

  const handleConnectFitbit = async () => {
    if (!user) return;

    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID;
    if (!clientId) {
      // No real Fitbit credentials — run mock handshake locally
      try {
        await healthService.saveFitbitCredentials(db, user.uid, {
          accessToken: 'mock_token',
          refreshToken: 'mock_refresh',
          fitbitUserId: 'mock_fitbit_user',
          expiresAt: Date.now() + 8 * 60 * 60 * 1000,
        });
        await healthService.updateHealthData(db, user.uid, {
          isDeviceVerified: true,
          steps: 8432,
          sleepHours: 7.2,
          hrv: 62,
        });
        toast({ title: 'Fitbit Linked (Demo)', description: 'Mock device data loaded. Set NEXT_PUBLIC_FITBIT_CLIENT_ID for real integration.' });
      } catch (e) {
        console.error('[Fitbit Mock] Failed:', e);
        toast({ variant: 'destructive', title: 'Connection Failed', description: 'Could not simulate Fitbit link.' });
      }
      return;
    }

    window.location.href = fitbitService.getAuthUrl(user.uid);
  };

  const handleResync = async () => {
    if (!user || isSyncing) return;
    setIsSyncing(true);
    let result: SyncResult | null = null;
    try {
      if (isViewingToday) {
        const localDate = new Date().toLocaleDateString('en-CA');
        result = await syncFitbitData(user.uid, localDate);
      } else {
        // Viewing a past date — sync that date's snapshot only, never clobber today's live metrics.
        result = await syncFitbitSnapshot(user.uid, selectedDateStr);
      }
    } catch (e) {
      console.error('[handleResync] Fitbit sync threw:', e);
    } finally {
      setIsSyncing(false);
    }
    if (!result) {
      toast({ 
        variant: 'destructive', 
        title: 'Sync Failed', 
        description: 'The server did not respond. Check your internet connection or server status.' 
      });
    } else if (result.success) {
      toast({
        title: 'Sync Complete',
        description: isViewingToday
          ? 'Fitbit data refreshed from your device.'
          : `${selectedDateStr} data refreshed from Fitbit.`,
      });
    } else {
      const descriptions: Record<string, string> = {
        no_credentials: 'Security handshake missing. Please reconnect your Fitbit.',
        token_refresh_failed: 'Fitbit access has expired. Re-authentication is required to restore sync.',
        api_failed: 'Fitbit API is currently unavailable or returning an error. Please try again later.',
        write_failed: 'Metadata retrieved but database update failed. Your progress is safe but unrecorded.',
      };
      toast({
        variant: 'destructive',
        title: 'Sync Failed',
        description: descriptions[result.reason] ?? 'An unexpected error occurred during sync.',
      });
    }
  };

  const handleDisconnectFitbit = async () => {
    if (!user) return;
    try {
      await healthService.deleteFitbitCredentials(db, user.uid);
      await healthService.updateHealthData(db, user.uid, {
        isDeviceVerified: false,
        connectedDevice: null,
      });
      toast({ title: 'Fitbit Disconnected', description: 'Your device connection has been removed.' });
    } catch (e: any) {
      console.error('[Fitbit Disconnect] Failed:', e);
      toast({ 
        variant: 'destructive', 
        title: 'Disconnect Failed', 
        description: e?.message || 'Could not remove Fitbit connection properly.' 
      });
    }
  };

  const handleConnectOura = async () => {
    if (!user) return;

    const clientId = process.env.NEXT_PUBLIC_OURA_CLIENT_ID;
    if (!clientId) {
      try {
        await healthService.saveOuraCredentials(db, user.uid, {
          accessToken: 'mock_oura_token',
          refreshToken: 'mock_oura_refresh',
          ouraUserId: 'mock_oura_user',
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        });
        await healthService.updateHealthData(db, user.uid, {
          isDeviceVerified: true,
          connectedDevice: 'oura',
          steps: 7841,
          sleepHours: 7.5,
          hrv: 58,
        });
        toast({ title: 'Oura Ring Linked (Demo)', description: 'Mock device data loaded. Set NEXT_PUBLIC_OURA_CLIENT_ID for real integration.' });
      } catch (e) {
        console.error('[Oura Mock] Failed:', e);
        toast({ variant: 'destructive', title: 'Connection Failed', description: 'Could not simulate Oura link.' });
      }
      return;
    }

    window.location.href = ouraService.getAuthUrl(user.uid);
  };

  const handleResyncOura = async () => {
    if (!user || isOuraSyncing) return;
    setIsOuraSyncing(true);
    let result: OuraSyncResult | null = null;
    try {
      const localDate = new Date().toLocaleDateString('en-CA');
      result = await syncOuraData(user.uid, localDate);
    } catch (e) {
      console.error('[handleResyncOura] syncOuraData threw:', e);
    } finally {
      setIsOuraSyncing(false);
    }
    if (!result) {
      toast({ 
        variant: 'destructive', 
        title: 'Sync Failed', 
        description: 'Oura server did not respond. Check your ring connection or internet.' 
      });
    } else if (result.success) {
      toast({ title: 'Sync Complete', description: 'Oura data refreshed from your ring.' });
    } else {
      const descriptions: Record<string, string> = {
        no_credentials: 'Oura credentials missing. Please reconnect your Oura Ring.',
        token_refresh_failed: 'Oura Ring session expired. Re-authentication is required.',
        api_failed: 'Oura API error. The service may be briefly down.',
        write_failed: 'Sync pulled data but could not save to your ledger.',
      };
      toast({
        variant: 'destructive',
        title: 'Sync Failed',
        description: descriptions[result.reason] ?? 'Oura sync failed unexpectedly.',
      });
    }
  };

  const handleDisconnectOura = async () => {
    if (!user) return;
    try {
      await healthService.deleteOuraCredentials(db, user.uid);
      await healthService.updateHealthData(db, user.uid, {
        isDeviceVerified: false,
        connectedDevice: null,
      });
      toast({ title: 'Oura Ring Disconnected', description: 'Your device connection has been removed.' });
    } catch (e: any) {
      console.error('[Oura Disconnect] Failed:', e);
      toast({ 
        variant: 'destructive', 
        title: 'Disconnect Failed', 
        description: e?.message || 'Could not remove Oura connection properly.' 
      });
    }
  };

  return (
    <div className="flex flex-col gap-10 p-6 md:p-12 lg:p-16 pb-24 bg-background h-full overflow-y-auto">
      <div className="space-y-6">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.2em] italic">
            {isViewingToday ? 'Live Market Audit' : 'Historical Audit'}
          </h2>
          <div className="flex items-center gap-2">
            {!isViewingToday && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedDateStr(todayStr)}
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Today
              </Button>
            )}
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-[10px] font-black uppercase tracking-widest gap-1.5"
                >
                  <CalendarIcon className="w-3 h-3" />
                  {isViewingToday ? 'Today' : selectedDateStr}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDateObj}
                  onSelect={handleDateSelect}
                  disabled={(date) => date > new Date()}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
            {isViewingToday ? (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-[12px] font-bold text-emerald-600 uppercase">Active Session</span>
              </div>
            ) : (
              <span className="text-[12px] font-bold text-muted-foreground uppercase">Historical</span>
            )}
          </div>
        </div>

        {data.isDeviceVerified && (data.connectedDevice === 'oura' || (!data.connectedDevice && ouraCreds)) ? (
          // Oura Ring connected
          <Card className="border-none bg-violet-50 ring-1 ring-violet-200 shadow-sm overflow-hidden">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-violet-100 rounded-lg">
                  <ShieldCheck className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-tight text-violet-800">Oura Ring Connected</p>
                  <p className="text-[10px] font-bold text-violet-700/70">
                    {ouraCreds?.lastSyncedAt
                      ? `Last synced ${formatTimeAgo(ouraCreds.lastSyncedAt)}. Auto-refreshes every 6h.`
                      : 'Device-verified steps, sleep, and HRV. Auto-refreshes every 6h.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleDisconnectOura} className="text-violet-800 border-violet-200 hover:bg-violet-100 uppercase font-black text-[10px] h-8 px-3 rounded-lg">
                  <Unplug className="w-3 h-3 mr-1.5" />
                  Reset
                </Button>
                <Button size="sm" onClick={handleResyncOura} disabled={isOuraSyncing} className="bg-violet-600 hover:bg-violet-700 text-white font-black text-[10px] uppercase h-8 px-4 rounded-lg">
                  {isOuraSyncing ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <RefreshCw className="w-3 h-3 mr-2" />}
                  Sync Now
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : data.isDeviceVerified ? (
          // Fitbit connected (default / connectedDevice === 'fitbit')
          <Card className="border-none bg-emerald-50 ring-1 ring-emerald-200 shadow-sm overflow-hidden">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-tight text-emerald-800">Fitbit Connected</p>
                  <p className="text-[10px] font-bold text-emerald-700/70">
                    {fitbitCreds?.lastSyncedAt
                      ? `Last synced ${formatTimeAgo(fitbitCreds.lastSyncedAt)}. Auto-refreshes every 6h.`
                      : 'Device-verified steps, sleep, and HRV. Auto-refreshes every 6h.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleDisconnectFitbit} className="text-emerald-800 border-emerald-200 hover:bg-emerald-100 uppercase font-black text-[10px] h-8 px-3 rounded-lg">
                  <Unplug className="w-3 h-3 mr-1.5" />
                  Reset
                </Button>
                <Button size="sm" onClick={handleResync} disabled={isSyncing} className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase h-8 px-4 rounded-lg">
                  {isSyncing ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <RefreshCw className="w-3 h-3 mr-2" />}
                  {isViewingToday ? 'Sync Now' : 'Sync Date'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          // No device connected — offer both options
          <Card className="border-none bg-orange-50 ring-1 ring-orange-200 shadow-sm overflow-hidden">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <ShieldAlert className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-tight text-orange-800">Self-Reported Data</p>
                  <p className="text-[10px] font-bold text-orange-700/70">Connect a device for verified steps, sleep, and HRV.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleConnectOura} className="bg-violet-600 hover:bg-violet-700 text-white font-black text-[10px] uppercase h-8 px-4 rounded-lg">
                  Oura Ring
                  <CloudLightning className="w-3 h-3 ml-2" />
                </Button>
                <Button size="sm" onClick={handleConnectFitbit} className="bg-orange-600 hover:bg-orange-700 text-white font-black text-[10px] uppercase h-8 px-4 rounded-lg">
                  Fitbit
                  <CloudLightning className="w-3 h-3 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alpert Daily Score */}
        <Card className="border-none shadow-xl overflow-hidden">
          <CardContent className="p-0">
            <div className={`p-6 ${dailyAlpertScore !== null && dailyAlpertScore >= 0 ? 'bg-gradient-to-br from-emerald-500 to-emerald-700' : dailyAlpertScore !== null ? 'bg-gradient-to-br from-red-500 to-red-700' : 'bg-gradient-to-br from-slate-600 to-slate-800'} text-white`}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.25em] opacity-70">{isViewingToday ? "Today's Score" : "Day's Score"}</p>
                  <p className="text-[10px] font-bold opacity-50 uppercase tracking-widest mt-0.5">Alpert Fat Burn Index</p>
                </div>
                <div className="p-2.5 bg-white/15 rounded-xl">
                  <Zap className="w-5 h-5" />
                </div>
              </div>
              <div className="flex items-end gap-3 mb-4">
                <div className="text-6xl font-black italic tracking-tighter">
                  {dailyAlpertScore !== null ? (
                    <>{dailyAlpertScore > 0 ? '+' : ''}{dailyAlpertScore}{(scoreHasFoodPending || scoreHasDevicePending) && <span className="text-2xl opacity-60">*</span>}</>
                  ) : '—'}
                </div>
                <div className="text-sm font-bold opacity-60 mb-2">pts</div>
              </div>
              <div className="h-1.5 bg-white/20 rounded-full mb-4">
                {dailyAlpertScore !== null && dailyAlpertScore > 0 && (
                  <div className="h-full bg-white rounded-full transition-all duration-500" style={{ width: `${Math.min(100, dailyAlpertScore)}%` }} />
                )}
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold opacity-60 uppercase tracking-wider">
                <span>{dailyCaloriesOut > 0 && dailyCaloriesIn > 0 ? `${Math.abs(alpertDeficit).toLocaleString()} kcal ${alpertDeficit >= 0 ? 'deficit' : 'surplus'}` : 'Log food to calculate'}</span>
                <span>Alpert max: {alpertNumber.toLocaleString()} kcal</span>
              </div>
            </div>
            {(scoreHasFoodPending || scoreHasDevicePending) && (
              <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">
                  {scoreHasFoodPending && scoreHasDevicePending ? 'Pending food log + device sync' :
                   scoreHasFoodPending ? 'Pending food log' : 'Pending device sync — burn estimated'}
                </p>
              </div>
            )}
            {alpertPace && (
              <div className="px-4 py-2.5 bg-red-50 border-t border-red-200 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-black text-red-700 uppercase tracking-wide">
                    Pace Breach — Muscle Loss Risk
                  </p>
                  <p className="text-[9px] font-bold text-red-600/80 mt-0.5 leading-relaxed">
                    Burning at {alpertPace.currentHourlyRate} kcal/hr vs {alpertPace.hourlyBudget} kcal/hr ceiling.
                    Projected {alpertPace.projectedDaily.toLocaleString()} kcal deficit exceeds Alpert max of {alpertNumber.toLocaleString()} kcal — eat to protect lean assets.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
          <CardContent className="p-6 sm:p-10 flex items-center gap-8">
            <div className="p-6 bg-purple-100 rounded-2xl shrink-0 shadow-sm">
              <DollarSign className="w-10 h-10 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-end mb-1">
                <p className="text-base font-black text-foreground uppercase tracking-tight">Protein Liquidity</p>
                <span className="text-sm font-black text-muted-foreground">{dailyProteinG}g <span className="opacity-50">/</span> {proteinGoal}g</span>
              </div>
              <p className="text-[10px] font-medium text-muted-foreground mb-3">Daily protein intake toward your goal. Tell the CFO what you ate to log it.</p>
              <Progress value={proteinProgress} className="h-4 bg-purple-50" />
              <p className="mt-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Solvency Status: {proteinProgress >= 100 ? 'BULLISH' : 'PENDING DEPOSIT'}</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
            <CardContent className="p-6 sm:p-10">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-orange-100 rounded-xl shadow-sm">
                  <Zap className="w-6 h-6 text-orange-600" />
                </div>
                {data.isDeviceVerified && <ShieldCheck className="w-4 h-4 text-emerald-500" />}
              </div>
              <p className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.1em] mb-1">Steps Inventory</p>
              <p className="text-[10px] font-medium text-muted-foreground mb-2">Daily steps from your {data.connectedDevice === 'oura' ? 'Oura Ring' : 'Fitbit'}</p>
              <h4 className="text-4xl font-black italic">
                {isViewingToday
                  ? (data.steps || 0).toLocaleString()
                  : fitbitForDate?.steps != null ? fitbitForDate.steps.toLocaleString() : 'N/A'}
              </h4>
              <div className="mt-4 h-1 w-12 bg-orange-200 rounded-full" />
            </CardContent>
          </Card>

          <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
            <CardContent className="p-6 sm:p-10">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-blue-100 rounded-xl shadow-sm">
                  <Target className="w-6 h-6 text-blue-600" />
                </div>
                {data.isDeviceVerified && <ShieldCheck className="w-4 h-4 text-emerald-500" />}
              </div>
              <p className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.1em] mb-1">Recovery Audit</p>
              <p className="text-[10px] font-medium text-muted-foreground mb-2">
                Based on HRV ({isViewingToday
                  ? (data.hrv > 0 ? `${data.hrv}ms` : 'no reading')
                  : (fitbitForDate?.hrv ? `${fitbitForDate.hrv}ms` : 'no reading')})
              </p>
              <h4 className="text-4xl font-black italic uppercase tracking-tighter">
                {isViewingToday
                  ? (data.hrv > 0 ? (data.recoveryStatus || 'MEDIUM') : 'N/A')
                  : (fitbitForDate?.recoveryStatus?.toUpperCase() ?? 'N/A')}
              </h4>
              <div className="mt-4 h-1 w-12 bg-blue-200 rounded-full" />
            </CardContent>
          </Card>

          <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
            <CardContent className="p-6 sm:p-10">
              <div className="p-3 bg-emerald-100 rounded-xl w-fit mb-4 shadow-sm">
                <Scale className="w-6 h-6 text-emerald-600" />
              </div>
              <p className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.1em] mb-1">Portfolio Weight</p>
              <p className="text-[10px] font-medium text-muted-foreground mb-2">Body weight</p>
              <h4 className="text-4xl font-black italic uppercase tracking-tighter">{data.weightKg ? `${data.weightKg}kg` : 'N/A'}</h4>
              <div className="mt-4 h-1 w-12 bg-emerald-200 rounded-full" />
            </CardContent>
          </Card>

        </div>

        {/* Charts section */}
        <DashboardCharts
          caloriesIn={dailyCaloriesIn}
          caloriesOut={dailyCaloriesOut}
          carbsG={dailyCarbsG}
          foodLogs={todayFoodLogs ?? undefined}
          exerciseLogs={todayExerciseLogs ?? undefined}
          morningGlycogenPct={morningGlycogenPct}
          weightKg={data.weightKg}
          bodyFatPct={data.bodyFatPct}
          isDeviceVerified={data.isDeviceVerified}
          isViewingToday={isViewingToday}
          alpertNumber={alpertNumber}
          fitbitActivities={fitbitActivities}
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-1 italic">Long-Term Portfolio</h2>
        {visceralFatPoints === 0 ? (
          <Card className="border-none shadow-xl overflow-hidden bg-primary text-white cursor-default">
            <CardContent className="p-8 md:p-12 flex flex-col gap-6">
              <div className="flex items-center gap-5">
                <div className="p-5 bg-white/10 rounded-2xl shrink-0">
                  <Briefcase className="w-10 h-10 text-white" />
                </div>
                <div>
                  <p className="text-[12px] font-black uppercase tracking-widest opacity-80 mb-1">Your Scoring System</p>
                  <p className="text-base font-black">Coming online after your first session</p>
                </div>
              </div>
              <div className="space-y-3 text-sm font-medium opacity-80 leading-relaxed">
                <p>The CFO builds a <span className="font-black text-white">custom daily point system</span> tuned to your goals. Every workout, protein target hit, and good night of sleep earns points.</p>
                <p>The score compounds over time — turning the fuzzy question <span className="italic">&ldquo;am I actually making progress?&rdquo;</span> into a number you can track and beat.</p>
                <p className="opacity-60 text-[11px] uppercase tracking-widest font-black">Chat with the CFO to calibrate your system →</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-none shadow-xl overflow-hidden bg-primary text-white group cursor-default">
            <CardContent className="p-8 md:p-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
              <div className="flex items-center gap-6 min-w-0">
                <div className="p-5 bg-white/10 rounded-2xl shrink-0 group-hover:bg-white/20 transition-colors">
                  <Briefcase className="w-10 h-10 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-black uppercase tracking-widest opacity-80 mb-1">Equity Score (VF Points)</p>
                  <p className="text-[10px] font-medium opacity-50 mb-2">Visceral fat reduction progress. Grows as you hit protein, activity, and sleep goals.</p>
                  <h3 className="text-4xl lg:text-5xl font-black italic tracking-tighter truncate">
                    {(visceralFatPoints).toLocaleString()}
                    <span className="text-sm font-normal opacity-60 ml-4">/ {fatPointsGoal.toLocaleString()}</span>
                  </h3>
                </div>
              </div>
              <div className="text-right shrink-0 bg-white/10 p-4 px-8 rounded-2xl backdrop-blur-md">
                <p className="text-3xl font-black text-emerald-300 italic">{fatProgress.toFixed(1)}%</p>
                <p className="text-[10px] font-black uppercase opacity-60">Audit Completion</p>
              </div>
            </CardContent>
            <Progress value={fatProgress} className="h-2.5 rounded-none bg-white/10" />
          </Card>
        )}
      </div>
    </div>
  );
}
