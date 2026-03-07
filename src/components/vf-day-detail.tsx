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
            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground px-1">5-Rule Breakdown</p>

            <RuleRow
              icon={<Flame className={`w-5 h-5 ${b.baseScore > 0 ? 'text-emerald-600' : b.baseScore < 0 ? 'text-red-500' : 'text-gray-500'}`} />}
              label="Rule 1 — Caloric Engine"
              value={`${b.caloriesIn.toLocaleString()} in / ${b.caloriesOut.toLocaleString()} out (${b.caloriesOut - b.caloriesIn > 0 ? '-' : '+'}${Math.abs(b.caloriesOut - b.caloriesIn).toLocaleString()} cal)`}
              impact={`${b.baseScore > 0 ? '+' : ''}${b.baseScore} base`}
              status={b.baseScore > 0 ? 'positive' : b.baseScore < 0 ? 'negative' : 'neutral'}
            />

            <RuleRow
              icon={<Beef className={`w-5 h-5 ${b.proteinMet ? 'text-emerald-600' : 'text-red-500'}`} />}
              label="Protein Mandate"
              value={`${b.proteinG}g / ${b.proteinGoal}g`}
              impact={b.proteinMet ? 'Met' : 'Capped at +50'}
              status={b.proteinMet ? 'positive' : 'negative'}
            />

            <RuleRow
              icon={<Zap className={`w-5 h-5 ${b.fastingOverride ? 'text-emerald-600' : 'text-gray-400'}`} />}
              label="Rule 2 — Fasting Multiplier"
              value={`${b.fastingHours}h fasted`}
              impact={b.fastingOverride ? 'Auto +100' : 'N/A'}
              status={b.fastingOverride ? 'positive' : 'neutral'}
            />

            <RuleRow
              icon={<Wine className={`w-5 h-5 ${b.alcoholCap ? 'text-red-500' : b.alcoholDrinks > 0 ? 'text-amber-500' : 'text-emerald-600'}`} />}
              label="Rule 3 — Alcohol Freeze"
              value={`${b.alcoholDrinks} drink${b.alcoholDrinks !== 1 ? 's' : ''}`}
              impact={b.alcoholCap ? `Capped${b.alcoholPenalty < 0 ? ` ${b.alcoholPenalty}` : ' at 0'}` : 'Clear'}
              status={b.alcoholCap ? 'negative' : 'positive'}
            />

            <RuleRow
              icon={<Moon className={`w-5 h-5 ${b.cortisolMultiplier < 1 ? 'text-red-500' : 'text-emerald-600'}`} />}
              label="Rule 4 — Cortisol Tax"
              value={`${b.sleepHours}h sleep`}
              impact={b.cortisolMultiplier < 1 ? '50% penalty' : 'No tax'}
              status={b.cortisolMultiplier < 1 ? 'negative' : 'positive'}
            />

            <RuleRow
              icon={<Droplets className={`w-5 h-5 ${b.seedOilPenalty < 0 ? 'text-red-500' : 'text-emerald-600'}`} />}
              label="Rule 5 — Seed Oil Penalty"
              value={`${b.seedOilMeals} seed-oil meal${b.seedOilMeals !== 1 ? 's' : ''}`}
              impact={b.seedOilPenalty < 0 ? `${b.seedOilPenalty} pts` : 'Clean'}
              status={b.seedOilPenalty < 0 ? 'negative' : 'positive'}
            />
          </div>
        ) : (
          <div className="p-8 text-center bg-muted/20 rounded-2xl border-2 border-dashed">
            <p className="text-[11px] font-black text-muted-foreground uppercase tracking-widest">No Detailed Breakdown Available</p>
            <p className="text-xs text-muted-foreground mt-2">
              This entry was recorded before the 5-rule scoring system. New entries will include a full breakdown.
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
