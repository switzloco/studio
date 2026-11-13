'use client';

import React from 'react';
import {
  Cpu,
  Lock,
  Unlock,
  Wifi,
  WifiOff,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useHybridAi } from '@/components/hybrid-ai-provider';
import { cn } from '@/lib/utils';

function buildCrtBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round(clamped / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

/**
 * Top-Bar Bloomberg / CRT "LOCAL AI ENGINE" Telemetry Widget.
 * Surfaces Chrome Built-in AI (`window.LanguageModel`) readiness, 1-click Nano warmup
 * with CRT progress bar, Offline Ledger indicator, SEC Insider Privacy Lock toggle,
 * and 30-Day Quarterly Earnings Call trigger.
 */
export function LocalAiTelemetryBar() {
  const {
    nanoStatus,
    isWarmingNano,
    nanoDownloadPct,
    warmNanoError,
    warmNano,
    isOnline,
    secPrivacyLock,
    setSecPrivacyLock,
    remoteConfig,
    setEarningsModalOpen,
  } = useHybridAi();

  const pct = nanoDownloadPct ?? 0;

  return (
    <div className="w-full bg-slate-950 border-b border-emerald-500/30 px-2.5 md:px-6 py-1 md:py-1.5 font-mono text-[9.5px] md:text-[10px] text-emerald-400 select-none shrink-0">
      <div className="flex items-center justify-between gap-1.5 whitespace-nowrap overflow-x-auto no-scrollbar">
        {/* Left: Local AI Engine Status + 1-Click Warmup */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-500/30">
            <span
              className={cn(
                'w-1.5 h-1.5 md:w-2 md:h-2 rounded-full shrink-0',
                nanoStatus === 'available'
                  ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                  : isWarmingNano || nanoStatus === 'downloading'
                    ? 'bg-amber-400 animate-pulse'
                    : nanoStatus === 'downloadable'
                      ? 'bg-amber-400'
                      : 'bg-emerald-400/70 sm:bg-slate-500'
              )}
            />
            <Cpu className="w-3 h-3 text-emerald-400 shrink-0 hidden sm:inline" />
            {isWarmingNano || nanoStatus === 'downloading' ? (
              <>
                <span className="sm:hidden text-amber-300 font-bold tracking-wider">
                  NANO {pct}%
                </span>
                <span className="hidden sm:inline text-amber-300 font-bold tracking-wider">
                  DOWNLOADING NANO: {pct}% [{buildCrtBar(pct)}]
                </span>
              </>
            ) : nanoStatus === 'available' ? (
              <>
                <span className="sm:hidden text-emerald-300 font-bold tracking-wider">
                  NANO · $0 GAS
                </span>
                <span className="hidden sm:inline text-emerald-300 font-bold tracking-wider">
                  NANO ENGINE: ONLINE // $0.00 GAS
                </span>
              </>
            ) : nanoStatus === 'downloadable' ? (
              <>
                <span className="sm:hidden text-amber-300 font-bold tracking-wider">
                  NANO READY
                </span>
                <span className="hidden sm:inline text-amber-300 font-bold tracking-wider">
                  NANO ENGINE: READY TO WARM
                </span>
              </>
            ) : (
              <>
                <span className="sm:hidden text-amber-300/90 font-semibold tracking-wider">
                  CLOUD HYBRID
                </span>
                <span className="hidden sm:inline text-amber-300/90 font-semibold tracking-wider">
                  LOCAL AI: CLOUD HYBRID ({remoteConfig.cfoCloudModel})
                </span>
              </>
            )}
          </div>

          {nanoStatus !== 'available' && !isWarmingNano && (
            <button
              type="button"
              onClick={warmNano}
              data-testid="warm-local-nano-btn"
              className={cn(
                'items-center gap-1 rounded border border-emerald-400/60 bg-emerald-500/15 hover:bg-emerald-500/25 px-2 py-0.5 text-[9.5px] md:text-[10px] font-bold uppercase tracking-wider text-emerald-300 transition-colors',
                nanoStatus === 'downloadable' ? 'inline-flex' : 'hidden sm:inline-flex'
              )}
              title="Download and warm Chrome's built-in Gemini Nano model for zero-latency offline inference"
            >
              <Zap className="w-3 h-3 text-emerald-400" />
              <span className="hidden md:inline">WARM LOCAL NANO ENGINE</span>
              <span className="md:hidden">WARM NANO</span>
            </button>
          )}
        </div>

        {/* Right: Network Telemetry + SEC Privacy Lock + 30D Earnings Call */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 sm:px-2 py-0.5 border font-bold uppercase tracking-wider',
              isOnline
                ? 'border-emerald-500/30 bg-slate-900 text-emerald-400/90'
                : 'border-amber-400/70 bg-amber-950/60 text-amber-300 animate-pulse'
            )}
            title={isOnline ? 'Network Online' : 'Browser Offline — Local IndexedDB Ledger Active'}
          >
            {isOnline ? (
              <>
                <Wifi className="w-3 h-3" />
                <span className="hidden sm:inline">NET: ONLINE</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" />
                <span className="sm:hidden">OFFLINE</span>
                <span className="hidden sm:inline">NET: OFFLINE // LOCAL LEDGER</span>
              </>
            )}
          </span>

          <button
            type="button"
            onClick={() => setSecPrivacyLock(!secPrivacyLock)}
            data-testid="sec-privacy-lock-toggle"
            aria-pressed={secPrivacyLock}
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 sm:px-2 py-0.5 border font-bold uppercase tracking-wider transition-all',
              secPrivacyLock
                ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.28)]'
                : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300'
            )}
            title="Toggle SEC Insider Privacy Lock (InferenceMode.ONLY_ON_DEVICE)"
          >
            {secPrivacyLock ? (
              <>
                <Lock className="w-3 h-3 text-emerald-300" />
                <span className="sm:hidden">SEC: ON</span>
                <span className="hidden sm:inline">SEC PRIVACY LOCK: ON</span>
              </>
            ) : (
              <>
                <Unlock className="w-3 h-3 text-amber-400" />
                <span className="sm:hidden">SEC: OFF</span>
                <span className="hidden sm:inline">SEC PRIVACY LOCK: OFF</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setEarningsModalOpen(true)}
            data-testid="header-earnings-call-btn"
            className="inline-flex items-center gap-1 rounded px-1.5 sm:px-2 py-0.5 border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-bold uppercase tracking-wider transition-colors"
            title="Run 30-Day Portfolio Earnings Call (InferenceMode.PREFER_IN_CLOUD)"
          >
            <TrendingUp className="w-3 h-3 text-amber-400" />
            <span className="hidden sm:inline">30D EARNINGS CALL</span>
            <span className="sm:hidden">30D</span>
          </button>
        </div>
      </div>

      {warmNanoError && (
        <div className="mt-1 flex items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-[9.5px] text-amber-300">
          <span className="truncate">{warmNanoError}</span>
        </div>
      )}
    </div>
  );
}
