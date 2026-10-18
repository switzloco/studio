'use client';

import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Target,
  Zap,
  Briefcase,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Scale,
  RefreshCw,
  Unplug,
  CalendarIcon,
  RotateCcw,
  AlertTriangle,
  Activity,
  TrendingUp,
  Clock,
  Utensils,
  Flame,
  Trophy,
  Plus,
  ChevronDown,
  ChevronUp,
  Settings2,
  History,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { HealthData, UserPreferences, FitbitCredentials, OuraCredentials, FoodNickname, HistoryEntry, healthService } from '@/lib/health-service';
import { fitbitService } from '@/lib/fitbit-service';
import { syncFitbitData, syncFitbitSnapshot, disconnectFitbit, SyncResult } from '@/app/actions/fitbit';
import { syncOuraData, disconnectOura, getOuraAuthUrl, OuraSyncResult } from '@/app/actions/oura';
import { syncWithingsData, disconnectWithings, getWithingsAuthUrl } from '@/app/actions/withings';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { DashboardCharts, computeMaxGlycogenKcal, LIVER_MAX_KCAL } from './dashboard-charts';
import { computeAlpertNumber, calculateDailyVFScore } from '@/lib/vf-scoring';
import { computeAlpertPace, computeEatRunway } from '@/lib/alpert-pace';
import {
  computeLevelProgress,
  DEFAULT_ACTIVE_LEVEL,
  DEFAULT_LEVEL_HISTORY,
  getEffectiveDayNote,
  type LevelConfig,
} from '@/lib/level-tracker';
import { CURRENT_SCORING_RELEASE, inferScoringRelease } from '@/lib/scoring-releases';
import { runMetabolicSimulation, computeMuscleGlycogenMaxKcal, estimateBmrKcal, creditedCaloriesOut, ACTIVITY_CREDIT_FRACTION } from '@/lib/metabolic-engine';
import { useToast } from '@/hooks/use-toast';
import { doc, collection, query, where, limit } from 'firebase/firestore';
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

const OuraLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
    <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/>
  </svg>
);

const FitbitLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <circle cx="12" cy="12" r="2" />
    <circle cx="17" cy="12" r="2" />
    <circle cx="22" cy="12" r="2" />
    <circle cx="12" cy="7"  r="2" />
    <circle cx="12" cy="17" r="2" />
    <circle cx="7"  cy="12" r="2" />
    <circle cx="17" cy="7"  r="2" />
    <circle cx="17" cy="17" r="2" />
    <circle cx="12" cy="2"  r="2" />
    <circle cx="12" cy="22" r="2" />
    <circle cx="2"  cy="12" r="2" />
  </svg>
);

const WithingsLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
    <path d="M16.5 8l-1.5 8h-2l-1-5-1 5h-2l-1.5-8h2l.5 5 1-5h2l1 5 .5-5h2z"/>
  </svg>
);

export function DashboardCards({ data, isLoading }: DashboardCardsProps) {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const prefsRef = useMemoFirebase(
    () => user ? doc(db, 'users', user.uid, 'preferences', 'settings') : null,
    [db, user]
  );
  const { data: prefs } = useDoc<UserPreferences>(prefsRef);

  const fitbitTokensRef = useMemoFirebase(
    () => user ? doc(db, 'users', user.uid, 'preferences', 'fitbit_tokens') : null,
    [db, user]
  );
  const { data: fitbitCreds } = useDoc<FitbitCredentials>(fitbitTokensRef);

  const ouraTokensRef = useMemoFirebase(
    () => user ? doc(db, 'users', user.uid, 'preferences', 'oura_tokens') : null,
    [db, user]
  );
  const { data: ouraCreds } = useDoc<OuraCredentials>(ouraTokensRef);

  const withingsTokensRef = useMemoFirebase(
    () => user ? doc(db, 'users', user.uid, 'preferences', 'withings_tokens') : null,
    [db, user]
  );
  const { data: withingsCreds } = useDoc<any>(withingsTokensRef);

  const todayStr = React.useMemo(() => {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');
  }, []);

  const [selectedDateStr, setSelectedDateStr] = React.useState<string>(todayStr);
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const [chartsExpanded, setChartsExpanded] = React.useState(false);

  // Level editor & archive state
  const [levelEditorOpen, setLevelEditorOpen] = React.useState(false);
  const [pastLevelsOpen, setPastLevelsOpen] = React.useState(false);
  const [editLevelName, setEditLevelName] = React.useState('');
  const [editLevelStart, setEditLevelStart] = React.useState('');
  const [editLevelTarget, setEditLevelTarget] = React.useState('1000');
  const [editLevelDeadline, setEditLevelDeadline] = React.useState('');
  const [editLevelOffset, setEditLevelOffset] = React.useState('0');
  const [editLevelNotes, setEditLevelNotes] = React.useState('');

  // Zero-AI Quick Log state
  const [quickFoodOpen, setQuickFoodOpen] = React.useState(false);
  const [quickItemName, setQuickItemName] = React.useState('');
  const [quickCalories, setQuickCalories] = React.useState('');
  const [quickProtein, setQuickProtein] = React.useState('');
  const [quickCarbs, setQuickCarbs] = React.useState('');
  const [quickFat, setQuickFat] = React.useState('');
  const [quickMeal, setQuickMeal] = React.useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('lunch');
  const [isLoggingQuick, setIsLoggingQuick] = React.useState(false);

  // Zero-AI Score Lock state
  const [scoreLockOpen, setScoreLockOpen] = React.useState(false);
  const [lockFastingHours, setLockFastingHours] = React.useState('0');
  const [lockAlcoholDrinks, setLockAlcoholDrinks] = React.useState('0');
  const [lockDayNote, setLockDayNote] = React.useState('');
  const [isLockingScore, setIsLockingScore] = React.useState(false);

  const isViewingToday = selectedDateStr === todayStr;

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

  // History entry for the selected date (including today if already scored)
  const selectedHistoryEntry = React.useMemo(() => {
    if (!data?.history) return null;
    return data.history.find(h => (h.isoDate || h.date) === selectedDateStr) ?? null;
  }, [data?.history, selectedDateStr]);

  const historyEntry = !isViewingToday ? selectedHistoryEntry : null;

  React.useEffect(() => {
    const note = getEffectiveDayNote(selectedHistoryEntry ?? { isoDate: selectedDateStr }) ?? '';
    setLockDayNote(note);
    if (selectedHistoryEntry?.breakdown) {
      setLockFastingHours(String(selectedHistoryEntry.breakdown.fastingHours ?? 0));
      setLockAlcoholDrinks(String(selectedHistoryEntry.breakdown.alcoholDrinks ?? 0));
    } else {
      setLockFastingHours('0');
      setLockAlcoholDrinks('0');
    }
  }, [selectedDateStr, selectedHistoryEntry]);

  const foodLogQuery = useMemoFirebase(
    () => user ? query(
      collection(db, 'users', user.uid, 'food_log'),
      where('date', '==', selectedDateStr),
      limit(50)
    ) : null,
    [db, user, selectedDateStr]
  );
  const { data: todayFoodLogs } = useCollection<FoodLogEntry>(foodLogQuery);

  const exerciseLogQuery = useMemoFirebase(
    () => user ? query(
      collection(db, 'users', user.uid, 'exercise_log'),
      where('date', '==', selectedDateStr),
      limit(20)
    ) : null,
    [db, user, selectedDateStr]
  );
  const { data: todayExerciseLogs } = useCollection<ExerciseLogEntry>(exerciseLogQuery);

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

  const morningGlycogenPct = React.useMemo(() => {
    const totalMax  = computeMaxGlycogenKcal(data?.weightKg, data?.bodyFatPct);
    const muscleMax = Math.max(400, totalMax - LIVER_MAX_KCAL);

    const MUSCLE_FRACTION: Record<string, number> = {
      tier1_walking:    0.40,
      tier2_steady_state: 0.65,
      tier3_anaerobic:  0.85,
    };

    if (prevFoodLogs !== undefined && prevExerciseLogs !== undefined) {
      const activePrevFood = (prevFoodLogs ?? []).filter(e => !e.ignored);
      const activePrevEx   = (prevExerciseLogs ?? []).filter(e => !e.ignored);

      const prevCarbKcal = activePrevFood.reduce((s, e) => s + ((e.carbsG || 0) * 4), 0);
      const muscleCarbs  = Math.max(0, prevCarbKcal - 120);

      const activeBurn = activePrevEx.reduce((s, e) => {
        const frac = e.activityTier ? (MUSCLE_FRACTION[e.activityTier] ?? 0.65) : 0.65;
        return s + ((e.adjustedCalories || 0) * frac);
      }, 0);

      const prevMuscleKcal = muscleMax;
      const endMuscleKcal  = Math.max(0, Math.min(muscleMax, prevMuscleKcal - activeBurn + muscleCarbs));
      return Math.round((endMuscleKcal / muscleMax) * 100);
    }

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
  const [isWithingsSyncing, setIsWithingsSyncing] = React.useState(false);

  const fitbitForDate = !isViewingToday ? (data?.fitbitByDate?.[selectedDateStr] ?? null) : null;
  const isLegacyFitbit = fitbitCreds?.provider === 'fitbit';

  const dailyProteinG = computedTotals?.proteinG ?? (isViewingToday ? (data?.dailyProteinG || 0) : (historyEntry?.breakdown?.proteinG || 0));
  const dailyCaloriesIn = computedTotals?.caloriesIn ?? (isViewingToday ? (data?.dailyCaloriesIn || 0) : (historyEntry?.breakdown?.caloriesIn || 0));
  const dailyCarbsG = computedTotals?.carbsG ?? (data?.dailyCarbsG || 0);
  const dailyCaloriesOut = isViewingToday
    ? (data?.dailyCaloriesOut || 2000)
    : (historyEntry?.breakdown?.caloriesOut || fitbitForDate?.caloriesOut || data?.dailyCaloriesOut || 2000);

  const fitbitActivities = isViewingToday
    ? data?.fitbitByDate?.[new Date().toLocaleDateString('en-CA')]?.activities
    : fitbitForDate?.activities;

  const visceralFatPoints = data?.visceralFatPoints || 0;
  const proteinGoal = prefs?.targets?.proteinGoal ?? 150;
  const plantGoalG = prefs?.targets?.plantGoalG ?? 800;
  const dailyPlantG = data?.dailyPlantG ?? 0;
  const plantProgress = Math.min(100, (dailyPlantG / plantGoalG) * 100);

  const showAdvancedMetabolic = prefs?.display?.showAdvancedMetabolic ?? true;
  const showProtein = prefs?.display?.showProtein ?? true;
  const showPlantMatter = prefs?.display?.showPlantMatter ?? false;
  const showRecovery = prefs?.display?.showRecovery ?? true;
  const showVfScore = prefs?.display?.showVfScore ?? true;

  const alpertNumber = computeAlpertNumber(data?.weightKg || 0, data?.bodyFatPct || 0);
  const bmrKcal = estimateBmrKcal(data?.weightKg, data?.heightCm, prefs?.profile?.age);
  const scoredCaloriesOut = historyEntry?.breakdown?.scoredCaloriesOut
    ?? creditedCaloriesOut(dailyCaloriesOut, bmrKcal);
  const alpertDeficit = scoredCaloriesOut - dailyCaloriesIn;

  const dailyAlpertScore = React.useMemo(() => {
    if (!data) return null;
    if (!isViewingToday && historyEntry) return historyEntry.gain;
    if (isViewingToday && selectedHistoryEntry && dailyCaloriesIn <= 0) return selectedHistoryEntry.gain;
    if (dailyCaloriesOut <= 0) return null;
    if (isViewingToday && dailyCaloriesIn <= 0) return null;
    const result = calculateDailyVFScore({
      caloriesIn: dailyCaloriesIn,
      caloriesOut: dailyCaloriesOut,
      proteinG: dailyProteinG,
      proteinGoal,
      fastingHours: Number(lockFastingHours) || 0,
      alcoholDrinks: Number(lockAlcoholDrinks) || 0,
      sleepHours: data.sleepHours ?? 7,
      seedOilMeals: 0,
      weightKg: data.weightKg,
      bodyFatPct: data.bodyFatPct,
      heightCm: data.heightCm,
      age: prefs?.profile?.age,
      foodLogs: todayFoodLogs ?? undefined,
      exerciseLogs: todayExerciseLogs ?? undefined,
      fitbitActivities,
    });
    return result.score;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isViewingToday, historyEntry, selectedHistoryEntry, dailyCaloriesOut, dailyCaloriesIn, dailyProteinG,
      proteinGoal, alpertNumber, todayFoodLogs, todayExerciseLogs, fitbitActivities, prefs?.profile?.age, lockFastingHours, lockAlcoholDrinks]);

  const simulationResult = React.useMemo(() => {
    if (!data || dailyCaloriesOut <= 0) return null;
    const muscleMax = computeMuscleGlycogenMaxKcal(data.weightKg, data.bodyFatPct);
    return runMetabolicSimulation({
      caloriesOut: scoredCaloriesOut,
      exerciseCreditFraction: ACTIVITY_CREDIT_FRACTION,
      alpertNumber,
      foodLogs: todayFoodLogs ?? [],
      exerciseLogs: todayExerciseLogs ?? [],
      fitbitActivities: fitbitActivities ?? [],
      caloriesIn: dailyCaloriesIn,
      muscleGlycogenMaxKcal: muscleMax,
      morningGlycogenPct,
      hasCreatine: prefs?.profile?.hasCreatine,
    });
  }, [data, dailyCaloriesOut, scoredCaloriesOut, alpertNumber, todayFoodLogs, todayExerciseLogs, fitbitActivities, dailyCaloriesIn, morningGlycogenPct, prefs?.profile?.hasCreatine]);

  // 3-Signal "Should I Eat Now?" Runway
  const eatRunway = React.useMemo(() => {
    const now = new Date();
    const hoursElapsed = isViewingToday ? (now.getHours() + now.getMinutes() / 60) : 20;
    return computeEatRunway({
      caloriesIn: dailyCaloriesIn,
      scoredCaloriesOut,
      alpertNumber,
      hoursElapsed,
      proteinG: dailyProteinG,
      proteinGoal,
      slots: simulationResult?.slots,
    });
  }, [isViewingToday, dailyCaloriesIn, scoredCaloriesOut, alpertNumber, dailyProteinG, proteinGoal, simulationResult?.slots]);

  const alpertPace = React.useMemo(() => {
    if (!data || !isViewingToday) return null;
    const now = new Date();
    return computeAlpertPace({
      caloriesIn: dailyCaloriesIn,
      caloriesOut: dailyCaloriesOut,
      alpertNumber,
      hoursElapsed: now.getHours() + now.getMinutes() / 60,
    });
  }, [data, isViewingToday, dailyCaloriesIn, dailyCaloriesOut, alpertNumber]);

  // Active Level & Level History (Replaces Google Sheet right-side tracker)
  const activeLevel: LevelConfig = prefs?.activeLevel ?? DEFAULT_ACTIVE_LEVEL;
  const levelHistory: LevelConfig[] = prefs?.levelHistory ?? DEFAULT_LEVEL_HISTORY;

  const levelProgress = React.useMemo(
    () =>
      computeLevelProgress(activeLevel, data?.history ?? [], {
        todayGain: isViewingToday ? dailyAlpertScore : null,
        todayIso: todayStr,
      }),
    [activeLevel, data?.history, isViewingToday, dailyAlpertScore, todayStr]
  );

  const openLevelEditor = (lvl: LevelConfig) => {
    setEditLevelName(lvl.name);
    setEditLevelStart(lvl.startDate);
    setEditLevelTarget(String(lvl.targetPoints));
    setEditLevelDeadline(lvl.targetDate ?? '');
    setEditLevelOffset(String(lvl.startingPointsOffset ?? 0));
    setEditLevelNotes(lvl.notes ?? '');
    setLevelEditorOpen(true);
  };

  const handleSaveActiveLevel = async () => {
    if (!user) return;
    const updated: LevelConfig = {
      ...activeLevel,
      name: editLevelName.trim() || 'Active Level',
      startDate: editLevelStart || todayStr,
      targetPoints: Math.max(50, Number(editLevelTarget) || 1000),
      targetDate: editLevelDeadline.trim() || undefined,
      startingPointsOffset: Number(editLevelOffset) || 0,
      notes: editLevelNotes.trim() || undefined,
      status: 'active',
    };
    await healthService.updateUserPreferences(db, user.uid, { activeLevel: updated });
    setLevelEditorOpen(false);
    toast({ title: 'Level Updated', description: `${updated.name} (Target: ${updated.targetPoints.toLocaleString()} pts from ${updated.startDate})` });
  };

  const handleArchiveAndStartNewLevel = async (preset?: Partial<LevelConfig>) => {
    if (!user) return;
    const archivedCurrent: LevelConfig = {
      ...activeLevel,
      endDate: todayStr,
      status: levelProgress.isTargetMet ? 'completed' : 'retry',
      snapshotTotalPoints: levelProgress.totalPoints,
      snapshotDays: Math.max(1, levelProgress.daysScored),
      engineEra: `v${CURRENT_SCORING_RELEASE.version} ${CURRENT_SCORING_RELEASE.codename}`,
    };
    const nextHistory = [
      ...levelHistory.filter((l) => l.id !== archivedCurrent.id),
      archivedCurrent,
    ];
    const nextLevel: LevelConfig = {
      id: `level-${Date.now()}`,
      name: preset?.name || editLevelName.trim() || 'New Lock-In Block',
      startDate: preset?.startDate || todayStr,
      targetPoints: preset?.targetPoints ?? (Math.max(50, Number(editLevelTarget) || 1000)),
      targetDate: preset?.targetDate || editLevelDeadline.trim() || undefined,
      startingPointsOffset: preset?.startingPointsOffset ?? 0,
      status: 'active',
      engineEra: `v${CURRENT_SCORING_RELEASE.version} ${CURRENT_SCORING_RELEASE.codename}`,
      notes: preset?.notes || editLevelNotes.trim() || undefined,
    };
    await healthService.updateUserPreferences(db, user.uid, {
      activeLevel: nextLevel,
      levelHistory: nextHistory,
    });
    setLevelEditorOpen(false);
    toast({
      title: 'New Level Started',
      description: `Archived "${archivedCurrent.name}" (${archivedCurrent.snapshotTotalPoints} pts) and started "${nextLevel.name}".`,
    });
  };

  const handleSwitchPresetLevel = async (preset: LevelConfig) => {
    if (!user) return;
    await healthService.updateUserPreferences(db, user.uid, {
      activeLevel: { ...preset, status: 'active', endDate: undefined },
    });
    setLevelEditorOpen(false);
    toast({
      title: `Switched to ${preset.name}`,
      description: `Tracking from ${preset.startDate} toward ${preset.targetPoints.toLocaleString()} pts.`,
    });
  };

  // Zero-AI Quick Log handlers
  const handleQuickLogNickname = async (nick: FoodNickname) => {
    if (!user || isLoggingQuick) return;
    setIsLoggingQuick(true);
    try {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      await healthService.logFood(db, user.uid, {
        date: selectedDateStr,
        meal: nick.meal || 'snack',
        name: `${nick.nickname}${nick.description ? ` (${nick.description})` : ''}`,
        portionG: 300,
        calories: nick.totalCalories,
        proteinG: nick.totalProteinG,
        carbsG: nick.totalCarbsG || 0,
        fatG: nick.totalFatG || 0,
        fiberG: 0,
        source: 'user_estimate',
        consumedAt: hhmm,
      });
      if (isViewingToday) {
        await healthService.updateHealthData(db, user.uid, {
          dailyCaloriesIn: dailyCaloriesIn + nick.totalCalories,
          dailyProteinG: dailyProteinG + nick.totalProteinG,
          dailyCarbsG: dailyCarbsG + (nick.totalCarbsG || 0),
        });
      }
      toast({
        title: `Logged "${nick.nickname}" (Zero AI)`,
        description: `+${nick.totalCalories} kcal · +${nick.totalProteinG}g protein added to ${selectedDateStr}.`,
      });
    } catch (err) {
      console.error('[handleQuickLogNickname] Failed:', err);
      toast({ variant: 'destructive', title: 'Quick Log Failed', description: 'Could not save food entry.' });
    } finally {
      setIsLoggingQuick(false);
    }
  };

  const handleQuickCustomFoodSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isLoggingQuick) return;
    const kcal = Math.max(0, Number(quickCalories) || 0);
    const prot = Math.max(0, Number(quickProtein) || 0);
    const carbs = Math.max(0, Number(quickCarbs) || 0);
    const fat = Math.max(0, Number(quickFat) || 0);
    const name = quickItemName.trim() || 'Quick Entry';
    if (kcal === 0 && prot === 0) return;

    setIsLoggingQuick(true);
    try {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      await healthService.logFood(db, user.uid, {
        date: selectedDateStr,
        meal: quickMeal,
        name,
        portionG: 250,
        calories: kcal,
        proteinG: prot,
        carbsG: carbs,
        fatG: fat,
        fiberG: 0,
        source: 'user_estimate',
        consumedAt: hhmm,
      });
      if (isViewingToday) {
        await healthService.updateHealthData(db, user.uid, {
          dailyCaloriesIn: dailyCaloriesIn + kcal,
          dailyProteinG: dailyProteinG + prot,
          dailyCarbsG: dailyCarbsG + carbs,
        });
      }
      setQuickItemName('');
      setQuickCalories('');
      setQuickProtein('');
      setQuickCarbs('');
      setQuickFat('');
      setQuickFoodOpen(false);
      toast({
        title: `Logged ${name} (Zero AI)`,
        description: `+${kcal} kcal · +${prot}g protein recorded directly to Ledger.`,
      });
    } catch (err) {
      console.error('[handleQuickCustomFoodSubmit] Failed:', err);
      toast({ variant: 'destructive', title: 'Log Failed', description: 'Could not write to food log.' });
    } finally {
      setIsLoggingQuick(false);
    }
  };

  // Zero-AI Deterministic Score & Day Note Saver
  const handleLockDayScore = async () => {
    if (!user || !data || isLockingScore) return;
    setIsLockingScore(true);
    try {
      const fastingH = Math.max(0, Number(lockFastingHours) || 0);
      const drinks = Math.max(0, Number(lockAlcoholDrinks) || 0);
      const sleepH = data.sleepHours ?? 7;
      const calc = calculateDailyVFScore({
        caloriesIn: dailyCaloriesIn,
        caloriesOut: dailyCaloriesOut,
        proteinG: dailyProteinG,
        proteinGoal,
        fastingHours: fastingH,
        alcoholDrinks: drinks,
        sleepHours: sleepH,
        seedOilMeals: 0,
        weightKg: data.weightKg,
        bodyFatPct: data.bodyFatPct,
        heightCm: data.heightCm,
        age: prefs?.profile?.age,
        foodLogs: todayFoodLogs ?? undefined,
        exerciseLogs: todayExerciseLogs ?? undefined,
        fitbitActivities,
      });

      const [yr, mo, dy] = selectedDateStr.split('-').map(Number);
      const displayDate = new Date(yr, (mo || 1) - 1, dy || 1).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });

      const existingHistory = [...(data.history ?? [])];
      const existingIdx = existingHistory.findIndex((h) => (h.isoDate || h.date) === selectedDateStr);
      const prevGain = existingIdx >= 0 ? existingHistory[existingIdx].gain : 0;
      const newEquity = (data.visceralFatPoints || 0) - prevGain + calc.score;

      const updatedEntry: HistoryEntry = {
        date: displayDate,
        isoDate: selectedDateStr,
        gain: calc.score,
        status: calc.score >= 0 ? 'Bullish' : 'Correction',
        detail: calc.summary,
        equity: existingIdx >= 0 ? existingHistory[existingIdx].equity - prevGain + calc.score : newEquity,
        breakdown: {
          caloriesIn: dailyCaloriesIn,
          caloriesOut: dailyCaloriesOut,
          proteinG: dailyProteinG,
          proteinGoal,
          fastingHours: fastingH,
          sleepHours: sleepH,
          ...calc.breakdown,
        },
        scoringVersion: CURRENT_SCORING_RELEASE.version,
        dayNote: lockDayNote.trim() || undefined,
      };

      if (existingIdx >= 0) {
        existingHistory[existingIdx] = updatedEntry;
      } else {
        existingHistory.push(updatedEntry);
      }

      await healthService.updateHealthData(db, user.uid, {
        visceralFatPoints: newEquity,
        history: existingHistory,
      });

      setScoreLockOpen(false);
      toast({
        title: `Scored ${selectedDateStr}: ${calc.score >= 0 ? '+' : ''}${calc.score} pts`,
        description: `Saved to Ledger with v${CURRENT_SCORING_RELEASE.version} (${CURRENT_SCORING_RELEASE.codename}) — 0 Gemini tokens used.`,
      });
    } catch (err) {
      console.error('[handleLockDayScore] Failed:', err);
      toast({ variant: 'destructive', title: 'Score Save Failed', description: 'Could not update ledger.' });
    } finally {
      setIsLockingScore(false);
    }
  };

  const nowSlot = React.useMemo(() => {
    if (!isViewingToday) return null;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return Math.max(0, Math.min(72, Math.round((nowMin - 6 * 60) / 15)));
  }, [isViewingToday]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full space-y-6 p-6 md:p-10 bg-background">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest italic">Daily Cockpit</h2>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-[12px] font-bold text-muted-foreground uppercase">Syncing Ledger...</span>
          </div>
        </div>
        <div className="space-y-4">
          <div className="h-44 bg-muted/50 animate-pulse rounded-2xl" />
          <div className="h-36 bg-muted/50 animate-pulse rounded-2xl" />
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
            the CFO is initializing your personal ledger. This secure handshake ensures your assets are properly allocated before the first audit begins.
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
  const scoreHasFoodPending = isViewingToday && dailyCaloriesIn === 0;
  const scoreHasDevicePending = isViewingToday && (data && !data.isDeviceVerified);
  const pastScoreProvisional = !isViewingToday && !!data.isDeviceVerified && !!historyEntry && (
    (!!fitbitForDate?.capturedOnDate && fitbitForDate.capturedOnDate <= selectedDateStr)
  );

  const selectedDayVintage = inferScoringRelease(selectedHistoryEntry ?? { isoDate: selectedDateStr });
  const selectedDayNote = getEffectiveDayNote(selectedHistoryEntry ?? { isoDate: selectedDateStr });
  const nicknameList = Object.values(prefs?.foodNicknames ?? {});

  const handleConnectFitbit = async () => {
    if (!user) return;
    const provider = 'google' as const;
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_HEALTH_CLIENT_ID || process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID;
    const providerLabel = 'Google Health';

    if (!clientId) {
      toast({
        variant: 'destructive',
        title: `${providerLabel} Unavailable`,
        description: `${providerLabel} linking is temporarily unavailable.`,
      });
      return;
    }
    window.location.href = fitbitService.getAuthUrl(user.uid, provider);
  };

  const handleResync = async () => {
    if (!user || isSyncing) return;
    setIsSyncing(true);
    let result: SyncResult | null = null;
    try {
      const tzOffset = new Date().getTimezoneOffset();
      if (isViewingToday) {
        const localDate = new Date().toLocaleDateString('en-CA');
        result = await syncFitbitData(user.uid, localDate, tzOffset);
      } else {
        result = await syncFitbitSnapshot(user.uid, selectedDateStr, tzOffset);
      }
    } catch (e) {
      console.error('[handleResync] Fitbit sync threw:', e);
    } finally {
      setIsSyncing(false);
    }
    if (!result) {
      toast({ variant: 'destructive', title: 'Sync Failed', description: 'The server did not respond.' });
    } else if (result.success) {
      toast({
        title: 'Sync Complete',
        description: isViewingToday ? 'Device data refreshed.' : `${selectedDateStr} refreshed from device.`,
      });
    } else {
      toast({ variant: 'destructive', title: 'Sync Failed', description: result.details?.message || 'Could not sync device.' });
    }
  };

  const handleDisconnectFitbit = async () => {
    if (!user) return;
    const result = await disconnectFitbit(user.uid);
    if (result.ok) {
      toast({ title: 'Device Disconnected', description: 'Your device connection has been removed.' });
    }
  };

  const handleConnectOura = async () => {
    if (!user) return;
    const result = await getOuraAuthUrl(user.uid, window.location.origin);
    if ('error' in result || 'mock' in result) {
      toast({ variant: 'destructive', title: 'Oura Unavailable', description: 'Oura linking is currently unavailable.' });
      return;
    }
    window.location.href = result.url;
  };

  const handleResyncOura = async () => {
    if (!user || isOuraSyncing) return;
    setIsOuraSyncing(true);
    let result: OuraSyncResult | null = null;
    try {
      const localDate = new Date().toLocaleDateString('en-CA');
      result = await syncOuraData(user.uid, localDate);
    } catch (e) {
      console.error('[handleResyncOura] threw:', e);
    } finally {
      setIsOuraSyncing(false);
    }
    if (result?.success) {
      toast({ title: 'Sync Complete', description: 'Oura data refreshed.' });
    } else {
      toast({ variant: 'destructive', title: 'Oura Sync Failed', description: 'Could not refresh Oura data.' });
    }
  };

  const handleDisconnectOura = async () => {
    if (!user) return;
    const result = await disconnectOura(user.uid);
    if (result.ok) toast({ title: 'Oura Disconnected' });
  };

  const handleConnectWithings = async () => {
    if (!user) return;
    const result = await getWithingsAuthUrl(user.uid, window.location.origin);
    if ('error' in result) {
      toast({ variant: 'destructive', title: 'Withings Connection', description: result.error });
      return;
    }
    window.location.href = result.url;
  };

  const handleResyncWithings = async () => {
    if (!user || isWithingsSyncing) return;
    setIsWithingsSyncing(true);
    try {
      const localDate = new Date().toLocaleDateString('en-CA');
      const result = await syncWithingsData(user.uid, localDate);
      if (result.success) toast({ title: 'Withings Sync Complete' });
    } finally {
      setIsWithingsSyncing(false);
    }
  };

  const handleDisconnectWithings = async () => {
    if (!user) return;
    const result = await disconnectWithings(user.uid);
    if (result.ok) toast({ title: 'Withings Disconnected' });
  };

  const runwayStyles = {
    clear: {
      bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950',
      badge: 'bg-emerald-600 text-white',
      label: 'RUNWAY CLEAR',
    },
    eat_soon: {
      bg: 'bg-amber-500/10 border-amber-500/30 text-amber-950',
      badge: 'bg-amber-500 text-white',
      label: 'FEED WINDOW APPROACHING',
    },
    eat_now: {
      bg: 'bg-red-500/10 border-red-500/30 text-red-950',
      badge: 'bg-red-600 text-white',
      label: 'EAT NOW — PROTECT MUSCLE',
    },
  }[eatRunway.status];

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 md:p-10 pb-24 bg-background h-full overflow-y-auto">
      {/* ── Compact Top Bar: Date Picker + Slim Device Sync Pill ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] italic">
            {isViewingToday ? 'Daily Cockpit' : `Historical Cockpit · ${selectedDateStr}`}
          </h2>
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-700">
            v{selectedDayVintage.version} {selectedDayVintage.codename}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
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
                className="h-7 px-2.5 text-[10px] font-black uppercase tracking-widest gap-1.5"
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

          {/* Compact Device Sync Pill */}
          {data.isDeviceVerified && (data.connectedDevice === 'oura' || (!data.connectedDevice && ouraCreds)) ? (
            <div className="flex items-center gap-1 bg-violet-50 border border-violet-200 rounded-lg px-2 py-0.5">
              <OuraLogo className="w-3.5 h-3.5 text-violet-600" />
              <span className="text-[9px] font-black uppercase text-violet-800 hidden sm:inline">
                {ouraCreds?.lastSyncedAt ? formatTimeAgo(ouraCreds.lastSyncedAt) : 'Oura'}
              </span>
              <Button size="sm" variant="ghost" onClick={handleResyncOura} disabled={isOuraSyncing} className="h-5 px-1.5 text-[9px] font-black uppercase text-violet-700 hover:bg-violet-100">
                {isOuraSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDisconnectOura} className="h-5 px-1 text-violet-500 hover:text-violet-800" title="Disconnect Oura">
                <Unplug className="w-2.5 h-2.5" />
              </Button>
            </div>
          ) : data.isDeviceVerified && data.connectedDevice === 'withings' ? (
            <div className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg px-2 py-0.5">
              <WithingsLogo className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[9px] font-black uppercase text-blue-800 hidden sm:inline">
                {withingsCreds?.lastSyncedAt ? formatTimeAgo(withingsCreds.lastSyncedAt) : 'Withings'}
              </span>
              <Button size="sm" variant="ghost" onClick={handleResyncWithings} disabled={isWithingsSyncing} className="h-5 px-1.5 text-[9px] font-black uppercase text-blue-700 hover:bg-blue-100">
                {isWithingsSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDisconnectWithings} className="h-5 px-1 text-blue-500 hover:text-blue-800" title="Disconnect Withings">
                <Unplug className="w-2.5 h-2.5" />
              </Button>
            </div>
          ) : data.isDeviceVerified ? (
            <div className="flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-0.5">
              <FitbitLogo className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-[9px] font-black uppercase text-emerald-800">
                {fitbitCreds?.lastSyncedAt ? formatTimeAgo(fitbitCreds.lastSyncedAt) : (isLegacyFitbit ? 'Fitbit' : 'Health')}
              </span>
              <Button size="sm" variant="ghost" onClick={handleResync} disabled={isSyncing} className="h-5 px-1.5 text-[9px] font-black uppercase text-emerald-700 hover:bg-emerald-100">
                {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                {isViewingToday ? 'Sync' : 'Sync Date'}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDisconnectFitbit} className="h-5 px-1 text-emerald-500 hover:text-emerald-800" title="Disconnect Device">
                <Unplug className="w-2.5 h-2.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={handleConnectFitbit} className="h-7 px-2 text-[9px] font-black uppercase border-emerald-200 text-emerald-700">
                <FitbitLogo className="w-3 h-3 mr-1" /> Connect Health
              </Button>
              <Button size="sm" variant="outline" onClick={handleConnectOura} className="h-7 px-2 text-[9px] font-black uppercase border-violet-200 text-violet-700">
                <OuraLogo className="w-3 h-3 mr-1" /> Oura
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── ROW 1: Daily Cockpit (VF Score + Calories + 3-Signal "Should I Eat Now?" & Protein To Go) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left 5 cols: Today's VF Score + Explicit Calories In / Out / Deficit */}
        <Card className="lg:col-span-5 border-none shadow-lg overflow-hidden flex flex-col justify-between">
          <div
            className={`p-5 sm:p-6 flex-1 flex flex-col justify-between ${
              dailyAlpertScore !== null && dailyAlpertScore >= 0
                ? 'bg-gradient-to-br from-emerald-600 to-emerald-800'
                : dailyAlpertScore !== null
                  ? 'bg-gradient-to-br from-red-600 to-red-800'
                  : 'bg-gradient-to-br from-slate-700 to-slate-900'
            } text-white`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-80">
                    {isViewingToday ? "Today's VF Score" : `${selectedDateStr} Score`}
                  </p>
                  <span className="px-1.5 py-0.5 rounded bg-white/15 text-[9px] font-black uppercase tracking-wider">
                    v{selectedDayVintage.version}
                  </span>
                </div>
                {selectedDayNote && (
                  <p className="text-[11px] font-bold text-amber-200 mt-1 line-clamp-1 italic">
                    “{selectedDayNote}”
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setScoreLockOpen((v) => !v)}
                className="h-7 px-2.5 text-[9px] font-black uppercase tracking-wider bg-white/15 hover:bg-white/25 text-white border-none shrink-0"
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {selectedHistoryEntry ? 'Update Score / Note' : 'Lock Score'}
              </Button>
            </div>

            <div className="my-4 flex items-baseline justify-between gap-4">
              <div className="flex items-baseline gap-2">
                <span className="text-5xl sm:text-6xl font-black italic tracking-tighter">
                  {dailyAlpertScore !== null ? (
                    <>
                      {dailyAlpertScore > 0 ? '+' : ''}
                      {dailyAlpertScore}
                      {(scoreHasFoodPending || scoreHasDevicePending || pastScoreProvisional) && (
                        <span className="text-2xl opacity-60">*</span>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </span>
                <span className="text-xs font-black uppercase opacity-70">pts</span>
              </div>

              {/* Protein To Go Pill right inside the hero card for instant glanceability */}
              {showProtein && (
                <div className="text-right bg-black/20 rounded-xl px-3 py-2 backdrop-blur-sm">
                  <p className="text-[9px] font-black uppercase tracking-wider opacity-75">Protein To Go</p>
                  <p className="text-xl sm:text-2xl font-black italic tracking-tight text-amber-300">
                    {eatRunway.proteinToGoG > 0 ? `${eatRunway.proteinToGoG}g` : 'HIT ✓'}
                  </p>
                  <p className="text-[9px] font-bold opacity-75">
                    {dailyProteinG}g / {proteinGoal}g
                  </p>
                </div>
              )}
            </div>

            {/* Explicit 3-Column Calorie Ledger */}
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/15 text-left">
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider opacity-60">Calories In</p>
                <p className="text-base sm:text-lg font-black">{dailyCaloriesIn.toLocaleString()}</p>
                <p className="text-[9px] opacity-60">{dailyCarbsG}g carbs</p>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider opacity-60">Counted Burn</p>
                <p className="text-base sm:text-lg font-black">{scoredCaloriesOut.toLocaleString()}</p>
                <p className="text-[9px] opacity-60">Watch: {dailyCaloriesOut.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider opacity-60">
                  {alpertDeficit >= 0 ? 'Net Deficit' : 'Net Surplus'}
                </p>
                <p className="text-base sm:text-lg font-black">
                  {alpertDeficit >= 0 ? `-${alpertDeficit.toLocaleString()}` : `+${Math.abs(alpertDeficit).toLocaleString()}`}
                </p>
                <p className="text-[9px] opacity-60">Cap: {alpertNumber.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Inline Zero-AI Score / Day Note Drawer */}
          {scoreLockOpen && (
            <div className="p-4 bg-slate-900 text-white border-t border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                  Zero-AI Score & Sheet Note ({selectedDateStr})
                </p>
                <span className="text-[9px] text-slate-400">0 Gemini calls</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] font-bold uppercase text-slate-400">Fasting Hours</label>
                  <Input
                    type="number"
                    value={lockFastingHours}
                    onChange={(e) => setLockFastingHours(e.target.value)}
                    className="h-7 text-xs bg-slate-800 border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold uppercase text-slate-400">Alcohol Drinks</label>
                  <Input
                    type="number"
                    value={lockAlcoholDrinks}
                    onChange={(e) => setLockAlcoholDrinks(e.target.value)}
                    className="h-7 text-xs bg-slate-800 border-slate-700 text-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-bold uppercase text-slate-400">Day Note (Sheet Notes Column)</label>
                <Input
                  type="text"
                  placeholder="e.g. Hoops + 19h fast, or Date night wine..."
                  value={lockDayNote}
                  onChange={(e) => setLockDayNote(e.target.value)}
                  className="h-7 text-xs bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setScoreLockOpen(false)} className="h-7 text-[10px] text-slate-300">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleLockDayScore}
                  disabled={isLockingScore}
                  className="h-7 px-3 text-[10px] font-black uppercase bg-emerald-500 hover:bg-emerald-600 text-white"
                >
                  {isLockingScore ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                  Save to Ledger
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Right 7 cols: Smarter 3-Signal Alpert "Should I Eat Now?" & Protein Pacing Runway */}
        <Card className={`lg:col-span-7 border shadow-md overflow-hidden ${runwayStyles.bg}`}>
          <CardContent className="p-5 sm:p-6 flex flex-col justify-between h-full gap-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${runwayStyles.badge}`}>
                    {runwayStyles.label}
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-wider opacity-60">
                    Alpert & Glycogen Timing Engine
                  </span>
                </div>
                <h3 className="text-lg sm:text-xl font-black tracking-tight">
                  {eatRunway.headline}
                </h3>
                <p className="text-xs font-medium opacity-80 leading-relaxed">
                  {eatRunway.subline}
                </p>
              </div>
            </div>

            {/* 3-Signal Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Signal 1: Intraday Fuel Tank / Muscle Clock */}
              <div className="bg-white/80 backdrop-blur-sm rounded-xl p-3 border border-black/5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                    1. Intraday Fuel Tank
                  </span>
                  <Clock className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <p className="text-sm font-black text-foreground">
                  {eatRunway.muscleBurnStartTimeLabel
                    ? `Muscle risk @ ${eatRunway.muscleBurnStartTimeLabel}`
                    : 'Protected all day'}
                </p>
                <p className="text-[10px] font-bold text-muted-foreground mt-0.5">
                  Liver buffer: {eatRunway.liverKcalRemaining} kcal
                  {eatRunway.hoursUntilMuscleBurn !== null ? ` · ~${eatRunway.hoursUntilMuscleBurn}h left` : ''}
                </p>
              </div>

              {/* Signal 2: Alpert Calorie Floor & 100-Pt Intake Target */}
              <div className="bg-white/80 backdrop-blur-sm rounded-xl p-3 border border-black/5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                    2. Alpert Floor & 100-Pt
                  </span>
                  <Flame className="w-3.5 h-3.5 text-orange-600" />
                </div>
                <p className="text-sm font-black text-foreground">
                  {eatRunway.kcalToAlpertFloor > 0
                    ? `Eat ≥${eatRunway.kcalToAlpertFloor.toLocaleString()} kcal more`
                    : `Floor (${eatRunway.alpertFloorIntakeKcal.toLocaleString()} kcal) cleared ✓`}
                </p>
                <p className="text-[10px] font-bold text-muted-foreground mt-0.5">
                  100-pt intake: {eatRunway.target100PtIntakeKcal.toLocaleString()} kcal (
                  {eatRunway.kcalLeftFor100Pts >= 0
                    ? `${eatRunway.kcalLeftFor100Pts.toLocaleString()} left`
                    : `${Math.abs(eatRunway.kcalLeftFor100Pts).toLocaleString()} over`}
                  )
                </p>
              </div>

              {/* Signal 3: Protein Pacing Window */}
              <div className="bg-white/80 backdrop-blur-sm rounded-xl p-3 border border-black/5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                    3. Protein Window
                  </span>
                  <Utensils className="w-3.5 h-3.5 text-purple-600" />
                </div>
                <p className="text-sm font-black text-foreground">
                  {eatRunway.proteinToGoG > 0
                    ? `${eatRunway.proteinToGoG}g to go (${eatRunway.mealsNeededForProtein} meal${eatRunway.mealsNeededForProtein === 1 ? '' : 's'})`
                    : `${proteinGoal}g Target Hit ✓`}
                </p>
                <div className="mt-1.5">
                  <Progress value={proteinProgress} className="h-1.5 bg-purple-100" />
                  <p className="text-[9px] font-bold text-muted-foreground mt-1">
                    {dailyProteinG}g / {proteinGoal}g · {eatRunway.hoursUntilKitchenClose}h to 8:30 PM
                  </p>
                </div>
              </div>
            </div>

            {alpertPace && eatRunway.status === 'clear' && (
              <div className="flex items-center gap-2 text-[10px] font-bold text-amber-800 bg-amber-100/70 px-3 py-1.5 rounded-lg">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Raw watch deficit is high ({alpertPace.projectedDaily.toLocaleString()} kcal proj), buffered by liver glycogen until {eatRunway.muscleBurnStartTimeLabel ?? 'evening'}.
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── ROW 2: Zero-AI Quick Log Bar (Ticker Book + Custom Food Entry, 0 Gemini Calls) ── */}
      <Card className="border-none shadow-sm bg-white/80 ring-1 ring-black/5">
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase tracking-widest">
                Zero-AI Quick Log
              </span>
              <span className="text-[11px] font-bold text-muted-foreground">
                Log saved Ticker meals or macros directly to Firestore without spending Gemini tokens
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setQuickFoodOpen((v) => !v)}
              className="h-7 px-2.5 text-[10px] font-black uppercase tracking-wider"
            >
              <Plus className="w-3 h-3 mr-1" />
              {quickFoodOpen ? 'Close Quick Entry' : 'Custom Food / Macro'}
            </Button>
          </div>

          {nicknameList.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {nicknameList.map((nick) => (
                <Button
                  key={nick.nickname}
                  size="sm"
                  variant="secondary"
                  disabled={isLoggingQuick}
                  onClick={() => handleQuickLogNickname(nick)}
                  className="h-7 px-2.5 text-[10px] font-bold rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 border border-slate-200"
                  title={`${nick.description}: ${nick.totalCalories} kcal, ${nick.totalProteinG}g P`}
                >
                  <Sparkles className="w-3 h-3 mr-1 text-emerald-600" />
                  {nick.nickname}
                  <span className="ml-1 opacity-60 text-[9px]">
                    ({nick.totalCalories} kcal · {nick.totalProteinG}g P)
                  </span>
                </Button>
              ))}
            </div>
          )}

          {quickFoodOpen && (
            <form onSubmit={handleQuickCustomFoodSubmit} className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-2 border-t">
              <Input
                placeholder="Item name (e.g. Greek Yogurt)"
                value={quickItemName}
                onChange={(e) => setQuickItemName(e.target.value)}
                className="h-8 text-xs sm:col-span-2"
              />
              <Input
                type="number"
                placeholder="Calories"
                value={quickCalories}
                onChange={(e) => setQuickCalories(e.target.value)}
                className="h-8 text-xs"
                required
              />
              <Input
                type="number"
                placeholder="Protein (g)"
                value={quickProtein}
                onChange={(e) => setQuickProtein(e.target.value)}
                className="h-8 text-xs"
              />
              <select
                value={quickMeal}
                onChange={(e) => setQuickMeal(e.target.value as any)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium"
              >
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
                <option value="snack">Snack</option>
              </select>
              <Button type="submit" size="sm" disabled={isLoggingQuick} className="h-8 text-[10px] font-black uppercase">
                {isLoggingQuick ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                Log Item
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* ── ROW 3: Flexible Level / Sprint Tracker (Replaces Google Sheet Right-Side Blocks) ── */}
      {showVfScore && (
        <Card className="border-none shadow-xl overflow-hidden bg-slate-900 text-white">
          <CardContent className="p-5 sm:p-7 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="p-3 bg-emerald-500/20 rounded-2xl border border-emerald-500/30">
                  <Trophy className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">
                      Active Level Sprint
                    </span>
                    <span className="px-2 py-0.5 rounded bg-white/10 text-[9px] font-bold text-slate-300">
                      Since {activeLevel.startDate}
                    </span>
                    {activeLevel.engineEra && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-[9px] font-bold text-emerald-300">
                        {activeLevel.engineEra}
                      </span>
                    )}
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-black italic tracking-tight mt-0.5">
                    {activeLevel.name}
                  </h3>
                  {activeLevel.notes && (
                    <p className="text-xs text-slate-400 mt-0.5">{activeLevel.notes}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openLevelEditor(activeLevel)}
                  className="h-8 px-3 text-[10px] font-black uppercase tracking-wider bg-white/10 hover:bg-white/20 text-white border-none"
                >
                  <Settings2 className="w-3.5 h-3.5 mr-1.5" />
                  Edit / New Level
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setPastLevelsOpen((v) => !v)}
                  className="h-8 px-3 text-[10px] font-black uppercase tracking-wider bg-white/10 hover:bg-white/20 text-white border-none"
                >
                  <History className="w-3.5 h-3.5 mr-1.5" />
                  Sheet Levels ({levelHistory.length})
                </Button>
              </div>
            </div>

            {/* Google Sheet Columns: Total Points | Points per Day | Target | Points to Target | Days to Target | Fin Date */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Total Points</p>
                <p className="text-2xl font-black italic text-emerald-400 mt-0.5">
                  {levelProgress.totalPoints.toLocaleString()}
                </p>
                <p className="text-[9px] font-bold text-slate-400">
                  {levelProgress.daysScored} day{levelProgress.daysScored === 1 ? '' : 's'} scored
                </p>
              </div>

              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Points per Day</p>
                <p className="text-2xl font-black italic text-white mt-0.5">
                  {levelProgress.pointsPerDay}
                </p>
                <p className="text-[9px] font-bold text-slate-400">
                  7d pace: {levelProgress.rolling7dPointsPerDay}/d
                </p>
              </div>

              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Target</p>
                <p className="text-2xl font-black italic text-white mt-0.5">
                  {levelProgress.targetPoints.toLocaleString()}
                </p>
                <p className="text-[9px] font-bold text-slate-400">
                  {levelProgress.progressPct}% complete
                </p>
              </div>

              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Points to Target</p>
                <p className={`text-2xl font-black italic mt-0.5 ${levelProgress.pointsToTarget <= 0 ? 'text-emerald-400' : 'text-amber-300'}`}>
                  {levelProgress.pointsToTarget.toLocaleString()}
                </p>
                <p className="text-[9px] font-bold text-slate-400">
                  {levelProgress.pointsToTarget <= 0 ? 'Target beaten ✓' : 'Remaining'}
                </p>
              </div>

              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Days to Target</p>
                <p className="text-2xl font-black italic text-white mt-0.5">
                  {levelProgress.daysToTarget !== null ? `${levelProgress.daysToTarget}d` : '—'}
                </p>
                <p className="text-[9px] font-bold text-slate-400">
                  {levelProgress.requiredPointsPerDay !== null
                    ? `Req: ${levelProgress.requiredPointsPerDay} pts/d`
                    : 'At current pace'}
                </p>
              </div>

              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Fin Date</p>
                <p className="text-lg sm:text-xl font-black italic text-emerald-300 mt-1">
                  {levelProgress.projectedFinishDate ?? '—'}
                </p>
                <p className="text-[9px] font-bold text-slate-400">
                  All-Time: {visceralFatPoints.toLocaleString()} pts
                </p>
              </div>
            </div>

            <Progress value={Math.min(100, levelProgress.progressPct)} className="h-2 bg-white/10" />

            {/* Inline Level Editor & Preset Switcher */}
            {levelEditorOpen && (
              <div className="p-4 rounded-xl bg-slate-800/90 border border-white/10 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-black uppercase tracking-wider text-emerald-400">
                    Configure Active Level or Start Fresh Sprint
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold text-slate-400 mr-1">Quick Presets:</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleSwitchPresetLevel({
                          id: 'level-3-lock-in-2026',
                          name: 'Level 3 - Lock-In (v3.2)',
                          startDate: '2026-10-18',
                          targetPoints: 1000,
                          status: 'active',
                          engineEra: 'v3.2 Taylor–Joule',
                          notes: 'Fresh lock-in block starting Oct 18',
                        })
                      }
                      className="h-6 px-2 text-[9px] font-black uppercase bg-slate-700 border-slate-600 text-white hover:bg-slate-600"
                    >
                      Oct 18 Lock-In (1,000 pts)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleSwitchPresetLevel({
                          id: 'level-3-2026-cont',
                          name: 'Level 3 (Continued)',
                          startDate: '2026-07-20',
                          targetPoints: 2000,
                          status: 'active',
                          engineEra: 'v3.1 / v3.2',
                          notes: 'Continuing Level 3 from 7/20 toward 2,000 pts',
                        })
                      }
                      className="h-6 px-2 text-[9px] font-black uppercase bg-slate-700 border-slate-600 text-white hover:bg-slate-600"
                    >
                      Continue Level 3 (7/20 · 2,000 pts)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleSwitchPresetLevel({
                          id: 'level-3-retry-2026',
                          name: 'Level 3 - Retry',
                          startDate: '2026-10-11',
                          targetPoints: 500,
                          status: 'active',
                          engineEra: 'v3.1 / v3.2',
                          notes: '500-pt sprint from 10/11',
                        })
                      }
                      className="h-6 px-2 text-[9px] font-black uppercase bg-slate-700 border-slate-600 text-white hover:bg-slate-600"
                    >
                      Level 3 Retry (10/11 · 500 pts)
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-bold uppercase text-slate-400">Level Name</label>
                    <Input
                      value={editLevelName}
                      onChange={(e) => setEditLevelName(e.target.value)}
                      className="h-8 text-xs bg-slate-900 border-slate-700 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Start Date</label>
                    <Input
                      type="date"
                      value={editLevelStart}
                      onChange={(e) => setEditLevelStart(e.target.value)}
                      className="h-8 text-xs bg-slate-900 border-slate-700 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Target Points</label>
                    <Input
                      type="number"
                      value={editLevelTarget}
                      onChange={(e) => setEditLevelTarget(e.target.value)}
                      className="h-8 text-xs bg-slate-900 border-slate-700 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Target Date (Opt)</label>
                    <Input
                      type="date"
                      value={editLevelDeadline}
                      onChange={(e) => setEditLevelDeadline(e.target.value)}
                      className="h-8 text-xs bg-slate-900 border-slate-700 text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-bold uppercase text-slate-400">Notes</label>
                    <Input
                      value={editLevelNotes}
                      onChange={(e) => setEditLevelNotes(e.target.value)}
                      placeholder="Optional sprint focus..."
                      className="h-8 text-xs bg-slate-900 border-slate-700 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Carryover Offset Pts</label>
                    <Input
                      type="number"
                      value={editLevelOffset}
                      onChange={(e) => setEditLevelOffset(e.target.value)}
                      className="h-8 text-xs bg-slate-900 border-slate-700 text-white"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  <Button size="sm" variant="ghost" onClick={() => setLevelEditorOpen(false)} className="h-8 text-xs text-slate-300">
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleArchiveAndStartNewLevel()}
                    className="h-8 text-xs font-black uppercase bg-amber-500/20 border-amber-500/40 text-amber-200 hover:bg-amber-500/30"
                  >
                    Archive Current & Start New Today
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveActiveLevel}
                    className="h-8 text-xs font-black uppercase bg-emerald-500 hover:bg-emerald-600 text-white"
                  >
                    Save Level Settings
                  </Button>
                </div>
              </div>
            )}

            {/* Archived Google Sheet Levels Table */}
            {pastLevelsOpen && (
              <div className="p-4 rounded-xl bg-slate-800/80 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black uppercase tracking-wider text-slate-300">
                    2026 Level History (Imported from Google Sheet)
                  </p>
                  <span className="text-[10px] text-slate-400">Click any level to make it active</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-[9px] font-black uppercase text-slate-400">
                        <th className="py-2 pr-3">Level</th>
                        <th className="py-2 pr-3">Dates</th>
                        <th className="py-2 pr-3">Total Pts</th>
                        <th className="py-2 pr-3">Target</th>
                        <th className="py-2 pr-3">Pts/Day</th>
                        <th className="py-2 pr-3">Engine Vintage</th>
                        <th className="py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {levelHistory.map((lvl) => {
                        const p = computeLevelProgress(lvl, data.history ?? [], { todayIso: todayStr });
                        return (
                          <tr key={lvl.id} className="hover:bg-white/5">
                            <td className="py-2 pr-3 font-black text-white">{lvl.name}</td>
                            <td className="py-2 pr-3 text-slate-300">
                              {lvl.startDate} → {lvl.endDate ?? 'Present'}
                            </td>
                            <td className={`py-2 pr-3 font-black ${p.totalPoints >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {p.totalPoints.toLocaleString()}
                            </td>
                            <td className="py-2 pr-3 text-slate-300">{lvl.targetPoints.toLocaleString()}</td>
                            <td className="py-2 pr-3 text-slate-300">{p.pointsPerDay}/d</td>
                            <td className="py-2 pr-3">
                              <span className="px-1.5 py-0.5 rounded bg-white/10 text-[9px] font-bold text-slate-300">
                                {lvl.engineEra ?? 'v2.0'}
                              </span>
                            </td>
                            <td className="py-2 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleSwitchPresetLevel(lvl)}
                                className="h-6 px-2 text-[9px] font-black uppercase text-emerald-400 hover:text-emerald-300"
                              >
                                Activate
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── ROW 4: Compact Vitals Strip (Steps, Recovery, Weight, MPS, + Optional Plant Matter) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-none shadow-sm bg-white/80 ring-1 ring-black/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Steps</p>
              <h4 className="text-2xl font-black italic mt-0.5">
                {isViewingToday
                  ? (data.steps || 0).toLocaleString()
                  : fitbitForDate?.steps != null ? fitbitForDate.steps.toLocaleString() : 'N/A'}
              </h4>
            </div>
            <div className="p-2.5 bg-orange-100 rounded-xl">
              <Zap className="w-5 h-5 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        {showRecovery && (
          <Card className="border-none shadow-sm bg-white/80 ring-1 ring-black/5">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">
                  Recovery ({isViewingToday ? (data.hrv > 0 ? `${data.hrv}ms` : '—') : (fitbitForDate?.hrv ? `${fitbitForDate.hrv}ms` : '—')})
                </p>
                <h4 className="text-2xl font-black italic uppercase mt-0.5">
                  {isViewingToday
                    ? (data.hrv > 0 ? (data.recoveryStatus || 'MEDIUM') : 'N/A')
                    : (fitbitForDate?.recoveryStatus?.toUpperCase() ?? 'N/A')}
                </h4>
              </div>
              <div className="p-2.5 bg-blue-100 rounded-xl">
                <Target className="w-5 h-5 text-blue-600" />
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-none shadow-sm bg-white/80 ring-1 ring-black/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Weight</p>
              <h4 className="text-2xl font-black italic mt-0.5">
                {data.weightKg ? `${data.weightKg}kg` : 'N/A'}
              </h4>
            </div>
            <div className="p-2.5 bg-emerald-100 rounded-xl">
              <Scale className="w-5 h-5 text-emerald-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white/80 ring-1 ring-black/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Anabolic MPS</p>
              <h4 className="text-2xl font-black italic mt-0.5">
                {simulationResult
                  ? `${Math.round(simulationResult.slots[nowSlot || simulationResult.slots.length - 1].anabolicSignal * 100)}%`
                  : 'N/A'}
              </h4>
            </div>
            <div className="p-2.5 bg-red-100 rounded-xl">
              <Activity className="w-5 h-5 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {showPlantMatter && (
        <Card className="border-none shadow-sm bg-white/80 ring-1 ring-black/5">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-xl shrink-0">
              <Activity className="w-5 h-5 text-green-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-end mb-1">
                <p className="text-xs font-black text-foreground uppercase">Plant Matter (Starrett 800g)</p>
                <span className="text-xs font-black text-muted-foreground">{Math.round(dailyPlantG)}g / {plantGoalG}g</span>
              </div>
              <Progress value={plantProgress} className="h-2 bg-green-50" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── ROW 5: Collapsible Deep-Dive Metabolic Charts (Collapsed by default to declutter) ── */}
      {showAdvancedMetabolic && (
        <div className="space-y-3">
          <Button
            variant="outline"
            onClick={() => setChartsExpanded((v) => !v)}
            className="w-full justify-between h-10 px-4 text-xs font-black uppercase tracking-widest bg-white/70 hover:bg-white"
          >
            <span>Deep-Dive Metabolic Charts (15-Min Glycogen, Fat Faucet & Lab)</span>
            {chartsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
          {chartsExpanded && (
            <DashboardCharts
              caloriesIn={dailyCaloriesIn}
              caloriesOut={scoredCaloriesOut}
              deviceCaloriesOut={dailyCaloriesOut}
              carbsG={dailyCarbsG}
              foodLogs={todayFoodLogs ?? undefined}
              exerciseLogs={todayExerciseLogs ?? undefined}
              morningGlycogenPct={morningGlycogenPct}
              weightKg={data.weightKg}
              bodyFatPct={data.bodyFatPct}
              isDeviceVerified={data.isDeviceVerified}
              connectedDevice={data.connectedDevice}
              isViewingToday={isViewingToday}
              alpertNumber={alpertNumber}
              fitbitActivities={fitbitActivities}
              hrv={isViewingToday ? data.hrv : fitbitForDate?.hrv}
              hasCreatine={prefs?.profile?.hasCreatine}
            />
          )}
        </div>
      )}
    </div>
  );
}
