'use client';

import React, { useState } from 'react';
import { doc } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Loader2,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useFirebaseApp,
  useFirestore,
  useUser,
  useDoc,
  useMemoFirebase,
} from '@/firebase';
import { useHybridAi } from '@/components/hybrid-ai-provider';
import {
  ExecutionReceiptBadge,
  SecComplianceAlertPanel,
} from '@/components/execution-receipt-badge';
import {
  runQuarterlyEarningsCallHybrid,
  SecPrivacyLockBlockedError,
  type QuarterlyEarningsCallResult,
  type SecComplianceAlert,
} from '@/lib/hybrid-ai';
import {
  healthService,
  type HealthData,
  type UserPreferences,
} from '@/lib/health-service';
import { cn } from '@/lib/utils';

function ratingBadgeStyle(
  rating: QuarterlyEarningsCallResult['marketRating']
): string {
  switch (rating) {
    case 'STRONG_BUY':
      return 'border-emerald-400 bg-emerald-500/20 text-emerald-300';
    case 'OUTPERFORM':
      return 'border-cyan-400 bg-cyan-500/20 text-cyan-300';
    case 'HOLD':
      return 'border-amber-400 bg-amber-500/20 text-amber-300';
    case 'UNDERPERFORM':
    case 'MARGIN_CALL':
      return 'border-rose-400 bg-rose-500/20 text-rose-300';
  }
}

/**
 * Feature D — "Quarterly Earnings Call" Deep Portfolio Forecast Modal (`InferenceMode.PREFER_IN_CLOUD`).
 * Intentionally routes upward to Cloud Gemini (configured dynamically via Firebase Remote Config)
 * for multi-week Audit Ledger synthesis while falling back to on-device Gemini Nano if offline.
 */
export function QuarterlyEarningsModal() {
  const firebaseApp = useFirebaseApp();
  const db = useFirestore();
  const { user } = useUser();
  const {
    earningsModalOpen,
    setEarningsModalOpen,
    secPrivacyLock,
    setSecPrivacyLock,
    warmNano,
    remoteConfig,
    recordReceipt,
    isOnline,
  } = useHybridAi();

  const userDocRef = useMemoFirebase(
    () => (user ? doc(db, 'users', user.uid) : null),
    [db, user]
  );
  const { data: healthData } = useDoc<HealthData>(userDocRef);

  const prefsDocRef = useMemoFirebase(
    () => (user ? doc(db, 'users', user.uid, 'preferences', 'settings') : null),
    [db, user]
  );
  const { data: preferences } = useDoc<UserPreferences>(prefsDocRef);

  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<QuarterlyEarningsCallResult | null>(null);
  const [complianceAlert, setComplianceAlert] = useState<SecComplianceAlert | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Triggered strictly inside user button click handler
  const handleRunEarningsCall = async () => {
    if (!user) return;
    setIsRunning(true);
    setErrorText(null);
    setComplianceAlert(null);

    try {
      const [recentFoodLogs, recentExerciseLogs] = await Promise.all([
        healthService.queryFoodLog(db, user.uid, undefined, 25).catch(() => []),
        healthService.queryExerciseLog(db, user.uid, undefined, 15).catch(() => []),
      ]);

      const result = await runQuarterlyEarningsCallHybrid({
        firebaseApp,
        healthData,
        preferences,
        recentFoodLogs,
        recentExerciseLogs,
        secPrivacyLock,
      });
      setReport(result);
      recordReceipt(result.receipt);
    } catch (err) {
      if (err instanceof SecPrivacyLockBlockedError) {
        setComplianceAlert(err.alert);
      } else {
        setErrorText(
          err instanceof Error
            ? err.message
            : 'Unable to synthesize 30-day portfolio forecast right now.'
        );
      }
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Dialog open={earningsModalOpen} onOpenChange={setEarningsModalOpen}>
      <DialogContent className="max-w-2xl bg-slate-950 border-emerald-500/40 text-emerald-200 font-mono p-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="border-b border-emerald-500/25 bg-slate-900 px-5 py-4 space-y-1 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
            <DialogTitle className="text-sm font-black uppercase tracking-widest text-emerald-300 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-amber-400" />
              30-DAY METABOLIC EARNINGS CALL // PORTFOLIO FORECAST
            </DialogTitle>
            <span className="rounded border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-300">
              ROUTE: {secPrivacyLock ? 'ONLY_ON_DEVICE' : `PREFER_IN_CLOUD (${remoteConfig.cfoCloudModel})`}
            </span>
          </div>
          <DialogDescription className="text-[11px] text-emerald-400/80 font-mono">
            Synthesizes your multi-week Audit Ledger, Equity Score trajectory, Alpert fat-oxidation ceiling, and metabolic break-even run-rate.
            {!isOnline && ' (Browser Offline: automatic on-device Gemini Nano fallback armed.)'}
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 overflow-y-auto space-y-4">
          {!report && !isRunning && !complianceAlert && (
            <div className="rounded-xl border border-emerald-500/30 bg-slate-900/70 p-5 text-center space-y-3">
              <TrendingUp className="w-8 h-8 text-amber-400 mx-auto" />
              <p className="text-xs text-emerald-100 font-bold uppercase tracking-wider">
                Ready to Convene 30-Day Portfolio Audit
              </p>
              <p className="text-[11px] text-emerald-300/80 max-w-md mx-auto leading-relaxed">
                Uses <code className="text-amber-300">InferenceMode.PREFER_IN_CLOUD</code> via{' '}
                <code className="text-amber-300">{remoteConfig.cfoCloudModel}</code> for deep multi-week ledger reasoning, with automatic downward fallback to Chrome Gemini Nano when offline.
              </p>
              <button
                type="button"
                onClick={handleRunEarningsCall}
                data-testid="execute-earnings-call-btn"
                className="inline-flex items-center gap-2 rounded-lg border border-amber-400 bg-amber-400 text-slate-950 hover:bg-amber-300 px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors"
              >
                <BarChart3 className="w-4 h-4" />
                RUN 30-DAY EARNINGS CALL
              </button>
            </div>
          )}

          {isRunning && (
            <div className="rounded-xl border border-emerald-500/30 bg-slate-900/60 p-8 flex flex-col items-center justify-center space-y-3">
              <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
              <p className="text-xs font-bold uppercase tracking-widest text-amber-300">
                Auditing Multi-Week Ledger &amp; Equity Trajectory...
              </p>
            </div>
          )}

          {complianceAlert && (
            <SecComplianceAlertPanel
              alert={complianceAlert}
              onWarmNano={warmNano}
              onDisableLock={() => {
                setSecPrivacyLock(false);
                setComplianceAlert(null);
              }}
            />
          )}

          {errorText && (
            <div className="rounded border border-rose-500/50 bg-rose-950/50 px-3.5 py-2.5 text-xs text-rose-300">
              [EARNINGS CALL ERROR] {errorText}
            </div>
          )}

          {report && (
            <div data-testid="earnings-call-report" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ExecutionReceiptBadge
                  inferenceSource={report.receipt.inferenceSource}
                  latencyMs={report.receipt.latencyMs}
                />
                <span
                  className={cn(
                    'rounded border px-2.5 py-0.5 text-[11px] font-black uppercase tracking-widest',
                    ratingBadgeStyle(report.marketRating)
                  )}
                >
                  RATING: {report.marketRating.replace('_', ' ')}
                </span>
              </div>

              <div className="rounded-xl border border-emerald-500/30 bg-slate-900/90 p-4 space-y-2">
                <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wide">
                  {report.headline}
                </h3>
                <p className="text-xs text-emerald-100/95 leading-relaxed">
                  {report.executiveSummary}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-emerald-500/30 bg-black/60 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-500">
                    30-Day Equity Trajectory
                  </p>
                  <p className="text-lg font-black text-emerald-300 mt-0.5">
                    {report.projected30dEquityDelta >= 0 ? '+' : ''}
                    {report.projected30dEquityDelta} VF PTS
                  </p>
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-black/60 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-amber-500">
                    Metabolic Break-Even Ceiling
                  </p>
                  <p className="text-lg font-black text-amber-300 mt-0.5">
                    {report.metabolicBreakEvenKcal.toLocaleString()} kcal / day
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-emerald-500/25 bg-slate-900/70 p-3.5 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  Capital Allocation Directives (Next 30 Days)
                </p>
                <ul className="space-y-1.5 text-xs text-emerald-100">
                  {report.capitalDirectives.map((d, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">0{i + 1}.</span>
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-rose-500/25 bg-rose-950/20 p-3.5 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-rose-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  Balance-Sheet Liability Risks
                </p>
                <ul className="space-y-1 text-xs text-rose-200/90">
                  {report.liabilityRisks.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleRunEarningsCall}
                  disabled={isRunning}
                  className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-950/50 hover:bg-emerald-900/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300"
                >
                  <RefreshCw className="w-3 h-3" />
                  Re-Run Forecast
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
