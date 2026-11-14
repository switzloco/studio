'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  TrendingUp,
  AlertCircle,
  History as HistoryIcon,
  Dumbbell,
  Timer,
  ChevronDown,
  ArrowUpDown,
  Download,
  Trash2,
  Loader2,
  GripVertical,
  Clock,
  Moon,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Pill,
} from "lucide-react";
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import { fetchAllLedger, ledgerToCSV, ledgerToJSON, downloadTextFile } from '@/lib/ledger-export';
import { HealthData, HistoryEntry, UserPreferences, healthService } from '@/lib/health-service';
import {
  formatSupplementBadges,
  hhmmToMinutes,
  minutesToHHMM,
  formatHHMM12h,
  inferMealFromTime,
  interpolateSlotTiming,
  type FoodLogEntry,
  type ExerciseLogEntry,
  type FastLogEntry,
} from '@/lib/food-exercise-types';
import { rescoreRecentDays } from '@/app/actions/fitbit';
import { useToast } from '@/hooks/use-toast';
import { VFScoreChart } from './vf-score-chart';
import { VFHeatmap } from './vf-heatmap';
import { VFDayDetail } from './vf-day-detail';
import { LedgerChat } from './ledger-chat';
import { ChatHistoryLog } from './chat-history-log';
import { ProteinChart } from './protein-chart';
import { ShareMealButton } from './share-meal-button';
import { MySharesSection } from './my-shares-section';
import { HybridTickerTerminal } from './hybrid-ticker-terminal';
import { ExecutionReceiptBadge } from './execution-receipt-badge';
import { useHybridAi } from './hybrid-ai-provider';
import { CFO_CLASS_META, type CfoLedgerClass } from '@/lib/usda-local-reconciler';
import { inferScoringRelease } from '@/lib/scoring-releases';
import {
  computeDailyLevelPointsMap,
  DEFAULT_LEVEL_HISTORY,
  getEffectiveDayNote,
  resolveActiveLevel,
} from '@/lib/level-tracker';

type SortMode = 'latest' | 'calories';

type LedgerEntry = {
  id: string;
  type: 'food' | 'exercise' | 'fast';
  name: string;
  detail: string;
  date: string;
  rawTime: string;     // HH:MM (24h) for timeline scrubber & interpolation
  displayTime: string; // consumedAt/performedAt or fallback to timestamp
  occurredAt: number;  // millis from date+time for occurrence-based sorting
  timestamp: Timestamp | null;
  ignored?: boolean;
  // Expanded detail fields
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  portionG?: number;
  meal?: string;
  source?: string;
  alcoholDrinks?: number;
  hasSeedOils?: boolean;
  // Supplement fields
  betaAlanineG?: number;
  creatineG?: number;
  caffeineMg?: number;
  omega3Mg?: number;
  hasElectrolytes?: boolean;
  supplementBadges?: string[];
  // Exercise fields
  category?: string;
  sets?: number;
  reps?: number;
  durationMin?: number;
  weightKg?: number;
  estimatedCaloriesBurned?: number;
  pointsDelta?: number;
  notes?: string;
  // Fast fields
  startedAt?: string;
  endedAt?: string;
  durationHours?: number;
  // Hybrid AI execution telemetry
  inferenceSource?: 'ON_DEVICE' | 'IN_CLOUD';
  inferenceLatencyMs?: number;
  cfoClass?: CfoLedgerClass;
};

function resolveRawTime(time?: string, ts?: unknown): string {
  if (time && /^\d{1,2}:\d{2}$/.test(time.trim())) {
    const [h, m] = time.trim().split(':').map(Number);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (ts instanceof Timestamp) {
    const d = ts.toDate();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return '12:00';
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatIsoDateLabel(isoDate: string, todayIso: string, yesterdayIso: string): string {
  if (isoDate === todayIso) return `Today (${isoDate})`;
  if (isoDate === yesterdayIso) return `Yesterday (${isoDate})`;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return `${dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} (${isoDate})`;
}

function formatDisplayTime(date: string, time?: string, ts?: unknown): string {
  if (time) {
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);
    const d = new Date(year, month - 1, day, hours, minutes);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (ts instanceof Timestamp) {
    return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return 'Pending...';
}

/** Compute occurrence time in millis from date + HH:MM, falling back to Firestore timestamp. */
function occurrenceMillis(date: string, time?: string, ts?: unknown): number {
  if (time && date) {
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes).getTime();
  }
  if (ts instanceof Timestamp) return ts.toMillis();
  return 0;
}

export function HistoryView() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const [ledgerLimit, setLedgerLimit] = useState(20);
  const [exporting, setExporting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [savingTiming, setSavingTiming] = useState(false);

  const todayIso = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);
  const yesterdayIso = useMemo(() => shiftIsoDate(todayIso, -1), [todayIso]);
  const { setEarningsModalOpen } = useHybridAi();

  // Drag-and-Drop Timing & Timeline Popup state
  const [timingEditor, setTimingEditor] = useState<{
    entry: LedgerEntry;
    targetDate: string;
    targetTime: string;
    targetMeal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    isDragging: boolean;
    dropSlotIndex: number | null;
    dropPresetLabel?: string;
  } | null>(null);

  const dragMetaRef = useRef<{
    entry: LedgerEntry;
    originIndex: number;
    startX: number;
    startY: number;
    baseTime: string;
    baseDate: string;
    hasMoved: boolean;
    latestDate: string;
    latestTime: string;
    latestMeal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  } | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const isScrubbingTimelineRef = useRef(false);

  const handleExport = async (format: 'csv' | 'json') => {
    if (!user || exporting) return;
    setExporting(true);
    try {
      const data = await fetchAllLedger(db, user.uid);
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        downloadTextFile(`cfo-ledger-${stamp}.csv`, ledgerToCSV(data), 'text/csv;charset=utf-8');
      } else {
        downloadTextFile(`cfo-ledger-${stamp}.json`, ledgerToJSON(data), 'application/json');
      }
    } catch (err) {
      console.error('Ledger export failed', err);
    } finally {
      setExporting(false);
    }
  };

  // 1. Fetch High-Level Equity Summary (for the charts)
  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData, isLoading: isHealthLoading } = useDoc<HealthData>(userDocRef);
  const prefsRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid, 'preferences', 'settings') : null, [db, user]);
  const { data: prefs } = useDoc<UserPreferences>(prefsRef);
  const [logScope, setLogScope] = useState<'all' | 'level'>('all');

  // 2. Fetch structured food & exercise logs for the transaction ledger
  const foodQuery = useMemoFirebase(() => user ? query(
    collection(db, 'users', user.uid, 'food_log'),
    orderBy('timestamp', 'desc'),
    limit(ledgerLimit)
  ) : null, [db, user, ledgerLimit]);
  const { data: foodLogs, isLoading: isFoodLoading } = useCollection<FoodLogEntry>(foodQuery);

  const exerciseQuery = useMemoFirebase(() => user ? query(
    collection(db, 'users', user.uid, 'exercise_log'),
    orderBy('timestamp', 'desc'),
    limit(ledgerLimit)
  ) : null, [db, user, ledgerLimit]);
  const { data: exerciseLogs, isLoading: isExerciseLoading } = useCollection<ExerciseLogEntry>(exerciseQuery);

  // fast_log uses a plain getDocs (not useCollection) so that a permission
  // error — e.g. rules not yet deployed — fails silently rather than crashing
  // the whole page through FirebaseErrorListener.
  const [fastLogs, setFastLogs] = useState<FastLogEntry[]>([]);
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'users', user.uid, 'fast_log'),
      orderBy('timestamp', 'desc'),
      limit(ledgerLimit),
    );
    getDocs(q)
      .then(snap => setFastLogs(snap.docs.map(d => ({ ...d.data(), id: d.id } as FastLogEntry)).filter(e => !e.ignored)))
      .catch(() => { /* collection missing or rules not yet deployed — show empty */ });
  }, [db, user, ledgerLimit]);

  // Merge, filter ignored, and sort
  const ledgerEntries = useMemo<LedgerEntry[]>(() => {
    const entries: LedgerEntry[] = [];

    if (foodLogs) {
      for (const f of foodLogs) {
        if (f.ignored) continue;
        const suppBadges = formatSupplementBadges(f);
        const isZeroCalSupp = (f.calories ?? 0) === 0 && (f.proteinG ?? 0) === 0 && suppBadges.length > 0;
        const rawTime = resolveRawTime(f.consumedAt, f.timestamp);
        entries.push({
          id: f.id || `${f.date}-${f.name}`,
          type: 'food',
          name: f.name,
          detail: isZeroCalSupp
            ? `${f.name} — ${suppBadges.join(' · ')} (Supplement)`
            : `${f.name} (${f.portionG}g) — ${f.calories} cal, ${f.proteinG}g protein${suppBadges.length > 0 ? ` · ${suppBadges.join(', ')}` : ''}`,
          date: f.date,
          rawTime,
          displayTime: formatDisplayTime(f.date, f.consumedAt, f.timestamp),
          occurredAt: occurrenceMillis(f.date, f.consumedAt, f.timestamp),
          timestamp: f.timestamp instanceof Timestamp ? f.timestamp : null,
          calories: f.calories,
          proteinG: f.proteinG,
          carbsG: f.carbsG,
          fatG: f.fatG,
          fiberG: f.fiberG,
          portionG: f.portionG,
          meal: f.meal,
          source: f.source,
          alcoholDrinks: f.alcoholDrinks,
          hasSeedOils: f.hasSeedOils,
          betaAlanineG: f.betaAlanineG,
          creatineG: f.creatineG,
          caffeineMg: f.caffeineMg,
          omega3Mg: f.omega3Mg,
          hasElectrolytes: f.hasElectrolytes,
          supplementBadges: suppBadges,
          inferenceSource: f.inferenceSource,
          inferenceLatencyMs: f.inferenceLatencyMs,
          cfoClass: f.cfoClass,
        });
      }
    }

    if (exerciseLogs) {
      for (const e of exerciseLogs) {
        if (e.ignored) continue;
        const parts = [e.name];
        if (e.durationMin) parts.push(`${e.durationMin} min`);
        if (e.sets && e.reps) parts.push(`${e.sets}×${e.reps}`);
        else if (e.reps) parts.push(`${e.reps} reps`);
        const rawTime = resolveRawTime(e.performedAt, e.timestamp);
        entries.push({
          id: e.id || `${e.date}-${e.name}`,
          type: 'exercise',
          name: e.name,
          detail: `${parts.join(' — ')} — +${e.pointsDelta} pts`,
          date: e.date,
          rawTime,
          displayTime: formatDisplayTime(e.date, e.performedAt, e.timestamp),
          occurredAt: occurrenceMillis(e.date, e.performedAt, e.timestamp),
          timestamp: e.timestamp instanceof Timestamp ? e.timestamp : null,
          category: e.category,
          sets: e.sets,
          reps: e.reps,
          durationMin: e.durationMin,
          weightKg: e.weightKg,
          estimatedCaloriesBurned: e.estimatedCaloriesBurned,
          pointsDelta: e.pointsDelta,
          notes: e.notes,
          inferenceSource: e.inferenceSource,
          inferenceLatencyMs: e.inferenceLatencyMs,
          cfoClass: e.cfoClass,
        });
      }
    }

    if (fastLogs) {
      for (const f of fastLogs) {
        if (f.ignored) continue;
        const status = f.endedAt
          ? `${f.durationHours?.toFixed(1) ?? '?'}h fast — ${f.startedAt} → ${f.endedAt}`
          : `Active fast — started ${f.startedAt}`;
        const rawTime = resolveRawTime(f.startedAt, f.timestamp);
        entries.push({
          id: f.id ?? `fast-${f.date}-${f.startedAt}`,
          type: 'fast',
          name: f.endedAt ? `${f.durationHours?.toFixed(1) ?? '?'}h Fast` : 'Active Fast',
          detail: status + (f.notes ? ` (${f.notes})` : ''),
          date: f.date,
          rawTime,
          displayTime: formatDisplayTime(f.date, f.startedAt, f.timestamp),
          occurredAt: occurrenceMillis(f.date, f.startedAt, f.timestamp),
          timestamp: f.timestamp instanceof Timestamp ? f.timestamp : null,
          startedAt: f.startedAt,
          endedAt: f.endedAt,
          durationHours: f.durationHours,
          notes: f.notes,
        });
      }
    }

    if (sortMode === 'calories') {
      entries.sort((a, b) => (b.calories ?? b.estimatedCaloriesBurned ?? 0) - (a.calories ?? a.estimatedCaloriesBurned ?? 0));
    } else {
      // Default: sort by occurrence time (date + consumedAt/performedAt), not Firestore write time
      entries.sort((a, b) => b.occurredAt - a.occurredAt);
    }
    return entries;
  }, [foodLogs, exerciseLogs, fastLogs, sortMode]);

  const isLogsLoading = isFoodLoading || isExerciseLoading;

  const history = healthData?.history || [];
  const activeLevel = useMemo(() => resolveActiveLevel(prefs?.activeLevel), [prefs?.activeLevel]);
  const levelHistory = useMemo(() => prefs?.levelHistory ?? DEFAULT_LEVEL_HISTORY, [prefs?.levelHistory]);
  const levelPointsMap = useMemo(
    () => computeDailyLevelPointsMap(history, activeLevel, levelHistory),
    [history, activeLevel, levelHistory]
  );

  const handleDayClick = (entry: HistoryEntry) => {
    setSelectedEntry(entry);
    setSheetOpen(true);
  };

  const toggleLedgerExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const handleRemoveLedgerEntry = async (entry: LedgerEntry) => {
    if (!user || removingId) return;
    setRemovingId(entry.id);
    try {
      if (entry.type === 'food') {
        await healthService.setFoodEntryIgnored(db, user.uid, entry.id, true);
        if (entry.date === todayIso && foodLogs) {
          const remaining = foodLogs.filter((f) => !f.ignored && f.id !== entry.id && f.date === todayIso);
          await healthService.updateHealthData(db, user.uid, {
            dailyCaloriesIn: remaining.reduce((s, f) => s + (f.calories || 0), 0),
            dailyProteinG: remaining.reduce((s, f) => s + (f.proteinG || 0), 0),
            dailyCarbsG: remaining.reduce((s, f) => s + (f.carbsG || 0), 0),
          });
        }
      } else if (entry.type === 'exercise') {
        await healthService.setExerciseEntryIgnored(db, user.uid, entry.id, true);
      }
      toast({
        title: `Removed "${entry.name}"`,
        description: `Entry removed from ${entry.date} ledger.`,
      });
    } catch (err) {
      console.error('[handleRemoveLedgerEntry] Failed:', err);
      toast({ variant: 'destructive', title: 'Remove Failed', description: 'Could not remove ledger entry.' });
    } finally {
      setRemovingId(null);
    }
  };

  const handleApplyTimingUpdate = useCallback(
    async (
      entry: LedgerEntry,
      newDate: string,
      newTime: string,
      newMeal?: 'breakfast' | 'lunch' | 'dinner' | 'snack',
      closePopup = false
    ) => {
      if (!user || savingTiming) return;
      setSavingTiming(true);
      try {
        const resolvedMeal = newMeal || inferMealFromTime(newTime);
        await healthService.updateLedgerEntryTiming(db, user.uid, {
          id: entry.id,
          type: entry.type,
          oldDate: entry.date,
          newDate,
          newTime,
          meal: entry.type === 'food' ? resolvedMeal : undefined,
          todayIso,
        });
        if (entry.type === 'fast') {
          setFastLogs((prev) =>
            prev.map((f) => (f.id === entry.id ? { ...f, date: newDate, startedAt: newTime } : f))
          );
        }
        rescoreRecentDays(user.uid, todayIso, 14).catch(() => {});
        const updatedEntry: LedgerEntry = {
          ...entry,
          date: newDate,
          rawTime: newTime,
          meal: entry.type === 'food' ? resolvedMeal : entry.meal,
          displayTime: formatDisplayTime(newDate, newTime, entry.timestamp),
          occurredAt: occurrenceMillis(newDate, newTime, entry.timestamp),
        };
        if (closePopup) {
          setTimingEditor(null);
        } else {
          setTimingEditor((prev) =>
            prev
              ? {
                  ...prev,
                  entry: updatedEntry,
                  targetDate: newDate,
                  targetTime: newTime,
                  targetMeal: resolvedMeal,
                  isDragging: false,
                  dropSlotIndex: null,
                }
              : null
          );
        }
        toast({
          title: `Moved "${entry.name}"`,
          description: `Now logged on ${formatIsoDateLabel(newDate, todayIso, yesterdayIso)} at ${formatHHMM12h(newTime)}.`,
        });
      } catch (err) {
        console.error('[handleApplyTimingUpdate] Failed:', err);
        toast({
          variant: 'destructive',
          title: 'Move Failed',
          description: 'Could not update ledger entry timing.',
        });
      } finally {
        setSavingTiming(false);
      }
    },
    [user, savingTiming, db, todayIso, yesterdayIso, toast]
  );

  // Start dragging a ledger entry's timestamp pill across existing entries
  const handleStartTimingDrag = (
    e: React.PointerEvent,
    entry: LedgerEntry,
    index: number
  ) => {
    e.stopPropagation();
    const initialMeal =
      (entry.meal as 'breakfast' | 'lunch' | 'dinner' | 'snack' | undefined) ||
      inferMealFromTime(entry.rawTime);

    dragMetaRef.current = {
      entry,
      originIndex: index,
      startX: e.clientX,
      startY: e.clientY,
      baseTime: entry.rawTime,
      baseDate: entry.date,
      hasMoved: false,
      latestDate: entry.date,
      latestTime: entry.rawTime,
      latestMeal: initialMeal,
    };

    setTimingEditor({
      entry,
      targetDate: entry.date,
      targetTime: entry.rawTime,
      targetMeal: initialMeal,
      isDragging: true,
      dropSlotIndex: index,
      dropPresetLabel: undefined,
    });
  };

  useEffect(() => {
    if (!timingEditor?.isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      const meta = dragMetaRef.current;
      if (!meta) return;

      const dx = e.clientX - meta.startX;
      const dy = e.clientY - meta.startY;
      if (!meta.hasMoved && Math.hypot(dx, dy) < 6) return;
      meta.hasMoved = true;

      // Hit-test elements under pointer to see which ledger entry or Last Night drop zone we're over
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      const lastNightEl = els.find((el) => el.getAttribute('data-ledger-last-night') === 'true');

      // Horizontal scrub offset: 15 minutes per 16px of horizontal pointer movement
      const scrubDeltaMin = Math.round(dx / 16) * 15;

      if (lastNightEl) {
        const baseLastNightMin = 20 * 60 + 30; // 8:30 PM default for Last Night
        const nextTime = minutesToHHMM(
          Math.max(17 * 60, Math.min(23 * 60 + 45, baseLastNightMin + scrubDeltaMin)),
          15
        );
        const nextMeal = inferMealFromTime(nextTime);
        meta.latestDate = yesterdayIso;
        meta.latestTime = nextTime;
        meta.latestMeal = nextMeal;
        setTimingEditor((prev) =>
          prev
            ? {
                ...prev,
                targetDate: yesterdayIso,
                targetTime: nextTime,
                targetMeal: nextMeal,
                dropSlotIndex: -1,
                dropPresetLabel: '🌙 Last Night (Yesterday)',
              }
            : null
        );
        return;
      }

      const cardEl = els.find((el) => el.hasAttribute('data-ledger-index'));
      if (cardEl) {
        const hoveredIdx = Number(cardEl.getAttribute('data-ledger-index'));
        const rect = cardEl.getBoundingClientRect();
        const isBottomHalf = e.clientY > rect.top + rect.height / 2;
        const slotIndex = isBottomHalf ? hoveredIdx + 1 : hoveredIdx;

        // Filter out the entry being dragged when computing neighbors
        const others = ledgerEntries.filter((item) => item.id !== meta.entry.id);
        const clampedSlot = Math.max(0, Math.min(others.length, slotIndex));
        const above = clampedSlot > 0 ? others[clampedSlot - 1] : undefined;
        const below = clampedSlot < others.length ? others[clampedSlot] : undefined;

        const interpolated = interpolateSlotTiming({
          aboveEntry: above ? { date: above.date, time: above.rawTime } : undefined,
          belowEntry: below ? { date: below.date, time: below.rawTime } : undefined,
          fallbackDate: meta.baseDate,
        });

        // Apply horizontal scrub offset on top of the slot's interpolated time
        const baseSlotMin = hhmmToMinutes(interpolated.time, 12 * 60);
        const scrubbedTime = minutesToHHMM(
          Math.max(5 * 60, Math.min(23 * 60 + 45, baseSlotMin + scrubDeltaMin)),
          15
        );
        const nextMeal = inferMealFromTime(scrubbedTime);

        meta.latestDate = interpolated.date;
        meta.latestTime = scrubbedTime;
        meta.latestMeal = nextMeal;

        setTimingEditor((prev) =>
          prev
            ? {
                ...prev,
                targetDate: interpolated.date,
                targetTime: scrubbedTime,
                targetMeal: nextMeal,
                dropSlotIndex: slotIndex,
                dropPresetLabel: undefined,
              }
            : null
        );
      } else if (Math.abs(dx) > 12) {
        // Pure horizontal scrubbing when not over a different card
        const baseMin = hhmmToMinutes(meta.baseTime, 12 * 60);
        const scrubbedTime = minutesToHHMM(
          Math.max(5 * 60, Math.min(23 * 60 + 45, baseMin + scrubDeltaMin)),
          15
        );
        const nextMeal = inferMealFromTime(scrubbedTime);
        meta.latestTime = scrubbedTime;
        meta.latestMeal = nextMeal;
        setTimingEditor((prev) =>
          prev
            ? {
                ...prev,
                targetTime: scrubbedTime,
                targetMeal: nextMeal,
              }
            : null
        );
      }
    };

    const handlePointerUp = () => {
      const meta = dragMetaRef.current;
      dragMetaRef.current = null;
      if (!meta) return;

      setTimingEditor((prev) => (prev ? { ...prev, isDragging: false, dropSlotIndex: null } : null));

      // If the user dragged to a new date or time, immediately commit the move and keep the timeline popup open for fine-tuning!
      if (
        meta.hasMoved &&
        (meta.latestDate !== meta.entry.date || meta.latestTime !== meta.entry.rawTime)
      ) {
        handleApplyTimingUpdate(
          meta.entry,
          meta.latestDate,
          meta.latestTime,
          meta.latestMeal,
          false
        );
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [timingEditor?.isDragging, ledgerEntries, yesterdayIso, handleApplyTimingUpdate]);

  // Interactive 24-hour timeline track scrubber (6:00 AM to 11:45 PM = 360..1425 mins)
  const TIMELINE_MIN_START = 6 * 60; // 06:00
  const TIMELINE_MIN_END = 23 * 60 + 45; // 23:45
  const TIMELINE_SPAN = TIMELINE_MIN_END - TIMELINE_MIN_START;

  const updateTimeFromTrackClientX = useCallback((clientX: number) => {
    const track = timelineTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const rawMin = TIMELINE_MIN_START + ratio * TIMELINE_SPAN;
    const snapped = minutesToHHMM(rawMin, 15);
    setTimingEditor((prev) =>
      prev
        ? {
            ...prev,
            targetTime: snapped,
            targetMeal: inferMealFromTime(snapped),
          }
        : null
    );
  }, [TIMELINE_MIN_START, TIMELINE_SPAN]);

  // Entries on the currently selected targetDate in the Timeline Popup (so the user sees existing meals as pins on the timeline!)
  const targetDayOtherEntries = useMemo(() => {
    if (!timingEditor) return [];
    return ledgerEntries
      .filter((e) => e.date === timingEditor.targetDate && e.id !== timingEditor.entry.id)
      .sort((a, b) => hhmmToMinutes(a.rawTime) - hhmmToMinutes(b.rawTime));
  }, [ledgerEntries, timingEditor]);

  if (isHealthLoading || isLogsLoading) {
    return (
      <div className="p-6 sm:p-10 space-y-10">
        <div className="h-10 w-64 bg-muted animate-pulse rounded-xl" />
        <div className="h-80 bg-muted animate-pulse rounded-2xl" />
        <div className="h-48 bg-muted animate-pulse rounded-2xl" />
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-10 space-y-6 sm:space-y-10 pb-24 bg-background w-full max-w-full overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="space-y-1 sm:space-y-2">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase italic text-foreground">Portfolio History</h2>
          <p className="text-[10px] sm:text-[12px] font-bold text-muted-foreground uppercase tracking-[0.25em] sm:tracking-[0.3em]">Historical Asset Audit</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setEarningsModalOpen(true)}
            data-testid="ledger-earnings-call-btn"
            className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-amber-500/50 bg-slate-950 hover:bg-slate-900 px-3.5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-300 shadow-md transition-colors"
          >
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <span>RUN 30-DAY EARNINGS CALL</span>
          </button>
          <div className="p-2.5 sm:p-4 bg-emerald-100 rounded-2xl shadow-sm">
            <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600" />
          </div>
        </div>
      </div>

      {/* Desktop Bloomberg / CRT Hybrid Ticker Tape & Multimodal Expense Receipt Auditor */}
      <HybridTickerTerminal className="hidden sm:block" healthData={healthData} />

      {/* Ledger Analyst — inline query agent */}
      <LedgerChat />

      {/* VF Score Bar + Cumulative Line Chart */}
      {history.length > 0 ? (
        <VFScoreChart
          history={history}
          onDayClick={handleDayClick}
          activeLevel={activeLevel}
          levelHistory={levelHistory}
        />
      ) : (
        <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
          <CardContent className="p-6">
            <div className="h-72 flex flex-col items-center justify-center text-center gap-4 bg-muted/20 rounded-2xl border-2 border-dashed">
              <AlertCircle className="w-12 h-12 text-muted-foreground opacity-30" />
              <div className="space-y-1">
                <p className="text-[12px] font-black text-muted-foreground uppercase tracking-widest">No Historical Market Data</p>
                <p className="text-xs text-muted-foreground italic px-6 max-w-sm">Transactions will appear here once you begin depositing assets into your ledger.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* VF Heatmap Calendar */}
      <VFHeatmap history={history} onDayClick={handleDayClick} />

      {/* Daily VF Score & Sheet Notes Log (Google Sheet View) */}
      {history.length > 0 && (
        <Card className="border-none shadow-md bg-white/80 backdrop-blur-sm ring-1 ring-primary/5">
          <CardContent className="p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-foreground">
                  Daily VF Score & Sheet Notes Log
                </h3>
                <p className="text-[10px] text-muted-foreground font-medium">
                  Click any day to inspect full math, engine vintage, or edit its spreadsheet note
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setLogScope('level')}
                  className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider transition-all ${
                    logScope === 'level'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {activeLevel.name}
                </button>
                <button
                  type="button"
                  onClick={() => setLogScope('all')}
                  className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider transition-all ${
                    logScope === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All Days
                </button>
              </div>
              <span className="hidden">
                {history.filter((h) => h.detail !== 'Account Created').length} days
              </span>
            </div>
            <div className="max-h-72 overflow-auto border rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 border-b text-[9px] font-black uppercase text-slate-600">
                  <tr>
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3">VF Score</th>
                    <th className="py-2 px-3">Level Pts</th>
                    <th className="py-2 px-3">Cumu</th>
                    <th className="py-2 px-3">Engine</th>
                    <th className="py-2 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[...history]
                    .filter((h) => h.detail !== 'Account Created' && (logScope === 'all' || (h.isoDate || h.date) >= activeLevel.startDate))
                    .reverse()
                    .map((h, idx) => {
                      const rel = inferScoringRelease(h);
                      const note = getEffectiveDayNote(h);
                      const lvlInfo = levelPointsMap.get(h.isoDate || h.date);
                      return (
                        <tr
                          key={`${h.isoDate || h.date}-${idx}`}
                          onClick={() => handleDayClick(h)}
                          className="hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          <td className="py-2 px-3 font-bold whitespace-nowrap">
                            {h.isoDate || h.date}
                          </td>
                          <td className={`py-2 px-3 font-black whitespace-nowrap ${h.gain >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {h.gain > 0 ? `+${h.gain}` : h.gain}
                          </td>
                          <td className="py-2 px-3 font-black whitespace-nowrap">
                            {lvlInfo ? (
                              <span className="inline-flex items-center gap-1">
                                <span
                                  className={`px-1 py-0.5 rounded text-[8px] font-black uppercase ${
                                    lvlInfo.isInActiveLevel
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {lvlInfo.shortLabel}
                                </span>
                                <span className={lvlInfo.levelPoints >= 0 ? 'text-emerald-700' : 'text-amber-700'}>
                                  {lvlInfo.levelPoints > 0 ? `+${lvlInfo.levelPoints}` : lvlInfo.levelPoints}
                                </span>
                                <span className="text-[9px] font-semibold text-muted-foreground">
                                  /{lvlInfo.targetPoints}
                                </span>
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-2 px-3 font-semibold text-muted-foreground whitespace-nowrap">
                            {h.equity.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[9px] font-black text-slate-700">
                              v{rel.version}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground truncate max-w-[260px]">
                            {note ? (
                              <span className="font-semibold text-amber-800">{note}</span>
                            ) : (
                              <span className="opacity-60">{h.detail}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit Log (Transactions) */}
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div>
            <h3 className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.2em] italic">
              Transaction Ledger
            </h3>
            <p className="text-[11px] font-medium text-muted-foreground mt-0.5">
              Drag any entry&apos;s <span className="font-bold text-indigo-600">⠿ timestamp</span> across existing entries (or tap it) to pop up the Day Timeline &amp; move timing
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Export full ledger */}
            <div className="flex items-center gap-1.5">
              <Download className={`w-3.5 h-3.5 text-muted-foreground ${exporting ? 'animate-pulse' : ''}`} />
              {exporting ? (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 text-muted-foreground">Exporting…</span>
              ) : (
                (['csv', 'json'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => handleExport(fmt)}
                    title={`Export your entire ledger as ${fmt.toUpperCase()}`}
                    className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full transition-all text-muted-foreground hover:text-foreground hover:bg-muted ring-1 ring-border"
                  >
                    {fmt}
                  </button>
                ))
              )}
            </div>
            {/* Sort */}
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
              {(['latest', 'calories'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSortMode(mode)}
                  className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full transition-all ${
                    sortMode === mode
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {mode === 'latest' ? 'Latest' : 'Calories'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {ledgerEntries.length > 0 ? (
          <div className="space-y-3">
            {ledgerEntries.map((entry, idx) => {
              const isExpanded = expandedId === entry.id;
              const isBeingTimed = timingEditor?.entry.id === entry.id;
              const isDraggingThis = isBeingTimed && timingEditor?.isDragging;
              const showDropSlotAbove =
                timingEditor?.isDragging &&
                timingEditor.dropSlotIndex === idx &&
                timingEditor.entry.id !== entry.id;
              const showDropSlotBelow =
                timingEditor?.isDragging &&
                idx === ledgerEntries.length - 1 &&
                timingEditor.dropSlotIndex === ledgerEntries.length &&
                timingEditor.entry.id !== entry.id;

              const prevDate = idx > 0 ? ledgerEntries[idx - 1].date : null;
              const nextDate = idx < ledgerEntries.length - 1 ? ledgerEntries[idx + 1].date : null;
              const isFirstOfDate = prevDate !== entry.date;
              const isLastOfToday = entry.date === todayIso && nextDate !== todayIso;

              return (
                <React.Fragment key={entry.id}>
                  {/* Day Group Divider Header */}
                  {isFirstOfDate && sortMode === 'latest' && (
                    <div className="flex items-center gap-2 pt-2 pb-0.5 px-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                        {formatIsoDateLabel(entry.date, todayIso, yesterdayIso)}
                      </span>
                      <div className="h-px flex-1 bg-slate-200/70" />
                    </div>
                  )}

                  {/* Inline Drop Slot Indicator (when dragging across existing entries) */}
                  {showDropSlotAbove && timingEditor && (
                    <div className="rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-50/90 px-4 py-2.5 flex items-center justify-between text-xs font-black text-indigo-900 shadow-sm animate-in fade-in duration-150">
                      <span className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-indigo-600 animate-pulse" />
                        Drop &ldquo;{timingEditor.entry.name}&rdquo; here
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-600 text-white text-[11px]">
                        {formatIsoDateLabel(timingEditor.targetDate, todayIso, yesterdayIso)} · {formatHHMM12h(timingEditor.targetTime)}
                      </span>
                    </div>
                  )}

                  <div data-ledger-index={idx}>
                    <Card
                      className={`border-none shadow-md backdrop-blur-sm transition-all duration-200 cursor-pointer group ${
                        isDraggingThis
                          ? 'opacity-65 scale-[0.99] ring-2 ring-indigo-500 bg-indigo-50/50'
                          : isBeingTimed
                            ? 'ring-2 ring-indigo-500 bg-white shadow-lg'
                            : 'bg-white/70 ring-1 ring-primary/5 hover:bg-white hover:ring-primary/20'
                      }`}
                      onClick={() => toggleLedgerExpand(entry.id)}
                    >
                      <CardContent className="p-4 sm:p-5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3.5 sm:gap-5 min-w-0">
                            <div
                              className={`p-3 rounded-xl shadow-sm shrink-0 ${
                                entry.type === 'food'
                                  ? (entry.supplementBadges?.length ?? 0) > 0 && (entry.calories ?? 0) === 0
                                    ? 'bg-indigo-100'
                                    : 'bg-purple-100'
                                  : entry.type === 'fast'
                                    ? 'bg-teal-100'
                                    : 'bg-orange-100'
                              }`}
                            >
                              {entry.type === 'food' ? (
                                (entry.supplementBadges?.length ?? 0) > 0 && (entry.calories ?? 0) === 0 ? (
                                  <Pill className="w-5 h-5 text-indigo-600" />
                                ) : (
                                  <Briefcase className="w-5 h-5 text-accent" />
                                )
                              ) : entry.type === 'fast' ? (
                                <Timer className="w-5 h-5 text-teal-600" />
                              ) : (
                                <Dumbbell className="w-5 h-5 text-orange-600" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                {/* Draggable & Tappable Timestamp Handle Pill */}
                                <button
                                  type="button"
                                  onClick={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => handleStartTimingDrag(e, entry, idx)}
                                  title="Drag across entries or tap to open Day Timeline & move timing"
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs sm:text-sm font-black italic transition-all touch-none select-none cursor-grab active:cursor-grabbing ${
                                    isBeingTimed
                                      ? 'bg-indigo-600 text-white shadow-xs'
                                      : 'bg-slate-100/90 hover:bg-indigo-50 text-slate-900 hover:text-indigo-700 border border-slate-200/80'
                                  }`}
                                >
                                  <GripVertical className="w-3.5 h-3.5 opacity-60 shrink-0" />
                                  <span>{entry.displayTime}</span>
                                  <Clock className="w-3 h-3 opacity-60 shrink-0" />
                                </button>

                                <span
                                  className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-tighter ${
                                    entry.type === 'food'
                                      ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                      : entry.type === 'fast'
                                        ? 'bg-teal-50 text-teal-700 border border-teal-200'
                                        : 'bg-orange-50 text-orange-700 border border-orange-200'
                                  }`}
                                >
                                  {entry.type === 'fast' ? 'fast' : entry.type}
                                </span>

                                {/* Supplement Badges on Card Header */}
                                {entry.supplementBadges?.map((badge) => (
                                  <span
                                    key={badge}
                                    className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200"
                                  >
                                    {badge}
                                  </span>
                                ))}

                                {entry.cfoClass && CFO_CLASS_META[entry.cfoClass] && (
                                  <span className="font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-900 text-emerald-300 border border-emerald-500/40">
                                    {CFO_CLASS_META[entry.cfoClass].shortTag}
                                  </span>
                                )}

                                {entry.inferenceSource && (
                                  <ExecutionReceiptBadge
                                    compact
                                    inferenceSource={entry.inferenceSource}
                                    latencyMs={entry.inferenceLatencyMs}
                                  />
                                )}
                              </div>
                              <p
                                className={`text-sm text-muted-foreground font-medium group-hover:text-foreground transition-colors ${
                                  isExpanded ? '' : 'truncate max-w-[240px] sm:max-w-md'
                                }`}
                              >
                                {entry.detail}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <ChevronDown
                              className={`w-4 h-4 text-muted-foreground opacity-30 group-hover:opacity-100 transition-all shrink-0 ml-1 ${
                                isExpanded ? 'rotate-180' : ''
                              }`}
                            />
                          </div>
                        </div>

                        {/* Expanded Details */}
                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-muted/40 animate-in slide-in-from-top-1 fade-in duration-200">
                            {entry.type === 'food' && (
                              <div className="space-y-3">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                  <div className="bg-purple-50/80 rounded-xl p-3 text-center">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Calories</p>
                                    <p className="text-lg font-black text-purple-700">{entry.calories ?? '—'}</p>
                                  </div>
                                  <div className="bg-emerald-50/80 rounded-xl p-3 text-center">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Protein</p>
                                    <p className="text-lg font-black text-emerald-700">{entry.proteinG ?? '—'}g</p>
                                  </div>
                                  <div className="bg-amber-50/80 rounded-xl p-3 text-center">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Carbs</p>
                                    <p className="text-lg font-black text-amber-700">{entry.carbsG ?? '—'}g</p>
                                  </div>
                                  <div className="bg-rose-50/80 rounded-xl p-3 text-center">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Fat</p>
                                    <p className="text-lg font-black text-rose-700">{entry.fatG ?? '—'}g</p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2 text-[11px] font-medium text-muted-foreground">
                                  {entry.fiberG != null && <span className="bg-muted/40 px-2 py-0.5 rounded-full">Fiber: {entry.fiberG}g</span>}
                                  {entry.portionG != null && <span className="bg-muted/40 px-2 py-0.5 rounded-full">Portion: {entry.portionG}g</span>}
                                  {entry.meal && <span className="bg-muted/40 px-2 py-0.5 rounded-full capitalize">{entry.meal}</span>}
                                  {entry.source && <span className="bg-muted/40 px-2 py-0.5 rounded-full">Source: {entry.source.replace('_', ' ')}</span>}
                                  {(entry.alcoholDrinks ?? 0) > 0 && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{entry.alcoholDrinks} drink{entry.alcoholDrinks! > 1 ? 's' : ''}</span>}
                                  {entry.hasSeedOils && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Seed oils</span>}
                                  {entry.supplementBadges?.map((b) => (
                                    <span key={b} className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-bold">
                                      {b}
                                    </span>
                                  ))}
                                </div>
                                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                                  {entry.date === todayIso && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={savingTiming}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleApplyTimingUpdate(entry, yesterdayIso, '20:30', 'dinner', false);
                                      }}
                                      className="h-7 px-2.5 text-[10px] font-bold uppercase text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                                    >
                                      <Moon className="w-3 h-3 mr-1" />
                                      Move to Last Night
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTimingEditor({
                                        entry,
                                        targetDate: entry.date,
                                        targetTime: entry.rawTime,
                                        targetMeal:
                                          (entry.meal as 'breakfast' | 'lunch' | 'dinner' | 'snack' | undefined) ||
                                          inferMealFromTime(entry.rawTime),
                                        isDragging: false,
                                        dropSlotIndex: null,
                                      });
                                    }}
                                    className="h-7 px-2.5 text-[10px] font-bold uppercase text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                                  >
                                    <Clock className="w-3 h-3 mr-1" />
                                    Move Time / Day Timeline
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={removingId === entry.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveLedgerEntry(entry);
                                    }}
                                    className="h-7 px-2.5 text-[10px] font-bold uppercase text-red-600 hover:bg-red-50 hover:text-red-700"
                                  >
                                    {removingId === entry.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                    ) : (
                                      <Trash2 className="w-3 h-3 mr-1" />
                                    )}
                                    Remove Entry
                                  </Button>
                                  <ShareMealButton foodLogIds={[entry.id]} mealName={entry.name} />
                                </div>
                              </div>
                            )}

                            {entry.type === 'exercise' && (
                              <div className="space-y-3">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                  {entry.sets != null && (
                                    <div className="bg-orange-50/80 rounded-xl p-3 text-center">
                                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Sets</p>
                                      <p className="text-lg font-black text-orange-700">{entry.sets}</p>
                                    </div>
                                  )}
                                  {entry.reps != null && (
                                    <div className="bg-orange-50/80 rounded-xl p-3 text-center">
                                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Reps</p>
                                      <p className="text-lg font-black text-orange-700">{entry.reps}</p>
                                    </div>
                                  )}
                                  {entry.durationMin != null && (
                                    <div className="bg-blue-50/80 rounded-xl p-3 text-center">
                                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Duration</p>
                                      <p className="text-lg font-black text-blue-700">{entry.durationMin}m</p>
                                    </div>
                                  )}
                                  {entry.weightKg != null && (
                                    <div className="bg-slate-50/80 rounded-xl p-3 text-center">
                                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Weight</p>
                                      <p className="text-lg font-black text-slate-700">{entry.weightKg}kg</p>
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                                  <div className="flex flex-wrap gap-2">
                                    {entry.category && <span className="bg-muted/40 px-2 py-0.5 rounded-full capitalize">{entry.category}</span>}
                                    {entry.estimatedCaloriesBurned != null && <span className="bg-muted/40 px-2 py-0.5 rounded-full">~{entry.estimatedCaloriesBurned} cal burned</span>}
                                    {entry.pointsDelta != null && <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">+{entry.pointsDelta} pts</span>}
                                    {entry.notes && <span className="bg-muted/40 px-2 py-0.5 rounded-full">{entry.notes}</span>}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTimingEditor({
                                          entry,
                                          targetDate: entry.date,
                                          targetTime: entry.rawTime,
                                          targetMeal: inferMealFromTime(entry.rawTime),
                                          isDragging: false,
                                          dropSlotIndex: null,
                                        });
                                      }}
                                      className="h-7 px-2.5 text-[10px] font-bold uppercase text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                                    >
                                      <Clock className="w-3 h-3 mr-1" />
                                      Move Time
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      disabled={removingId === entry.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveLedgerEntry(entry);
                                      }}
                                      className="h-7 px-2.5 text-[10px] font-bold uppercase text-red-600 hover:bg-red-50 hover:text-red-700"
                                    >
                                      {removingId === entry.id ? (
                                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                      ) : (
                                        <Trash2 className="w-3 h-3 mr-1" />
                                      )}
                                      Remove Entry
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}

                            {entry.type === 'fast' && (
                              <div className="space-y-3">
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                  <div className="bg-teal-50/80 rounded-xl p-3 text-center">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Started</p>
                                    <p className="text-lg font-black text-teal-700">{entry.startedAt ?? '—'}</p>
                                  </div>
                                  <div className="bg-teal-50/80 rounded-xl p-3 text-center">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Ended</p>
                                    <p className="text-lg font-black text-teal-700">{entry.endedAt ?? 'Active'}</p>
                                  </div>
                                  {entry.durationHours != null && (
                                    <div className="bg-teal-50/80 rounded-xl p-3 text-center">
                                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Duration</p>
                                      <p className="text-lg font-black text-teal-700">{entry.durationHours.toFixed(1)}h</p>
                                    </div>
                                  )}
                                </div>
                                {entry.notes && (
                                  <p className="text-[11px] font-medium text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-full inline-block">{entry.notes}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Dedicated "Last Night (Yesterday)" Drop Zone right below Today's entries */}
                  {isLastOfToday && timingEditor && timingEditor.entry.date === todayIso && (
                    <div
                      data-ledger-last-night="true"
                      onClick={() =>
                        handleApplyTimingUpdate(
                          timingEditor.entry,
                          yesterdayIso,
                          '20:30',
                          'dinner',
                          false
                        )
                      }
                      className={`rounded-xl border-2 border-dashed px-4 py-3 flex items-center justify-between cursor-pointer transition-all ${
                        timingEditor.dropSlotIndex === -1 || timingEditor.targetDate === yesterdayIso
                          ? 'border-indigo-600 bg-indigo-100/90 text-indigo-950 shadow-md scale-[1.01]'
                          : 'border-indigo-300 bg-indigo-50/60 hover:bg-indigo-100/70 text-indigo-900'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 text-xs font-black">
                        <Moon className="w-4 h-4 text-indigo-600" />
                        <span>
                          Drop or Tap Here → Move &ldquo;{timingEditor.entry.name}&rdquo; to Last Night ({yesterdayIso})
                        </span>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-black uppercase">
                        Yesterday 8:30 PM
                      </span>
                    </div>
                  )}

                  {showDropSlotBelow && timingEditor && (
                    <div className="rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-50/90 px-4 py-2.5 flex items-center justify-between text-xs font-black text-indigo-900 shadow-sm animate-in fade-in duration-150">
                      <span className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-indigo-600 animate-pulse" />
                        Drop &ldquo;{timingEditor.entry.name}&rdquo; here
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-600 text-white text-[11px]">
                        {formatIsoDateLabel(timingEditor.targetDate, todayIso, yesterdayIso)} · {formatHHMM12h(timingEditor.targetTime)}
                      </span>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            {/* Load more — the ledger loads the most recent entries first; this pages further back. */}
            {((foodLogs?.length ?? 0) >= ledgerLimit || (exerciseLogs?.length ?? 0) >= ledgerLimit || fastLogs.length >= ledgerLimit) && (
              <button
                onClick={() => setLedgerLimit((l) => l + 50)}
                className="w-full py-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-all ring-1 ring-border"
              >
                Load older transactions
              </button>
            )}
          </div>
        ) : (
          <div className="p-20 text-center bg-white/50 rounded-3xl border-2 border-dashed border-muted space-y-6 flex flex-col items-center">
            <div className="p-5 bg-muted/20 rounded-full shadow-inner">
              <HistoryIcon className="w-12 h-12 text-muted-foreground/40" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-black text-muted-foreground uppercase tracking-[0.2em]">Audit Trail: Cold</p>
              <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                The transaction ledger is empty. Complete your Discovery Audit and start logging activities to see them analyzed here in your personal transaction stream.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Floating Interactive Day Timeline Popup (pops up when dragging across entries or tapping an entry's timestamp) */}
      {timingEditor && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[95vw] max-w-2xl rounded-2xl bg-slate-900/95 text-white border border-indigo-400/40 shadow-2xl backdrop-blur-md p-4 sm:p-5 space-y-3.5 animate-in slide-in-from-bottom-4 fade-in duration-200">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest">
                  {timingEditor.isDragging ? 'Dragging Across Ledger · Live Timeline' : 'Ledger Timeline Scrubber'}
                </span>
                <span className="text-xs font-bold text-indigo-300 truncate">
                  {timingEditor.entry.name}
                </span>
              </div>
              <p className="text-sm sm:text-base font-black text-white mt-1 flex flex-wrap items-center gap-2">
                <span>{formatIsoDateLabel(timingEditor.targetDate, todayIso, yesterdayIso)}</span>
                <span className="text-indigo-400">·</span>
                <span className="text-emerald-400">{formatHHMM12h(timingEditor.targetTime)}</span>
                {timingEditor.entry.type === 'food' && (
                  <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-black uppercase tracking-wider text-slate-200">
                    {timingEditor.targetMeal}
                  </span>
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setTimingEditor(null)}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors shrink-0"
              title="Close Timeline Popup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 1-Tap Quick Day/Time Presets (e.g. Last Night, Yesterday Dinner, Today) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={savingTiming}
              onClick={() =>
                handleApplyTimingUpdate(timingEditor.entry, yesterdayIso, '20:30', 'dinner', false)
              }
              className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1 ${
                timingEditor.targetDate === yesterdayIso && timingEditor.targetTime === '20:30'
                  ? 'bg-indigo-500 text-white shadow-sm'
                  : 'bg-white/10 hover:bg-white/20 text-indigo-200'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              Last Night (8:30 PM)
            </button>
            <button
              type="button"
              disabled={savingTiming}
              onClick={() =>
                handleApplyTimingUpdate(timingEditor.entry, yesterdayIso, '19:00', 'dinner', false)
              }
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                timingEditor.targetDate === yesterdayIso && timingEditor.targetTime === '19:00'
                  ? 'bg-indigo-500 text-white'
                  : 'bg-white/10 hover:bg-white/20 text-slate-200'
              }`}
            >
              Yesterday Dinner (7:00 PM)
            </button>
            <button
              type="button"
              disabled={savingTiming}
              onClick={() =>
                handleApplyTimingUpdate(timingEditor.entry, yesterdayIso, '12:30', 'lunch', false)
              }
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                timingEditor.targetDate === yesterdayIso && timingEditor.targetTime === '12:30'
                  ? 'bg-indigo-500 text-white'
                  : 'bg-white/10 hover:bg-white/20 text-slate-200'
              }`}
            >
              Yesterday Lunch (12:30 PM)
            </button>
            <button
              type="button"
              disabled={savingTiming}
              onClick={() =>
                setTimingEditor((prev) =>
                  prev ? { ...prev, targetDate: shiftIsoDate(prev.targetDate, -1) } : null
                )
              }
              className="px-2 py-1 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-slate-200 inline-flex items-center gap-0.5"
              title="Step back 1 day"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              -1d
            </button>
            <input
              type="date"
              value={timingEditor.targetDate}
              onChange={(e) => {
                if (!e.target.value) return;
                setTimingEditor((prev) => (prev ? { ...prev, targetDate: e.target.value } : null));
              }}
              className="h-7 px-2 rounded-lg bg-slate-800 border border-slate-700 text-xs font-bold text-white"
            />
            <button
              type="button"
              disabled={savingTiming}
              onClick={() =>
                setTimingEditor((prev) =>
                  prev ? { ...prev, targetDate: shiftIsoDate(prev.targetDate, 1) } : null
                )
              }
              className="px-2 py-1 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-slate-200 inline-flex items-center gap-0.5"
              title="Step forward 1 day"
            >
              +1d
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {timingEditor.targetDate !== todayIso && (
              <button
                type="button"
                onClick={() =>
                  setTimingEditor((prev) => (prev ? { ...prev, targetDate: todayIso } : null))
                }
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-emerald-300"
              >
                Today
              </button>
            )}
          </div>

          {/* Interactive 24-Hour Day Timeline Scrubber Track (with existing entries plotted as pins!) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 px-0.5">
              <span>6 AM</span>
              <span>9 AM</span>
              <span>12 PM</span>
              <span>3 PM</span>
              <span>6 PM</span>
              <span>9 PM</span>
              <span>11:45 PM</span>
            </div>

            <div
              ref={timelineTrackRef}
              onPointerDown={(e) => {
                e.stopPropagation();
                isScrubbingTimelineRef.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                updateTimeFromTrackClientX(e.clientX);
              }}
              onPointerMove={(e) => {
                if (!isScrubbingTimelineRef.current) return;
                updateTimeFromTrackClientX(e.clientX);
              }}
              onPointerUp={(e) => {
                if (!isScrubbingTimelineRef.current) return;
                isScrubbingTimelineRef.current = false;
                try {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                } catch {
                  // ignore
                }
              }}
              className="relative h-12 rounded-xl bg-slate-800/90 border border-slate-700 cursor-ew-resize touch-none select-none overflow-hidden px-2"
            >
              {/* Hour grid lines */}
              {[9, 12, 15, 18, 21].map((hr) => {
                const pct = ((hr * 60 - TIMELINE_MIN_START) / TIMELINE_SPAN) * 100;
                return (
                  <div
                    key={hr}
                    style={{ left: `${pct}%` }}
                    className="absolute top-0 bottom-0 w-px bg-white/10 pointer-events-none"
                  />
                );
              })}

              {/* Other entries already logged on targetDate plotted as pins */}
              {targetDayOtherEntries.map((other) => {
                const otherMin = hhmmToMinutes(other.rawTime, 12 * 60);
                const pct = Math.max(
                  2,
                  Math.min(98, ((otherMin - TIMELINE_MIN_START) / TIMELINE_SPAN) * 100)
                );
                return (
                  <div
                    key={other.id}
                    style={{ left: `${pct}%` }}
                    className="absolute top-1.5 -translate-x-1/2 flex flex-col items-center pointer-events-none"
                  >
                    <div className="w-2 h-2 rounded-full bg-slate-400 ring-2 ring-slate-900" />
                    <span className="mt-0.5 px-1 py-0.2 rounded bg-slate-900/90 text-[9px] font-bold text-slate-300 whitespace-nowrap max-w-[76px] truncate">
                      {other.name}
                    </span>
                  </div>
                );
              })}

              {/* Active draggable thumb for the entry being timed */}
              {(() => {
                const curMin = hhmmToMinutes(timingEditor.targetTime, 12 * 60);
                const pct = Math.max(
                  2,
                  Math.min(98, ((curMin - TIMELINE_MIN_START) / TIMELINE_SPAN) * 100)
                );
                return (
                  <div
                    style={{ left: `${pct}%` }}
                    className="absolute top-0 bottom-0 -translate-x-1/2 flex flex-col items-center justify-end pb-1 pointer-events-none"
                  >
                    <div className="w-0.5 h-full bg-emerald-400" />
                    <div className="px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-black shadow-md whitespace-nowrap">
                      {formatHHMM12h(timingEditor.targetTime)}
                    </div>
                  </div>
                );
              })()}
            </div>

            {targetDayOtherEntries.length > 0 && (
              <p className="text-[11px] text-slate-400 font-medium px-1 truncate">
                Existing on {timingEditor.targetDate}:{' '}
                {targetDayOtherEntries
                  .map((o) => `${formatHHMM12h(o.rawTime)} ${o.name}`)
                  .join(' · ')}
              </p>
            )}
          </div>

          {/* Fine-tune controls & Save button */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setTimingEditor((prev) => {
                    if (!prev) return null;
                    const nextTime = minutesToHHMM(hhmmToMinutes(prev.targetTime) - 30, 15);
                    return { ...prev, targetTime: nextTime, targetMeal: inferMealFromTime(nextTime) };
                  })
                }
                className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs font-bold text-slate-200"
              >
                -30m
              </button>
              <input
                type="time"
                value={timingEditor.targetTime}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setTimingEditor((prev) =>
                    prev
                      ? {
                          ...prev,
                          targetTime: e.target.value,
                          targetMeal: inferMealFromTime(e.target.value),
                        }
                      : null
                  );
                }}
                className="h-7 px-2 rounded bg-slate-800 border border-slate-700 text-xs font-bold text-white"
              />
              <button
                type="button"
                onClick={() =>
                  setTimingEditor((prev) => {
                    if (!prev) return null;
                    const nextTime = minutesToHHMM(hhmmToMinutes(prev.targetTime) + 30, 15);
                    return { ...prev, targetTime: nextTime, targetMeal: inferMealFromTime(nextTime) };
                  })
                }
                className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs font-bold text-slate-200"
              >
                +30m
              </button>

              {timingEditor.entry.type === 'food' && (
                <select
                  value={timingEditor.targetMeal}
                  onChange={(e) =>
                    setTimingEditor((prev) =>
                      prev
                        ? {
                            ...prev,
                            targetMeal: e.target.value as 'breakfast' | 'lunch' | 'dinner' | 'snack',
                          }
                        : null
                    )
                  }
                  className="h-7 px-2 rounded bg-slate-800 border border-slate-700 text-xs font-bold text-white capitalize"
                >
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                  <option value="snack">Snack</option>
                </select>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setTimingEditor(null)}
                className="h-8 px-3 text-xs font-bold text-slate-300 hover:text-white hover:bg-white/10"
              >
                Done
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={savingTiming}
                onClick={() =>
                  handleApplyTimingUpdate(
                    timingEditor.entry,
                    timingEditor.targetDate,
                    timingEditor.targetTime,
                    timingEditor.targetMeal,
                    true
                  )
                }
                className="h-8 px-3.5 text-xs font-black uppercase bg-emerald-500 hover:bg-emerald-600 text-slate-950"
              >
                {savingTiming ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                ) : (
                  <Check className="w-3.5 h-3.5 mr-1" />
                )}
                Save Timing
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Protein Liquidity — 30-day intake vs. minimum target */}
      <ProteinChart />

      {/* Daily Conversation Log — what was said with the CFO each day */}
      <ChatHistoryLog />

      {/* Shared Links — manage active and revoked share links */}
      <MySharesSection />

      {/* Day Detail Sheet */}
      <VFDayDetail entry={selectedEntry} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}
