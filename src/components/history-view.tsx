'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Briefcase, TrendingUp, AlertCircle, ArrowRight, History as HistoryIcon, Dumbbell, Timer } from "lucide-react";
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import { HealthData, HistoryEntry } from '@/lib/health-service';
import type { FoodLogEntry, ExerciseLogEntry, FastLogEntry } from '@/lib/food-exercise-types';
import { VFScoreChart } from './vf-score-chart';
import { VFHeatmap } from './vf-heatmap';
import { VFDayDetail } from './vf-day-detail';
import { LedgerChat } from './ledger-chat';

type LedgerEntry = {
  id: string;
  type: 'food' | 'exercise' | 'fast';
  name: string;
  detail: string;
  date: string;
  displayTime: string; // consumedAt/performedAt or fallback to timestamp
  timestamp: Timestamp | null;
  ignored?: boolean;
};

function formatDisplayTime(date: string, time?: string, ts?: unknown): string {
  if (time) {
    // Parse YYYY-MM-DD + HH:MM into a readable format
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);
    const d = new Date(year, month - 1, day, hours, minutes);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  // Fallback to Firestore timestamp
  if (ts instanceof Timestamp) {
    return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return 'Pending...';
}

function sortKey(entry: LedgerEntry): number {
  // Sort by date + displayTime descending. Use consumedAt/performedAt if available.
  if (entry.timestamp instanceof Timestamp) {
    return entry.timestamp.toMillis();
  }
  return 0;
}

export function HistoryView() {
  const { user } = useUser();
  const db = useFirestore();

  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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

  // Merge, filter ignored, and sort by most recent
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
          timestamp: f.timestamp instanceof Timestamp ? f.timestamp : null,
        });
      }
    }

    if (exerciseLogs) {
      for (const e of exerciseLogs) {
        if (e.ignored) continue;
        const parts = [e.name];
        if (e.durationMin) parts.push(`${e.durationMin} min`);
        if (e.sets && e.reps) parts.push(`${e.sets}x${e.reps}`);
        else if (e.reps) parts.push(`${e.reps} reps`);
        entries.push({
          id: e.id,
          type: 'exercise',
          name: e.name,
          detail: `${parts.join(' — ')} — +${e.pointsDelta} pts`,
          date: e.date,
          displayTime: formatDisplayTime(e.date, e.performedAt, e.timestamp),
          timestamp: e.timestamp instanceof Timestamp ? e.timestamp : null,
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
          timestamp: f.timestamp instanceof Timestamp ? f.timestamp : null,
        });
      }
    }

    entries.sort((a, b) => sortKey(b) - sortKey(a));
    return entries;
  }, [foodLogs, exerciseLogs, fastLogs]);

  const isLogsLoading = isFoodLoading || isExerciseLoading;

  const history = healthData?.history || [];

  const handleDayClick = (entry: HistoryEntry) => {
    setSelectedEntry(entry);
    setSheetOpen(true);
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
        <h3 className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.2em] px-1 italic">Transaction Ledger</h3>

        {ledgerEntries.length > 0 ? (
          <div className="space-y-4">
            {ledgerEntries.map((entry) => (
              <Card key={entry.id} className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:bg-white hover:ring-primary/20 transition-all duration-300">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-5">
                    <div className={`p-3 rounded-xl shadow-sm ${entry.type === 'food' ? 'bg-purple-100' : entry.type === 'fast' ? 'bg-teal-100' : 'bg-orange-100'}`}>
                      {entry.type === 'food'
                        ? <Briefcase className="w-5 h-5 text-accent" />
                        : entry.type === 'fast'
                        ? <Timer className="w-5 h-5 text-teal-600" />
                        : <Dumbbell className="w-5 h-5 text-orange-600" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <p className="text-sm font-black italic">
                          {entry.displayTime}
                        </p>
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-tighter ${entry.type === 'food' ? 'bg-purple-50 text-purple-700 border border-purple-200' : entry.type === 'fast' ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'bg-orange-50 text-orange-700 border border-orange-200'}`}>
                          {entry.type === 'fast' ? 'fast' : entry.type}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground font-medium truncate max-w-[250px] sm:max-w-md">{entry.detail}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground opacity-30" />
                </CardContent>
              </Card>
            ))}
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
