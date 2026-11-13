'use client';

import React, { useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  CornerDownLeft,
  Dumbbell,
  Loader2,
  Receipt,
  ShieldCheck,
  Terminal,
  Utensils,
  X,
} from 'lucide-react';
import { useFirebaseApp, useFirestore, useUser } from '@/firebase';
import { useHybridAi } from '@/components/hybrid-ai-provider';
import {
  ExecutionReceiptBadge,
  SecComplianceAlertPanel,
} from '@/components/execution-receipt-badge';
import {
  auditMealPhotoReceiptHybrid,
  normalizeImageFileForHybrid,
  parseTickerTapeHybrid,
  SecPrivacyLockBlockedError,
  type ExpenseReceiptAuditResult,
  type HybridExecutionReceipt,
  type NormalizedInlineImage,
  type SecComplianceAlert,
  type TickerTapeParseResult,
} from '@/lib/hybrid-ai';
import {
  CFO_CLASS_META,
  type CfoLedgerClass,
  type ReconciledFoodDraft,
  type ReconciledWorkoutDraft,
} from '@/lib/usda-local-reconciler';
import { healthService, type HealthData } from '@/lib/health-service';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface HybridTickerTerminalProps {
  healthData?: HealthData | null;
  targetDateIso?: string;
  compact?: boolean;
  onCommitted?: () => void;
  className?: string;
}

const QUICK_SHORTHAND_EXAMPLES = [
  '3 eggs, 1 cup oats, black coffee, and 35 min heavy squats',
  '200g wild salmon, 1 cup white rice, 150g broccoli',
  '2 scoops whey protein, 5g creatine, 25 min zone 2 cycling',
];

function cfoClassBadgeStyles(cfoClass: CfoLedgerClass): string {
  switch (cfoClass) {
    case 'CAPITAL_ASSET_INFLOW':
      return 'border-emerald-500/50 bg-emerald-950/60 text-emerald-300';
    case 'LIABILITY_EXPOSURE':
      return 'border-rose-500/60 bg-rose-950/60 text-rose-300';
    case 'CAPITAL_CAPEX':
      return 'border-cyan-500/50 bg-cyan-950/60 text-cyan-300';
    case 'OPERATING_FUEL':
    default:
      return 'border-amber-500/40 bg-amber-950/40 text-amber-300';
  }
}

/**
 * Bloomberg / CRT Hybrid Command Bar implementing:
 * - Feature A: Instant Natural-Language "Ticker Tape" Macro & Workout Parser (`PREFER_ON_DEVICE`)
 * - Feature B: Multimodal "Expense Receipt" Meal & Nutrition Label Auditor (`PREFER_ON_DEVICE`)
 * - Feature C: Automatic `ONLY_ON_DEVICE` enforcement + CRT compliance alert when `SEC PRIVACY LOCK` is ON
 * - 1-click Offline-First Audit Ledger Commit (`persistentLocalCache`)
 */
export function HybridTickerTerminal({
  healthData,
  targetDateIso,
  compact = false,
  onCommitted,
  className,
}: HybridTickerTerminalProps) {
  const firebaseApp = useFirebaseApp();
  const db = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const {
    secPrivacyLock,
    setSecPrivacyLock,
    warmNano,
    recordReceipt,
    isOnline,
  } = useHybridAi();

  const [tickerInput, setTickerInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [committedBanner, setCommittedBanner] = useState<string | null>(null);

  const [stagedImage, setStagedImage] = useState<NormalizedInlineImage | null>(null);
  const [tickerResult, setTickerResult] = useState<TickerTapeParseResult | null>(null);
  const [receiptAudit, setReceiptAudit] = useState<ExpenseReceiptAuditResult | null>(null);
  const [complianceAlert, setComplianceAlert] = useState<SecComplianceAlert | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeFoods: ReconciledFoodDraft[] =
    receiptAudit?.foods ?? tickerResult?.foods ?? [];
  const activeWorkouts: ReconciledWorkoutDraft[] = tickerResult?.workouts ?? [];
  const activeReceipt: HybridExecutionReceipt | null =
    receiptAudit?.receipt ?? tickerResult?.receipt ?? null;

  const handleParseSubmit = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    const raw = (overrideText ?? tickerInput).trim();

    // If user staged an Expense Receipt image, run Feature B Multimodal Audit
    if (stagedImage && !overrideText) {
      await runExpensePhotoAudit(stagedImage, raw);
      return;
    }

    if (!raw) return;
    setIsParsing(true);
    setErrorText(null);
    setComplianceAlert(null);
    setCommittedBanner(null);
    setReceiptAudit(null);

    try {
      const parsed = await parseTickerTapeHybrid({
        firebaseApp,
        shorthandInput: raw,
        secPrivacyLock,
        userWeightKg: healthData?.weightKg ?? 78,
      });
      setTickerResult(parsed);
      recordReceipt(parsed.receipt);
    } catch (err) {
      if (err instanceof SecPrivacyLockBlockedError) {
        setComplianceAlert(err.alert);
      } else {
        setErrorText(
          err instanceof Error
            ? err.message
            : 'Hybrid parser unavailable. Verify network or warm Local Nano Engine.'
        );
      }
    } finally {
      setIsParsing(false);
    }
  };

  const runExpensePhotoAudit = async (img: NormalizedInlineImage, note?: string) => {
    setIsParsing(true);
    setErrorText(null);
    setComplianceAlert(null);
    setCommittedBanner(null);
    setTickerResult(null);

    try {
      const result = await auditMealPhotoReceiptHybrid({
        firebaseApp,
        image: img,
        note,
        secPrivacyLock,
      });
      setReceiptAudit(result);
      recordReceipt(result.receipt);
    } catch (err) {
      if (err instanceof SecPrivacyLockBlockedError) {
        setComplianceAlert(err.alert);
      } else {
        setErrorText(
          err instanceof Error
            ? err.message
            : 'Multimodal Expense Audit failed. Try enabling Local Nano Multimodal or reconnecting.'
        );
      }
    } finally {
      setIsParsing(false);
    }
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const normalized = await normalizeImageFileForHybrid(file);
      setStagedImage(normalized);
      await runExpensePhotoAudit(normalized, tickerInput);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Unable to process meal image.');
    }
  };

  const handleCommitToLedger = async () => {
    if (!user || (!activeFoods.length && !activeWorkouts.length)) return;
    setIsCommitting(true);
    const todayIso = new Date().toLocaleDateString('en-CA');
    const dateIso = targetDateIso || todayIso;
    const nowTime = new Date().toTimeString().slice(0, 5);

    try {
      for (const f of activeFoods) {
        await healthService.logFood(db, user.uid, {
          name: f.name,
          portionG: f.portionG,
          calories: f.calories,
          proteinG: f.proteinG,
          carbsG: f.carbsG,
          fatG: f.fatG,
          fiberG: f.fiberG,
          plantMassG: f.plantMassG,
          glycemicIndex: f.glycemicIndex,
          omega3Mg: f.omega3Mg,
          caffeineMg: f.caffeineMg,
          hasElectrolytes: f.hasElectrolytes,
          betaAlanineG: f.betaAlanineG,
          creatineG: f.creatineG,
          alcoholDrinks: f.alcoholDrinks,
          hasSeedOils: f.hasSeedOils,
          meal: f.meal,
          source: f.source,
          consumedAt: nowTime,
          date: dateIso,
          inferenceSource: activeReceipt?.inferenceSource,
          inferenceLatencyMs: activeReceipt?.latencyMs,
          cfoClass: f.cfoClass,
        });
      }

      for (const w of activeWorkouts) {
        await healthService.logExercise(db, user.uid, {
          name: w.name,
          category: w.category,
          durationMin: w.durationMin,
          sets: w.sets,
          reps: w.reps,
          weightKg: w.weightKg,
          estimatedCaloriesBurned: w.estimatedCaloriesBurned,
          adjustedCalories: w.adjustedCalories,
          activityTier: w.activityTier,
          pointsDelta: w.pointsDelta,
          performedAt: nowTime,
          date: dateIso,
          inferenceSource: activeReceipt?.inferenceSource,
          inferenceLatencyMs: activeReceipt?.latencyMs,
          cfoClass: w.cfoClass,
        });
      }

      if (dateIso === todayIso && activeFoods.length > 0) {
        const addedCalories = activeFoods.reduce((s, f) => s + f.calories, 0);
        const addedProtein = activeFoods.reduce((s, f) => s + f.proteinG, 0);
        const addedCarbs = activeFoods.reduce((s, f) => s + f.carbsG, 0);
        const addedPlants = activeFoods.reduce((s, f) => s + (f.plantMassG || 0), 0);

        await healthService.updateHealthData(db, user.uid, {
          dailyCaloriesIn: (healthData?.dailyCaloriesIn || 0) + addedCalories,
          dailyProteinG: (healthData?.dailyProteinG || 0) + addedProtein,
          dailyCarbsG: (healthData?.dailyCarbsG || 0) + addedCarbs,
          dailyPlantG: (healthData?.dailyPlantG || 0) + addedPlants,
          lastActiveDate: todayIso,
        });
      }

      const itemCount = activeFoods.length + activeWorkouts.length;
      const syncLabel = isOnline ? 'Synced to Audit Ledger' : 'Committed to Offline Local Cache';
      setCommittedBanner(
        `LEDGER POSTED: ${itemCount} double-entry item${itemCount === 1 ? '' : 's'} (${syncLabel})`
      );
      toast({
        title: syncLabel,
        description: `${activeFoods.length} nutrition & ${activeWorkouts.length} CapEx entries recorded.`,
      });

      setTickerInput('');
      setStagedImage(null);
      setTickerResult(null);
      setReceiptAudit(null);
      onCommitted?.();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Failed to commit entries to Ledger.');
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <section
      data-testid="hybrid-ticker-terminal"
      className={cn(
        'rounded-xl border border-emerald-500/40 bg-slate-950 text-emerald-300 font-mono shadow-[0_0_28px_rgba(16,185,129,0.12)] overflow-hidden',
        className
      )}
    >
      {/* Terminal Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/25 bg-slate-900/90 px-3.5 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
            CFO HYBRID TICKER TAPE &amp; EXPENSE RECEIPT AUDITOR
          </span>
        </div>
        <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 border font-bold',
              secPrivacyLock
                ? 'border-emerald-400/60 bg-emerald-950 text-emerald-300'
                : 'border-amber-500/40 bg-slate-950 text-amber-300'
            )}
          >
            MODE: {secPrivacyLock ? 'ONLY_ON_DEVICE (SEC LOCK)' : 'PREFER_ON_DEVICE'}
          </span>
          {!isOnline && (
            <span className="rounded px-1.5 py-0.5 border border-amber-400/60 bg-amber-950/60 text-amber-300 font-bold">
              OFFLINE READY
            </span>
          )}
        </div>
      </div>

      {/* Command Input Row */}
      <div className="p-3.5 space-y-2.5">
        <form onSubmit={(e) => handleParseSubmit(e)} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 flex items-center rounded-lg border border-emerald-500/40 bg-black/70 px-3 py-2 focus-within:border-emerald-400 focus-within:shadow-[0_0_14px_rgba(16,185,129,0.25)]">
            <span className="text-emerald-400 font-bold text-xs mr-2 shrink-0">$&gt;</span>
            <input
              type="text"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              data-testid="ticker-tape-input"
              aria-label="CFO Natural-Language Macro and Workout Ticker"
              placeholder='Type shorthand: "3 eggs, 1 cup oats, black coffee, and 35 min heavy squats"'
              className="w-full bg-transparent text-xs text-emerald-200 placeholder:text-emerald-700/90 focus:outline-none font-mono"
            />
            {tickerInput && (
              <button
                type="button"
                onClick={() => setTickerInput('')}
                className="text-emerald-600 hover:text-emerald-300 ml-1"
                aria-label="Clear ticker input"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoFileChange}
              className="hidden"
              data-testid="expense-receipt-file-input"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isParsing}
              data-testid="expense-receipt-upload-btn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-300 transition-colors disabled:opacity-50"
              title="Upload or snap a JPEG/PNG meal photo or nutrition facts label for Multimodal Expense Audit"
            >
              <Camera className="w-3.5 h-3.5 text-amber-400" />
              <span>RECEIPT PHOTO</span>
            </button>

            <button
              type="submit"
              disabled={isParsing || (!tickerInput.trim() && !stagedImage)}
              data-testid="ticker-parse-submit-btn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/70 bg-emerald-500/20 hover:bg-emerald-500/30 px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-200 transition-colors disabled:opacity-40"
            >
              {isParsing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-300" />
                  <span>AUDITING...</span>
                </>
              ) : (
                <>
                  <CornerDownLeft className="w-3.5 h-3.5 text-emerald-300" />
                  <span>EXECUTE PARSE</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Quick Shorthand Ticker Presets */}
        {!compact && !tickerResult && !receiptAudit && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[9px] uppercase tracking-wider text-emerald-600 font-bold">
              QUICK TAPE:
            </span>
            {QUICK_SHORTHAND_EXAMPLES.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => {
                  setTickerInput(sample);
                  handleParseSubmit(undefined, sample);
                }}
                className="rounded border border-emerald-500/25 bg-emerald-950/30 hover:bg-emerald-900/40 px-2 py-0.5 text-[9px] text-emerald-400/90 hover:text-emerald-200 transition-colors truncate max-w-full"
              >
                {sample}
              </button>
            ))}
          </div>
        )}

        {/* Staged Photo Thumbnail */}
        {stagedImage && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-slate-900/80 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={stagedImage.previewDataUri}
              alt="Meal expense receipt"
              className="w-12 h-12 rounded object-cover border border-amber-400/40"
            />
            <div className="flex-1 min-w-0 text-[10px]">
              <p className="font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1">
                <Receipt className="w-3 h-3" />
                Multimodal Expense Receipt Attached ({stagedImage.mimeType})
              </p>
              <p className="text-emerald-400/80 truncate">
                InlineData normalized &le;960px for Chrome Gemini Nano &amp; Cloud Gemini.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setStagedImage(null);
                setReceiptAudit(null);
              }}
              className="text-slate-400 hover:text-white p-1"
              aria-label="Remove attached photo"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* SEC Privacy Lock Compliance Alert */}
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

        {/* Runtime Error */}
        {errorText && (
          <div className="rounded border border-rose-500/50 bg-rose-950/50 px-3 py-2 text-[10px] text-rose-300">
            [AUDIT ERROR] {errorText}
          </div>
        )}

        {/* Commit Confirmation Banner */}
        {committedBanner && (
          <div className="flex items-center justify-between gap-2 rounded border border-emerald-400/50 bg-emerald-950/60 px-3 py-2 text-[10px] text-emerald-200">
            <span className="flex items-center gap-1.5 font-bold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              {committedBanner}
            </span>
            <button
              type="button"
              onClick={() => setCommittedBanner(null)}
              className="text-emerald-400 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Parsed Double-Entry Audit Preview + 1-Click Commit */}
        {(tickerResult || receiptAudit) && activeReceipt && (
          <div
            data-testid="hybrid-parse-preview"
            className="rounded-lg border border-emerald-500/40 bg-slate-900/95 p-3 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-2">
              <ExecutionReceiptBadge
                inferenceSource={activeReceipt.inferenceSource}
                latencyMs={activeReceipt.latencyMs}
              />

              {receiptAudit && (
                <span
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-bold uppercase border',
                    receiptAudit.auditVerdict === 'APPROVED_ASSET'
                      ? 'border-emerald-400/60 bg-emerald-950 text-emerald-300'
                      : receiptAudit.auditVerdict === 'FLAGGED_LIABILITY'
                        ? 'border-rose-400/60 bg-rose-950 text-rose-300'
                        : 'border-amber-400/60 bg-amber-950 text-amber-300'
                  )}
                >
                  RECEIPT VERDICT: {receiptAudit.auditVerdict}
                </span>
              )}
            </div>

            {/* CFO Audit Commentary */}
            <p className="text-[11px] text-amber-200/95 leading-relaxed border-l-2 border-amber-400 pl-2.5">
              {receiptAudit ? receiptAudit.cfoCommentary : tickerResult?.cfoAuditNote}
            </p>

            {/* Double-Entry Line Items */}
            <div className="space-y-1.5">
              {activeFoods.map((item, idx) => {
                const meta = CFO_CLASS_META[item.cfoClass];
                return (
                  <div
                    key={`food_${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-emerald-500/20 bg-black/50 px-2.5 py-1.5 text-[10px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Utensils className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="font-bold text-emerald-100 truncate">
                        {item.name}
                      </span>
                      <span className="text-emerald-500">({item.portionG}g)</span>
                      <span
                        className={cn(
                          'rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider',
                          cfoClassBadgeStyles(item.cfoClass)
                        )}
                      >
                        {meta.shortTag}
                      </span>
                      {item.usdaMatched && (
                        <span className="rounded border border-emerald-500/30 bg-emerald-950/60 px-1 py-0.5 text-[8px] text-emerald-400">
                          USDA
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                      <span>{item.calories} kcal</span>
                      <span className="text-emerald-400">{item.proteinG}g P</span>
                      <span className="text-slate-400">{item.carbsG}g C</span>
                      <span className="text-slate-400">{item.fatG}g F</span>
                    </div>
                  </div>
                );
              })}

              {activeWorkouts.map((wk, idx) => {
                const meta = CFO_CLASS_META[wk.cfoClass];
                return (
                  <div
                    key={`wk_${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-cyan-500/30 bg-cyan-950/20 px-2.5 py-1.5 text-[10px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Dumbbell className="w-3 h-3 text-cyan-400 shrink-0" />
                      <span className="font-bold text-cyan-100 truncate">
                        {wk.name}
                      </span>
                      <span className="text-cyan-400">({wk.durationMin} min)</span>
                      <span
                        className={cn(
                          'rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider',
                          cfoClassBadgeStyles(wk.cfoClass)
                        )}
                      >
                        {meta.shortTag}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-cyan-300 font-semibold">
                      <span>-{wk.adjustedCalories} kcal net CapEx</span>
                      <span className="text-emerald-400">+{wk.pointsDelta} VF pts</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer Totals + 1-Click Commit */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="text-[10px] text-emerald-300/90 space-x-3">
                <span>
                  INFLOW:{' '}
                  <strong>
                    {activeFoods.reduce((s, f) => s + f.calories, 0)} kcal
                  </strong>
                </span>
                <span>
                  PROTEIN:{' '}
                  <strong>
                    {activeFoods.reduce((s, f) => s + f.proteinG, 0)}g
                  </strong>
                </span>
                {activeWorkouts.length > 0 && (
                  <span className="text-cyan-300">
                    CAPEX:{' '}
                    <strong>
                      -{activeWorkouts.reduce((s, w) => s + w.adjustedCalories, 0)} kcal
                    </strong>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTickerResult(null);
                    setReceiptAudit(null);
                    setStagedImage(null);
                  }}
                  className="rounded border border-slate-700 px-2.5 py-1 text-[10px] uppercase text-slate-400 hover:text-white"
                >
                  DISCARD
                </button>
                <button
                  type="button"
                  onClick={handleCommitToLedger}
                  disabled={isCommitting || (!activeFoods.length && !activeWorkouts.length)}
                  data-testid="commit-to-audit-ledger-btn"
                  className="inline-flex items-center gap-1.5 rounded border border-emerald-400 bg-emerald-500 text-slate-950 hover:bg-emerald-400 px-3 py-1 text-[10px] font-black uppercase tracking-wider transition-colors disabled:opacity-50"
                >
                  {isCommitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  <span>COMMIT TO AUDIT LEDGER</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
