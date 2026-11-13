'use client';

import React from 'react';
import { Cpu, Cloud, ShieldAlert, LockOpen, Sparkles } from 'lucide-react';
import {
  formatExecutionBadge,
  type NormalizedInferenceSource,
  type SecComplianceAlert,
} from '@/lib/hybrid-ai';
import { cn } from '@/lib/utils';

interface ExecutionReceiptBadgeProps {
  inferenceSource: NormalizedInferenceSource;
  latencyMs?: number;
  className?: string;
  compact?: boolean;
}

/**
 * Crisp Bloomberg / CRT monospace execution receipt badge rendered on EVERY
 * Hybrid AI response and parsed Audit Ledger entry.
 */
export function ExecutionReceiptBadge({
  inferenceSource,
  latencyMs = 120,
  className,
  compact = false,
}: ExecutionReceiptBadgeProps) {
  const isOnDevice = inferenceSource === 'ON_DEVICE';
  const badgeString = formatExecutionBadge(inferenceSource, latencyMs);

  return (
    <span
      data-testid={`exec-badge-${inferenceSource.toLowerCase()}`}
      className={cn(
        'inline-flex items-center gap-1.5 font-mono uppercase tracking-tight rounded border px-2 py-0.5 select-all transition-colors',
        compact ? 'text-[9px] leading-tight' : 'text-[10px] leading-snug',
        isOnDevice
          ? 'bg-slate-950 text-emerald-400 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.18)]'
          : 'bg-slate-950 text-amber-400 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.16)]',
        className
      )}
    >
      {isOnDevice ? (
        <Cpu className="w-3 h-3 shrink-0 text-emerald-400" />
      ) : (
        <Cloud className="w-3 h-3 shrink-0 text-amber-400" />
      )}
      <span className="font-semibold">{badgeString}</span>
    </span>
  );
}

interface SecComplianceAlertPanelProps {
  alert: SecComplianceAlert;
  onDisableLock?: () => void;
  onWarmNano?: () => void;
  className?: string;
}

/**
 * CRT SEC Insider Privacy Compliance Alert shown when `InferenceMode.ONLY_ON_DEVICE`
 * blocks cloud transmission because Chrome's Gemini Nano engine is not yet active.
 */
export function SecComplianceAlertPanel({
  alert,
  onDisableLock,
  onWarmNano,
  className,
}: SecComplianceAlertPanelProps) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-amber-500/60 bg-slate-950 p-3.5 text-amber-300 font-mono shadow-[0_0_24px_rgba(245,158,11,0.15)] space-y-2.5',
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 flex-1 min-w-0">
          <p className="text-[11px] font-bold tracking-wider uppercase text-amber-400">
            {alert.headline}
          </p>
          <p className="text-[11px] text-amber-200/90 leading-relaxed">
            {alert.summary}
          </p>
        </div>
      </div>

      <ol className="space-y-1 pl-5 list-decimal text-[10px] text-emerald-300/90 leading-relaxed">
        {alert.steps.map((step, idx) => (
          <li key={idx}>{step}</li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {onWarmNano && (
          <button
            type="button"
            onClick={onWarmNano}
            className="inline-flex items-center gap-1.5 rounded border border-emerald-500/60 bg-emerald-950/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-900/60 transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            Warm Local Nano Engine
          </button>
        )}
        {onDisableLock && (
          <button
            type="button"
            onClick={onDisableLock}
            className="inline-flex items-center gap-1.5 rounded border border-amber-500/60 bg-amber-950/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 hover:bg-amber-900/50 transition-colors"
          >
            <LockOpen className="w-3 h-3" />
            Switch to Hybrid Fallback (PREFER_ON_DEVICE)
          </button>
        )}
      </div>
    </div>
  );
}
