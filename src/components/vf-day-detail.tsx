'use client';

import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import type { HistoryEntry, VFBreakdown } from '@/lib/health-service';
import { Check, X, Minus, Moon, Flame, Wine, Droplets, Beef, Zap } from 'lucide-react';

interface VFDayDetailProps {
  entry: HistoryEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function RuleRow({
  icon,
  label,
  value,
  impact,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  impact: string;
  status: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-white ring-1 ring-primary/5">
      <div className={`p-2.5 rounded-xl shrink-0 ${status === 'positive' ? 'bg-emerald-100' : status === 'negative' ? 'bg-red-100' : 'bg-gray-100'}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm font-bold text-foreground">{value}</p>
      </div>
      <div className={`text-right shrink-0 ${status === 'positive' ? 'text-emerald-600' : status === 'negative' ? 'text-red-500' : 'text-gray-500'}`}>
        <p className="text-sm font-black">{impact}</p>
      </div>
    </div>
  );
}

export function VFDayDetail({ entry, open, onOpenChange }: VFDayDetailProps) {
  if (!entry) return null;

  const b = entry.breakdown;
  const hasBreakdown = !!b;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-2xl font-black italic tracking-tighter uppercase">
            {entry.date}
          </SheetTitle>
          <SheetDescription className="text-xs font-bold uppercase tracking-widest">
            {entry.isoDate || 'Daily Audit Report'}
          </SheetDescription>
        </SheetHeader>

        {/* Score hero */}
        <div className={`p-6 rounded-2xl text-center mb-6 ${entry.gain >= 50 ? 'bg-emerald-50 ring-1 ring-emerald-200' : entry.gain >= 0 ? 'bg-blue-50 ring-1 ring-blue-200' : 'bg-red-50 ring-1 ring-red-200'}`}>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Daily VF Score</p>
          <p className={`text-5xl font-black italic ${entry.gain >= 50 ? 'text-emerald-600' : entry.gain >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
            {entry.gain > 0 ? '+' : ''}{entry.gain}
          </p>
          <p className="text-sm font-bold text-muted-foreground mt-2">
            Cumulative Equity: <span className="text-foreground">{entry.equity.toLocaleString()} pts</span>
          </p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${entry.status === 'Bullish' ? 'bg-emerald-200 text-emerald-800' : entry.status === 'Correction' ? 'bg-red-200 text-red-800' : 'bg-gray-200 text-gray-800'}`}>
              {entry.status}
            </span>
          </div>
        </div>

        {hasBreakdown ? (
          <div className="space-y-3">
            {/* Alpert math — shown when new-format breakdown exists */}
            {b.alpertNumber != null && b.deficit != null ? (
              <div className="p-4 rounded-xl bg-slate-50 ring-1 ring-slate-200 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Alpert Score Math</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-bold text-foreground">{Math.abs(b.deficit).toLocaleString()} kcal {b.deficit >= 0 ? 'deficit' : 'surplus'}</span>
                  <span className="text-xs text-muted-foreground">÷ {b.alpertNumber.toLocaleString()} kcal Alpert max</span>
                  <span className="text-sm font-black text-foreground">= {entry.gain > 0 ? '+' : ''}{entry.gain} pts</span>
                </div>
                <div className="h-1.5 bg-slate-200 rounded-full">
                  {entry.gain > 0 && (
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, entry.gain)}%` }} />
                  )}
                </div>
              </div>
            ) : null}

            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground px-1 pt-2">Coaching Context</p>

            <RuleRow
              icon={<Flame className={`w-5 h-5 ${(b.caloriesOut - b.caloriesIn) > 0 ? 'text-emerald-600' : 'text-red-500'}`} />}
              label="Rule 1 — Caloric Engine"
              value={`${b.caloriesIn.toLocaleString()} in / ${b.caloriesOut.toLocaleString()} out (+${Math.abs(b.caloriesOut - b.caloriesIn).toLocaleString()} cal)`}
              impact={`${b.caloriesOut - b.caloriesIn > 0 ? '-' : '+'}${Math.abs(b.caloriesOut - b.caloriesIn).toLocaleString()} kcal`}
              status={(b.caloriesOut - b.caloriesIn) > 0 ? 'positive' : 'negative'}
            />

            <RuleRow
              icon={<Beef className={`w-5 h-5 ${(b.proteinMet ?? (b.proteinG >= b.proteinGoal)) ? 'text-emerald-600' : 'text-red-500'}`} />}
              label="Protein Mandate"
              value={`${b.proteinG}g / ${b.proteinGoal}g`}
              impact={(b.proteinMet ?? (b.proteinG >= b.proteinGoal)) ? 'Clean burn' : 'Muscle risk'}
              status={(b.proteinMet ?? (b.proteinG >= b.proteinGoal)) ? 'positive' : 'negative'}
            />

            <RuleRow
              icon={<Zap className={`w-5 h-5 ${(b.fastingActive ?? b.fastingOverride) ? 'text-emerald-600' : 'text-gray-400'}`} />}
              label="Rule 2 — Fasting Window"
              value={`${b.fastingHours}h fasted`}
              impact={(b.fastingActive ?? b.fastingOverride) ? 'Fat window open' : 'N/A'}
              status={(b.fastingActive ?? b.fastingOverride) ? 'positive' : 'neutral'}
            />

            <RuleRow
              icon={<Wine className={`w-5 h-5 ${b.alcoholDrinks > 2 ? 'text-red-500' : b.alcoholDrinks > 0 ? 'text-amber-500' : 'text-emerald-600'}`} />}
              label="Rule 3 — Alcohol Load"
              value={`${b.alcoholDrinks} drink${b.alcoholDrinks !== 1 ? 's' : ''}`}
              impact={b.alcoholDrinks > 2 ? 'Oxidation paused' : b.alcoholDrinks > 0 ? 'Partial load' : 'Clear'}
              status={b.alcoholDrinks > 2 ? 'negative' : b.alcoholDrinks > 0 ? 'negative' : 'positive'}
            />

            <RuleRow
              icon={<Moon className={`w-5 h-5 ${b.sleepHours < 6 ? 'text-red-500' : 'text-emerald-600'}`} />}
              label="Rule 4 — Cortisol Tax"
              value={`${b.sleepHours}h sleep`}
              impact={b.sleepHours < 6 ? 'Cortisol elevated' : 'No tax'}
              status={b.sleepHours < 6 ? 'negative' : 'positive'}
            />

            <RuleRow
              icon={<Droplets className={`w-5 h-5 ${b.seedOilMeals > 0 ? 'text-red-500' : 'text-emerald-600'}`} />}
              label="Rule 5 — Seed Oil Penalty"
              value={`${b.seedOilMeals} seed-oil meal${b.seedOilMeals !== 1 ? 's' : ''}`}
              impact={b.seedOilMeals > 0 ? 'Inflammation load' : 'Clean'}
              status={b.seedOilMeals > 0 ? 'negative' : 'positive'}
            />
          </div>
        ) : (
          <div className="p-8 text-center bg-muted/20 rounded-2xl border-2 border-dashed">
            <p className="text-[11px] font-black text-muted-foreground uppercase tracking-widest">No Detailed Breakdown Available</p>
            <p className="text-xs text-muted-foreground mt-2">
              This entry was recorded before the detailed scoring system. New entries will include a full breakdown.
            </p>
          </div>
        )}

        {/* Summary text */}
        <div className="mt-6 p-4 bg-muted/30 rounded-xl">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Audit Notes</p>
          <p className="text-sm text-foreground leading-relaxed">{entry.detail}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
