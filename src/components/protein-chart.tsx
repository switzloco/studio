'use client';

import React, { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Beef } from 'lucide-react';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import type { UserPreferences } from '@/lib/health-service';
import type { FoodLogEntry } from '@/lib/food-exercise-types';

const WINDOW_DAYS = 30;
const DEFAULT_PROTEIN_GOAL = 150;

/** Format "YYYY-MM-DD" as a short "Mon D" label for the x-axis. */
function shortLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ProteinChart() {
  const { user } = useUser();
  const db = useFirestore();

  // Protein goal lives in preferences/settings → targets.proteinGoal (default 150).
  const prefsRef = useMemoFirebase(
    () => (user ? doc(db, 'users', user.uid, 'preferences', 'settings') : null),
    [db, user],
  );
  const { data: prefs } = useDoc<UserPreferences>(prefsRef);
  const proteinGoal = prefs?.targets?.proteinGoal ?? DEFAULT_PROTEIN_GOAL;

  // Cutoff = start of the window, as "YYYY-MM-DD". ISO date strings sort
  // lexicographically, so a string >= comparison gives us the last 30 days.
  const cutoffDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - (WINDOW_DAYS - 1));
    return d.toISOString().slice(0, 10);
  }, []);

  const foodQuery = useMemoFirebase(
    () =>
      user
        ? query(
            collection(db, 'users', user.uid, 'food_log'),
            where('date', '>=', cutoffDate),
          )
        : null,
    [db, user, cutoffDate],
  );
  const { data: foodLogs } = useCollection<FoodLogEntry>(foodQuery);

  // Aggregate protein by day (ignoring soft-deleted entries).
  const { chartData, daysHittingMin, loggedDays, avgProtein } = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const f of foodLogs ?? []) {
      if (f.ignored) continue;
      byDate.set(f.date, (byDate.get(f.date) ?? 0) + (f.proteinG ?? 0));
    }

    const chartData = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, protein]) => ({
        date,
        label: shortLabel(date),
        protein: Math.round(protein),
      }));

    const loggedDays = chartData.length;
    const daysHittingMin = chartData.filter((d) => d.protein >= proteinGoal).length;
    const totalProtein = chartData.reduce((sum, d) => sum + d.protein, 0);
    const avgProtein = loggedDays > 0 ? Math.round(totalProtein / loggedDays) : 0;

    return { chartData, daysHittingMin, loggedDays, avgProtein };
  }, [foodLogs, proteinGoal]);

  if (loggedDays === 0) {
    return (
      <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
        <CardHeader className="p-6 pb-0">
          <CardTitle className="text-[12px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-3">
            <Beef className="w-4 h-4" />
            Protein Liquidity · Last {WINDOW_DAYS} Days
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="h-48 flex flex-col items-center justify-center text-center gap-2 bg-muted/20 rounded-2xl border-2 border-dashed">
            <Beef className="w-10 h-10 text-muted-foreground opacity-30" />
            <p className="text-xs text-muted-foreground italic px-6 max-w-sm">
              No protein deposits logged in the last {WINDOW_DAYS} days. Log a meal to start tracking.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hitRate = Math.round((daysHittingMin / loggedDays) * 100);

  return (
    <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
      <CardHeader className="p-6 pb-0">
        <CardTitle className="text-[12px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-3">
          <Beef className="w-4 h-4" />
          Protein Liquidity · Last {WINDOW_DAYS} Days
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-4 space-y-5">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-emerald-50/80 rounded-xl p-3 text-center">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Days Hit Min</p>
            <p className="text-lg font-black text-emerald-700">
              {daysHittingMin}<span className="text-sm text-muted-foreground font-bold">/{loggedDays}</span>
            </p>
            <p className="text-[10px] font-bold text-muted-foreground">{hitRate}%</p>
          </div>
          <div className="bg-purple-50/80 rounded-xl p-3 text-center">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Avg Protein</p>
            <p className="text-lg font-black text-purple-700">{avgProtein}<span className="text-sm font-bold">g</span></p>
            <p className="text-[10px] font-bold text-muted-foreground">/ day</p>
          </div>
          <div className="bg-slate-50/80 rounded-xl p-3 text-center">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Min Target</p>
            <p className="text-lg font-black text-slate-700">{proteinGoal}<span className="text-sm font-bold">g</span></p>
            <p className="text-[10px] font-bold text-muted-foreground">/ day</p>
          </div>
        </div>

        {/* Daily protein bars vs. goal line */}
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fontWeight: 700 }}
                dy={10}
                interval={Math.max(0, Math.floor(chartData.length / 10))}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10 }}
                label={{ value: 'Protein (g)', angle: -90, position: 'insideLeft', style: { fontSize: 10, fontWeight: 700, fill: '#6b7280' } }}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
                formatter={(value: number) => [`${value}g`, 'Protein']}
              />
              <ReferenceLine
                y={proteinGoal}
                stroke="#16a34a"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{ value: `Min ${proteinGoal}g`, position: 'right', style: { fontSize: 9, fontWeight: 700, fill: '#16a34a' } }}
              />
              <Bar dataKey="protein" radius={[2, 2, 0, 0]} maxBarSize={20}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.protein >= proteinGoal ? '#16a34a' : '#f59e0b'}
                    opacity={0.85}
                  />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] font-bold text-muted-foreground text-center mt-2 opacity-50">
          Green bars cleared your protein minimum · amber fell short
        </p>
      </CardContent>
    </Card>
  );
}
