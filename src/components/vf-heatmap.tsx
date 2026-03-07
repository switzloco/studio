'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarDays } from 'lucide-react';
import type { HistoryEntry } from '@/lib/health-service';

interface VFHeatmapProps {
  history: HistoryEntry[];
  onDayClick?: (entry: HistoryEntry) => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function scoreToColor(score: number): string {
  if (score >= 80) return '#15803d';   // dark green
  if (score >= 50) return '#22c55e';   // green
  if (score >= 20) return '#4ade80';   // light green
  if (score >= 0)  return '#bbf7d0';   // very light green
  if (score >= -25) return '#fed7aa';  // light orange
  if (score >= -50) return '#fdba74';  // orange
  if (score >= -100) return '#fb923c'; // dark orange
  return '#ef4444';                    // red
}

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getISODayOfWeek(d: Date): number {
  // Monday=0, Sunday=6
  return (d.getDay() + 6) % 7;
}

export function VFHeatmap({ history, onDayClick }: VFHeatmapProps) {
  // Build a map of isoDate -> entry (prefer last entry per date)
  const byDate = new Map<string, HistoryEntry>();
  for (const entry of history) {
    if (entry.isoDate) {
      byDate.set(entry.isoDate, entry);
    }
  }

  if (byDate.size === 0) return null;

  // Determine date range from the data
  const dates = Array.from(byDate.keys()).sort();
  const firstDate = new Date(dates[0] + 'T00:00:00');
  const lastDate = new Date(dates[dates.length - 1] + 'T00:00:00');

  // Build week columns
  const firstWeek = getISOWeek(firstDate);
  const lastWeek = getISOWeek(lastDate);

  // Handle year boundary: if lastWeek < firstWeek, the data spans a year boundary
  const weekCount = lastWeek >= firstWeek
    ? lastWeek - firstWeek + 1
    : (52 - firstWeek + 1) + lastWeek;

  const weeks = Array.from({ length: weekCount }, (_, i) => {
    const w = ((firstWeek - 1 + i) % 52) + 1;
    return w;
  });

  // Build grid: weekIndex -> dayOfWeek -> entry
  const grid: (HistoryEntry | null)[][] = weeks.map(() =>
    Array.from({ length: 7 }, () => null)
  );

  for (const [iso, entry] of byDate) {
    const d = new Date(iso + 'T00:00:00');
    const week = getISOWeek(d);
    const weekIdx = weeks.indexOf(week);
    if (weekIdx >= 0) {
      const dayIdx = getISODayOfWeek(d);
      grid[weekIdx][dayIdx] = entry;
    }
  }

  const cellSize = 28;
  const gap = 3;

  return (
    <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
      <CardHeader className="p-6 pb-0">
        <CardTitle className="text-[12px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-3">
          <CalendarDays className="w-4 h-4" />
          VF Score Calendar
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-4 overflow-x-auto">
        <div className="min-w-fit">
          {/* Week labels */}
          <div className="flex" style={{ marginLeft: 52 }}>
            {weeks.map((w, i) => (
              <div
                key={i}
                className="text-[10px] font-bold text-muted-foreground text-center"
                style={{ width: cellSize, marginRight: gap }}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Grid rows */}
          {DAY_LABELS.map((label, dayIdx) => (
            <div key={dayIdx} className="flex items-center" style={{ marginTop: gap }}>
              <div className="text-[10px] font-bold text-muted-foreground w-12 text-right pr-2 shrink-0">
                {label}
              </div>
              {weeks.map((_, weekIdx) => {
                const entry = grid[weekIdx]?.[dayIdx];
                return (
                  <div
                    key={weekIdx}
                    className={`rounded-sm ${entry ? 'cursor-pointer hover:ring-2 hover:ring-primary/40 transition-all' : ''}`}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      marginRight: gap,
                      backgroundColor: entry ? scoreToColor(entry.gain) : '#f3f4f6',
                    }}
                    title={entry ? `${entry.date}: ${entry.gain > 0 ? '+' : ''}${entry.gain} pts` : undefined}
                    onClick={() => entry && onDayClick?.(entry)}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 mt-4 justify-center">
          <span className="text-[10px] font-bold text-muted-foreground">-100</span>
          {['#ef4444', '#fb923c', '#fdba74', '#fed7aa', '#bbf7d0', '#4ade80', '#22c55e', '#15803d'].map((color) => (
            <div key={color} className="w-4 h-4 rounded-sm" style={{ backgroundColor: color }} />
          ))}
          <span className="text-[10px] font-bold text-muted-foreground">+100</span>
        </div>
      </CardContent>
    </Card>
  );
}
