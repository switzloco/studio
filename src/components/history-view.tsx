'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Briefcase, TrendingUp, AlertCircle, History as HistoryIcon, Dumbbell, Timer, ChevronDown, ArrowUpDown } from "lucide-react";
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import { HealthData, HistoryEntry } from '@/lib/health-service';
import type { FoodLogEntry, ExerciseLogEntry, FastLogEntry } from '@/lib/food-exercise-types';
import { VFScoreChart } from './vf-score-chart';
import { VFHeatmap } from './vf-heatmap';
import { VFDayDetail } from './vf-day-detail';
import { LedgerChat } from './ledger-chat';

type SortMode = 'latest' | 'calories';

type LedgerEntry = {
  id: string;
  type: 'food' | 'exercise' | 'fast';
  name: string;
  detail: string;
  date: string;
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
};

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

  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('latest');

  // 1. Fetch High-Level Equity Summary (for the charts)
  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData, isLoading: isHealthLoading } = useDoc<HealthData>(userDocRef);

  // 2. Fetch structured food & exercise logs for the transaction ledger
  const foodQuery = useMemoFirebase(() => user ? query(
    collection(db, 'users', user.uid, 'food_log'),
    orderBy('timestamp', 'desc'),
    limit(20)
  ) : null, [db, user]);
  const { data: foodLogs, isLoading: isFoodLoading } = useCollection<FoodLogEntry>(foodQuery);

  const exerciseQuery = useMemoFirebase(() => user ? query(
    collection(db, 'users', user.uid, 'exercise_log'),
    orderBy('timestamp', 'desc'),
    limit(20)
  ) : null, [db, user]);
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
      limit(20),
    );
    getDocs(q)
      .then(snap => setFastLogs(snap.docs.map(d => ({ ...d.data(), id: d.id } as FastLogEntry)).filter(e => !e.ignored)))
      .catch(() => { /* collection missing or rules not yet deployed — show empty */ });
  }, [db, user]);

  // Merge, filter ignored, and sort
  const ledgerEntries = useMemo<LedgerEntry[]>(() => {
    const entries: LedgerEntry[] = [];

    if (foodLogs) {
      for (const f of foodLogs) {
        if (f.ignored) continue;
        entries.push({
          id: f.id,
          type: 'food',
          name: f.name,
          detail: `${f.name} (${f.portionG}g) — ${f.calories} cal, ${f.proteinG}g protein`,
          date: f.date,
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
        entries.push({
          id: e.id,
          type: 'exercise',
          name: e.name,
          detail: `${parts.join(' — ')} — +${e.pointsDelta} pts`,
          date: e.date,
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
        });
      }
    }

    if (fastLogs) {
      for (const f of fastLogs) {
        if (f.ignored) continue;
        const status = f.endedAt
          ? `${f.durationHours?.toFixed(1) ?? '?'}h fast — ${f.startedAt} → ${f.endedAt}`
          : `Active fast — started ${f.startedAt}`;
        entries.push({
          id: f.id ?? `fast-${f.date}-${f.startedAt}`,
          type: 'fast',
          name: f.endedAt ? `${f.durationHours?.toFixed(1) ?? '?'}h Fast` : 'Active Fast',
          detail: status + (f.notes ? ` (${f.notes})` : ''),
          date: f.date,
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

  const handleDayClick = (entry: HistoryEntry) => {
    setSelectedEntry(entry);
    setSheetOpen(true);
  };

  const toggleLedgerExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

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
    <div className="p-6 sm:p-10 space-y-10 pb-24 h-full overflow-y-auto bg-background">
      <div className="flex items-center justify-between px-1">
        <div className="space-y-2">
          <h2 className="text-3xl font-black tracking-tighter uppercase italic text-foreground">Portfolio History</h2>
          <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.3em]">Historical Asset Audit</p>
        </div>
        <div className="p-4 bg-emerald-100 rounded-2xl shadow-sm">
          <TrendingUp className="w-6 h-6 text-emerald-600" />
        </div>
      </div>

      {/* Ledger Analyst — inline query agent */}
      <LedgerChat />

      {/* VF Score Bar + Cumulative Line Chart */}
      {history.length > 0 ? (
        <VFScoreChart history={history} onDayClick={handleDayClick} />
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

      {/* Audit Log (Transactions) */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.2em] italic">Transaction Ledger</h3>
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

        {ledgerEntries.length > 0 ? (
          <div className="space-y-4">
            {ledgerEntries.map((entry) => {
              const isExpanded = expandedId === entry.id;
              return (
                <Card
                  key={entry.id}
                  className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:bg-white hover:ring-primary/20 transition-all duration-300 cursor-pointer group"
                  onClick={() => toggleLedgerExpand(entry.id)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-5 min-w-0">
                        <div className={`p-3 rounded-xl shadow-sm shrink-0 ${entry.type === 'food' ? 'bg-purple-100' : entry.type === 'fast' ? 'bg-teal-100' : 'bg-orange-100'}`}>
                          {entry.type === 'food'
                            ? <Briefcase className="w-5 h-5 text-accent" />
                            : entry.type === 'fast'
                            ? <Timer className="w-5 h-5 text-teal-600" />
                            : <Dumbbell className="w-5 h-5 text-orange-600" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <p className="text-sm font-black italic">
                              {entry.displayTime}
                            </p>
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-tighter ${entry.type === 'food' ? 'bg-purple-50 text-purple-700 border border-purple-200' : entry.type === 'fast' ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'bg-orange-50 text-orange-700 border border-orange-200'}`}>
                              {entry.type === 'fast' ? 'fast' : entry.type}
                            </span>
                          </div>
                          <p className={`text-sm text-muted-foreground font-medium group-hover:text-foreground transition-colors ${isExpanded ? '' : 'truncate max-w-[250px] sm:max-w-md'}`}>{entry.detail}</p>
                        </div>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-muted-foreground opacity-30 group-hover:opacity-100 transition-all shrink-0 ml-3 ${isExpanded ? 'rotate-180' : ''}`} />
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
                            <div className="flex flex-wrap gap-2 text-[11px] font-medium text-muted-foreground">
                              {entry.category && <span className="bg-muted/40 px-2 py-0.5 rounded-full capitalize">{entry.category}</span>}
                              {entry.estimatedCaloriesBurned != null && <span className="bg-muted/40 px-2 py-0.5 rounded-full">~{entry.estimatedCaloriesBurned} cal burned</span>}
                              {entry.pointsDelta != null && <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">+{entry.pointsDelta} pts</span>}
                              {entry.notes && <span className="bg-muted/40 px-2 py-0.5 rounded-full">{entry.notes}</span>}
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
              );
            })}
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

      {/* Day Detail Sheet */}
      <VFDayDetail entry={selectedEntry} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}
