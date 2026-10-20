'use client';

import React, { useState, useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3, Trophy } from 'lucide-react';
import type { HistoryEntry } from '@/lib/health-service';
import {
  computeDailyLevelPointsMap,
  computeLevelProgress,
  DEFAULT_ACTIVE_LEVEL,
  DEFAULT_LEVEL_HISTORY,
  type LevelConfig,
} from '@/lib/level-tracker';

interface VFScoreChartProps {
  history: HistoryEntry[];
  onDayClick?: (entry: HistoryEntry) => void;
  activeLevel?: LevelConfig;
  levelHistory?: LevelConfig[];
}

export function VFScoreChart({
  history,
  onDayClick,
  activeLevel = DEFAULT_ACTIVE_LEVEL,
  levelHistory = DEFAULT_LEVEL_HISTORY,
}: VFScoreChartProps) {
  const [scope, setScope] = useState<'level' | 'all'>('level');
  const [lineMetric, setLineMetric] = useState<'levelPoints' | 'equity'>('levelPoints');

  const levelPointsMap = useMemo(
    () => computeDailyLevelPointsMap(history, activeLevel, levelHistory),
    [history, activeLevel, levelHistory]
  );

  const levelProgress = useMemo(
    () => computeLevelProgress(activeLevel, history),
    [activeLevel, history]
  );

  // Dedupe by date (keep last entry per date for daily score) and build chart data
  const allChartData = useMemo(() => {
    const byDate = new Map<string, HistoryEntry>();
    for (const entry of history) {
      if (entry.detail === 'Account Created') continue;
      const key = entry.isoDate || entry.date;
      byDate.set(key, entry);
    }

    return Array.from(byDate.values()).map((entry) => {
      const isoKey = entry.isoDate || entry.date;
      const lvlInfo = levelPointsMap.get(isoKey);
      return {
        date: entry.date,
        isoDate: isoKey,
        score: entry.gain,
        equity: entry.equity,
        levelPoints: lvlInfo?.levelPoints ?? entry.gain,
        levelName: lvlInfo?.levelName ?? activeLevel.name,
        shortLabel: lvlInfo?.shortLabel ?? 'L3',
        targetPoints: lvlInfo?.targetPoints ?? activeLevel.targetPoints,
        isInActiveLevel: lvlInfo?.isInActiveLevel ?? false,
        _entry: entry,
      };
    });
  }, [history, levelPointsMap, activeLevel]);

  const activeLevelData = useMemo(
    () => allChartData.filter((d) => d.isInActiveLevel),
    [allChartData]
  );

  const chartData =
    scope === 'level' && activeLevelData.length > 0 ? activeLevelData : allChartData;

  if (allChartData.length === 0) return null;

  const activeLineKey = lineMetric === 'levelPoints' ? 'levelPoints' : 'equity';
  const activeLineColor = lineMetric === 'levelPoints' ? '#10b981' : '#ef4444';

  return (
    <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
      <CardHeader className="p-5 sm:p-6 pb-2 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-[12px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2.5">
            <BarChart3 className="w-4 h-4" />
            Daily VF Score & Level Tracking Trajectory
          </CardTitle>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Scope Toggle: Active Level vs All History */}
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
              <button
                type="button"
                onClick={() => setScope('level')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                  scope === 'level'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {activeLevel.name} ({activeLevelData.length}d)
              </button>
              <button
                type="button"
                onClick={() => setScope('all')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                  scope === 'all'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All History ({allChartData.length}d)
              </button>
            </div>

            {/* Cumulative Line Toggle: Level Points vs All-Time Equity */}
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
              <button
                type="button"
                onClick={() => setLineMetric('levelPoints')}
                className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                  lineMetric === 'levelPoints'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Level Pts Line
              </button>
              <button
                type="button"
                onClick={() => setLineMetric('equity')}
                className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                  lineMetric === 'equity'
                    ? 'bg-rose-100 text-rose-800 border border-rose-300'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All-Time Cumu
              </button>
            </div>
          </div>
        </div>

        {/* Active Level Sprint Progress Bar inside the Ledger Chart */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900 text-white px-3.5 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Trophy className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-black uppercase tracking-wider text-emerald-400">
              {activeLevel.name}
            </span>
            <span className="text-slate-300 font-semibold">
              (Started {activeLevel.startDate}
              {activeLevel.targetDate ? ` → Goal ${activeLevel.targetDate}` : ''})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-bold">
            <span>
              Level Total:{' '}
              <strong className="text-emerald-400 font-black">
                {levelProgress.totalPoints > 0 ? `+${levelProgress.totalPoints}` : levelProgress.totalPoints}
              </strong>{' '}
              / {levelProgress.targetPoints} pts ({levelProgress.progressPct}%)
            </span>
            <span className="text-amber-300">
              {levelProgress.pointsToTarget > 0
                ? `${levelProgress.pointsToTarget} pts to go`
                : 'Target Met ✓'}
            </span>
            <span className="text-slate-300">
              Pace: {levelProgress.pointsPerDay}/d (7d: {levelProgress.rolling7dPointsPerDay}/d)
              {levelProgress.requiredPointsPerDay !== null
                ? ` · Req: ${levelProgress.requiredPointsPerDay}/d`
                : ''}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-5 sm:p-6 pt-2">
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 20, right: 50, left: 0, bottom: 0 }}
              onClick={(state) => {
                if (state?.activePayload?.[0]?.payload?._entry && onDayClick) {
                  onDayClick(state.activePayload[0].payload._entry);
                }
              }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fontWeight: 700 }}
                dy={10}
                interval={Math.max(0, Math.floor(chartData.length / 10))}
              />
              <YAxis
                yAxisId="score"
                orientation="left"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10 }}
                domain={[-200, 120]}
                label={{
                  value: 'VF Score',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fontSize: 10, fontWeight: 700, fill: '#6b7280' },
                }}
              />
              <YAxis
                yAxisId="cumu"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10 }}
                label={{
                  value: lineMetric === 'levelPoints' ? 'Level Pts' : 'All-Time',
                  angle: 90,
                  position: 'insideRight',
                  style: { fontSize: 10, fontWeight: 700, fill: activeLineColor },
                }}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
                formatter={(value: number, name: string, item: any) => {
                  const payload = item?.payload;
                  if (name === 'score') {
                    return [`${value > 0 ? '+' : ''}${value} pts`, 'Daily VF Score'];
                  }
                  if (name === 'levelPoints') {
                    const target = payload?.targetPoints ?? activeLevel.targetPoints;
                    const lvlName = payload?.levelName ?? activeLevel.name;
                    return [
                      `${value > 0 ? '+' : ''}${value} / ${target} pts`,
                      `${lvlName} Cumulative`,
                    ];
                  }
                  return [value.toLocaleString(), 'All-Time Cumulative'];
                }}
              />
              <ReferenceLine yAxisId="score" y={0} stroke="#94a3b8" strokeDasharray="3 3" />
              {lineMetric === 'levelPoints' && scope === 'level' && (
                <ReferenceLine
                  yAxisId="cumu"
                  y={activeLevel.targetPoints}
                  stroke="#10b981"
                  strokeDasharray="4 4"
                  label={{
                    value: `Goal ${activeLevel.targetPoints}`,
                    position: 'right',
                    fill: '#059669',
                    fontSize: 10,
                    fontWeight: 800,
                  }}
                />
              )}
              <Bar
                yAxisId="score"
                dataKey="score"
                radius={[2, 2, 0, 0]}
                cursor="pointer"
                maxBarSize={18}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      entry.score >= 50
                        ? '#16a34a'
                        : entry.score >= 0
                          ? '#6b9ede'
                          : entry.score >= -50
                            ? '#f59e0b'
                            : '#ef4444'
                    }
                    opacity={0.85}
                  />
                ))}
              </Bar>
              <Line
                yAxisId="cumu"
                type="monotone"
                dataKey={activeLineKey}
                stroke={activeLineColor}
                strokeWidth={2.75}
                dot={scope === 'level' ? { r: 2.5, fill: activeLineColor } : false}
                activeDot={{ r: 5, fill: activeLineColor }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] font-bold text-muted-foreground text-center mt-2 opacity-60">
          Green line tracks cumulative Level points ({activeLevel.name} goal: {activeLevel.targetPoints} pts) · Click any bar to inspect day math
        </p>
      </CardContent>
    </Card>
  );
}
