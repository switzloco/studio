'use client';

import React from 'react';
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
import { BarChart3 } from 'lucide-react';
import type { HistoryEntry } from '@/lib/health-service';

interface VFScoreChartProps {
  history: HistoryEntry[];
  onDayClick?: (entry: HistoryEntry) => void;
}

export function VFScoreChart({ history, onDayClick }: VFScoreChartProps) {
  // Dedupe by date (keep last entry per date for daily score) and build chart data
  const byDate = new Map<string, HistoryEntry>();
  for (const entry of history) {
    const key = entry.isoDate || entry.date;
    byDate.set(key, entry);
  }

  const chartData = Array.from(byDate.values()).map((entry) => ({
    date: entry.date,
    score: entry.gain,
    equity: entry.equity,
    _entry: entry,
  }));

  if (chartData.length === 0) return null;

  return (
    <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
      <CardHeader className="p-6 pb-0">
        <CardTitle className="text-[12px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-3">
          <BarChart3 className="w-4 h-4" />
          VF Score & Cumulative Equity
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-4">
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
                label={{ value: 'VF Score', angle: -90, position: 'insideLeft', style: { fontSize: 10, fontWeight: 700, fill: '#6b7280' } }}
              />
              <YAxis
                yAxisId="equity"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10 }}
                label={{ value: 'Cumulative', angle: 90, position: 'insideRight', style: { fontSize: 10, fontWeight: 700, fill: '#6b7280' } }}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
                formatter={(value: number, name: string) => {
                  if (name === 'score') return [`${value > 0 ? '+' : ''}${value}`, 'Daily Score'];
                  return [value.toLocaleString(), 'Cumulative Equity'];
                }}
              />
              <ReferenceLine yAxisId="score" y={0} stroke="#94a3b8" strokeDasharray="3 3" />
              <Bar
                yAxisId="score"
                dataKey="score"
                radius={[2, 2, 0, 0]}
                cursor="pointer"
                maxBarSize={16}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.score >= 50 ? '#16a34a' : entry.score >= 0 ? '#6b9ede' : entry.score >= -50 ? '#f59e0b' : '#ef4444'}
                    opacity={0.85}
                  />
                ))}
              </Bar>
              <Line
                yAxisId="equity"
                type="monotone"
                dataKey="equity"
                stroke="#ef4444"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: '#ef4444' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] font-bold text-muted-foreground text-center mt-2 opacity-50">
          Click a bar to view the full scoring breakdown for that day
        </p>
      </CardContent>
    </Card>
  );
}
