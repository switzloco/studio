'use client';

/**
 * @fileOverview Firebase AI Logic Hybrid Inference Engine (`firebase/ai`) for the CFO.
 *
 * Implements:
 * - Chrome Built-in AI (`LanguageModel`) availability probing & 1-click download warmup
 * - Feature A: Instant Natural-Language "Ticker Tape" Macro & Workout Parser (`PREFER_ON_DEVICE`)
 * - Feature B: Multimodal "Expense Receipt" Meal & Nutrition Label Auditor (`PREFER_ON_DEVICE`)
 * - Feature C: "SEC Insider Privacy Lock" Strict On-Device Biometric Auditor (`ONLY_ON_DEVICE`)
 * - Feature D: "Quarterly Earnings Call" 30-Day Portfolio Forecast (`PREFER_IN_CLOUD`)
 *
 * STRICT SDK COMPLIANCE:
 * 1. `getGenerativeModel(ai, ...)` is ONLY called inside end-user interaction handlers (click/submit).
 * 2. Cloud fallback model is dynamically read from Firebase Remote Config (`gemini-3.8-flash` default),
 *    never using retired `gemini-2.0-*` models.
 * 3. Every response produces a `HybridExecutionReceipt` derived directly from `result.response.inferenceSource`.
 */

import type { FirebaseApp } from 'firebase/app';
import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  Schema,
  type Part,
} from 'firebase/ai';
import { getFirebaseAI, getFirebaseAgentPlatformAI } from '@/firebase/ai';
import {
  getCfoRemoteConfigSnapshot,
  type CfoPersonaStrictness,
  type HybridDefaultModeKey,
} from '@/firebase/remote-config';
import {
  reconcileParsedFoodItem,
  reconcileParsedWorkout,
  type ReconciledFoodDraft,
  type ReconciledWorkoutDraft,
} from './usda-local-reconciler';
import type { HealthData, UserPreferences } from './health-service';
import type { FoodLogEntry, ExerciseLogEntry } from './food-exercise-types';
import { computeAlpertNumber } from './vf-scoring';

export type NormalizedInferenceSource = 'ON_DEVICE' | 'IN_CLOUD';

export type LocalNanoStatus =
  | 'available'
  | 'downloading'
  | 'downloadable'
  | 'unavailable';

export interface HybridExecutionReceipt {
  id: string;
  inferenceSource: NormalizedInferenceSource;
  latencyMs: number;
  modeRequested: InferenceMode;
  cloudModelConfigured: string;
  badgeText: string;
  feature: 'TICKER_TAPE' | 'EXPENSE_RECEIPT' | 'SEC_BIOMETRIC_AUDIT' | 'EARNINGS_CALL' | 'HYBRID_COACH';
  timestamp: number;
}

export interface SecComplianceAlert {
  code: 'SEC_LOCK_NANO_UNAVAILABLE';
  headline: string;
  summary: string;
  steps: string[];
}

export class SecPrivacyLockBlockedError extends Error {
  readonly alert: SecComplianceAlert;

  constructor(alert: SecComplianceAlert) {
    super(alert.summary);
    this.name = 'SecPrivacyLockBlockedError';
    this.alert = alert;
  }
}

// ── Chrome Built-in AI (`window.LanguageModel`) Global Typing ─────────────────

interface ChromePromptMonitor {
  addEventListener: (
    type: 'downloadprogress',
    listener: (event: { loaded?: number; total?: number }) => void
  ) => void;
}

interface ChromeLanguageModelGlobal {
  availability?: (options?: {
    expectedInputs?: Array<{ type: 'text' | 'image' | 'audio' }>;
  }) => Promise<string>;
  create?: (options?: {
    expectedInputs?: Array<{ type: 'text' | 'image' | 'audio' }>;
    monitor?: (m: ChromePromptMonitor) => void;
  }) => Promise<{ destroy?: () => void }>;
}

function getChromeLanguageModelGlobal(): ChromeLanguageModelGlobal | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    LanguageModel?: ChromeLanguageModelGlobal;
    ai?: { languageModel?: ChromeLanguageModelGlobal & { capabilities?: () => Promise<{ available?: string }> } };
  };
  if (g.LanguageModel) return g.LanguageModel;
  if (g.ai?.languageModel) return g.ai.languageModel;
  return null;
}

/**
 * Safe passive telemetry probe (does NOT call `getGenerativeModel` or download weights).
 */
export async function probeLocalNanoAvailability(): Promise<LocalNanoStatus> {
  const lm = getChromeLanguageModelGlobal();
  if (!lm) return 'unavailable';

  try {
    if (typeof lm.availability === 'function') {
      const status = (await lm.availability()).toLowerCase();
      if (status === 'available' || status === 'readily') return 'available';
      if (status === 'downloading') return 'downloading';
      if (status === 'downloadable' || status === 'after-download') return 'downloadable';
      return 'unavailable';
    }
    const legacy = lm as { capabilities?: () => Promise<{ available?: string }> };
    if (typeof legacy.capabilities === 'function') {
      const cap = await legacy.capabilities();
      const avail = (cap?.available || '').toLowerCase();
      if (avail === 'readily' || avail === 'available') return 'available';
      if (avail === 'after-download' || avail === 'downloadable') return 'downloadable';
    }
  } catch {
    return 'unavailable';
  }
  return 'unavailable';
}

/**
 * Triggered ONLY on 1-click user interaction ("WARM LOCAL NANO ENGINE").
 * Warms Chrome's built-in Gemini Nano model with real-time download progress.
 */
export async function warmLocalNanoEngine(
  firebaseApp: FirebaseApp,
  onProgress: (percent: number) => void
): Promise<LocalNanoStatus> {
  onProgress(2);
  const lm = getChromeLanguageModelGlobal();

  if (lm && typeof lm.create === 'function') {
    const session = await lm.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const raw = typeof e.loaded === 'number' ? e.loaded : 0;
          const pct = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
          onProgress(Math.max(5, Math.min(100, pct)));
        });
      },
    });
    session?.destroy?.();
    onProgress(100);
    return 'available';
  }

  // Fallback via Firebase AI Logic SDK device model initializer (must run inside click handler)
  const ai = getFirebaseAI(firebaseApp);
  const rc = getCfoRemoteConfigSnapshot(firebaseApp);
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: { model: rc.cfoCloudModel },
  });
  await model.initializeDeviceModel((progressValue) => {
    onProgress(Math.max(5, Math.min(100, Math.round(progressValue * 100))));
  });
  onProgress(100);
  return probeLocalNanoAvailability();
}

// ── Execution Receipt Formatting ──────────────────────────────────────────────

export function normalizeInferenceSource(
  rawSource?: InferenceSource | string | null
): NormalizedInferenceSource {
  const upper = String(rawSource || '').toUpperCase();
  if (upper === 'ON_DEVICE' || rawSource === InferenceSource.ON_DEVICE) {
    return 'ON_DEVICE';
  }
  return 'IN_CLOUD';
}

export function formatExecutionBadge(
  source: NormalizedInferenceSource,
  latencyMs: number
): string {
  const cleanMs = Math.max(1, Math.round(latencyMs));
  if (source === 'ON_DEVICE') {
    return `[EXEC: ON_DEVICE // GEMINI NANO // ${cleanMs}ms // $0.00 GAS]`;
  }
  return `[EXEC: IN_CLOUD // GEMINI CLOUD // ${cleanMs}ms // FALLBACK]`;
}

function buildExecutionReceipt(params: {
  rawSource?: InferenceSource | string | null;
  latencyMs: number;
  modeRequested: InferenceMode;
  cloudModelConfigured: string;
  feature: HybridExecutionReceipt['feature'];
}): HybridExecutionReceipt {
  const inferenceSource = normalizeInferenceSource(params.rawSource);
  const latencyMs = Math.max(1, Math.round(params.latencyMs));
  return {
    id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    inferenceSource,
    latencyMs,
    modeRequested: params.modeRequested,
    cloudModelConfigured: params.cloudModelConfigured,
    badgeText: formatExecutionBadge(inferenceSource, latencyMs),
    feature: params.feature,
    timestamp: Date.now(),
  };
}

export function buildSecComplianceAlert(detail?: string): SecComplianceAlert {
  return {
    code: 'SEC_LOCK_NANO_UNAVAILABLE',
    headline: 'SEC INSIDER PRIVACY LOCK // ON-DEVICE ENGINE REQUIRED',
    summary:
      detail ||
      'Strict On-Device Mode (InferenceMode.ONLY_ON_DEVICE) blocked cloud transmission because Chrome Gemini Nano is not active in this browser session.',
    steps: [
      'Open Chrome Desktop (v138+) and navigate to chrome://flags/#optimization-guide-on-device-model -> set to Enabled BypassPerfRequirement.',
      'Navigate to chrome://flags/#prompt-api-for-gemini-nano-multimodal-input -> set to Enabled, then relaunch Chrome.',
      'Click "WARM LOCAL NANO ENGINE" in the top telemetry bar, OR disable "SEC PRIVACY LOCK" to authorize encrypted Hybrid Cloud Fallback (PREFER_ON_DEVICE).',
    ],
  };
}

function resolveRequestedMode(
  secPrivacyLock: boolean,
  remoteDefault: HybridDefaultModeKey,
  preferredOverride?: InferenceMode
): InferenceMode {
  if (secPrivacyLock) {
    return InferenceMode.ONLY_ON_DEVICE;
  }
  if (preferredOverride) {
    return preferredOverride;
  }
  switch (remoteDefault) {
    case 'ONLY_ON_DEVICE':
      return InferenceMode.ONLY_ON_DEVICE;
    case 'PREFER_IN_CLOUD':
      return InferenceMode.PREFER_IN_CLOUD;
    case 'ONLY_IN_CLOUD':
      return InferenceMode.ONLY_IN_CLOUD;
    case 'PREFER_ON_DEVICE':
    default:
      return InferenceMode.PREFER_ON_DEVICE;
  }
}

function personaDirective(strictness: CfoPersonaStrictness): string {
  if (strictness === 'balanced_advisor') {
    return 'Tone: Calm institutional portfolio manager — analytical, encouraging, precise.';
  }
  return 'Tone: Ruthless Wall Street Chief Fitness Officer — crisp Bloomberg terminal brevity, treat protein & strength as high-yield capital assets and refined sugar/alcohol/seed oils as toxic balance-sheet liabilities.';
}

function truncateForNanoBudget(input: string, maxChars: number = 16_000): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}\n...[TRUNCATED FOR 6K ON-DEVICE TOKEN CEILING]`;
}

function safeParseJson<T>(rawText: string): T {
  const trimmed = rawText.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  const jsonSlice =
    firstBrace !== -1 && lastBrace > firstBrace
      ? stripped.slice(firstBrace, lastBrace + 1)
      : stripped;
  return JSON.parse(jsonSlice) as T;
}

const CLOUD_MODEL_FALLBACK_CHAIN = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
] as const;

function buildCloudModelCandidates(primaryModel: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const candidate of [primaryModel, ...CLOUD_MODEL_FALLBACK_CHAIN]) {
    if (candidate && !/^gemini-2\.0/i.test(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      list.push(candidate);
    }
  }
  return list;
}

function isModelOrBackendRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /404|429|402|prepayment credits|quota|resource_exhausted|not[\s_-]*found|does not exist|not supported for generateContent/i.test(
    msg
  );
}

function isQuotaOrBillingDepletedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /429|402|prepayment credits|quota|resource_exhausted/i.test(msg);
}

function isOnDeviceQuotaOrUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  const name = err instanceof Error ? err.name : '';
  return (
    name === 'QuotaExceededError' ||
    name === 'NotSupportedError' ||
    name === 'InvalidStateError' ||
    /input is too large|not available|unavailable|unsupported/i.test(msg)
  );
}

async function runResilientHybridGenerateContent(params: {
  ai: ReturnType<typeof getFirebaseAI>;
  mode: InferenceMode;
  primaryCloudModel: string;
  request: string | Array<string | Part>;
  schema?: ReturnType<typeof Schema.object>;
  multimodal?: boolean;
}) {
  const { ai, mode, primaryCloudModel, request, schema, multimodal = false } = params;
  const cloudCandidates = buildCloudModelCandidates(primaryCloudModel);

  const invokeOnce = async (
    targetAi: ReturnType<typeof getFirebaseAI>,
    activeMode: InferenceMode,
    cloudModel: string,
    includeOnDeviceConstraint: boolean
  ) => {
    const model = getGenerativeModel(targetAi, {
      mode: activeMode,
      inCloudParams: {
        model: cloudModel,
        ...(schema
          ? {
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: schema,
              },
            }
          : {}),
      },
      onDeviceParams: {
        ...(multimodal
          ? {
              createOptions: {
                expectedInputs: [{ type: 'image' as const }, { type: 'text' as const }],
              },
            }
          : {}),
        ...(schema && includeOnDeviceConstraint
          ? {
              promptOptions: {
                responseConstraint: schema,
              },
            }
          : {}),
      },
    });
    return model.generateContent(request);
  };

  // Strict on-device execution (`SEC PRIVACY LOCK`) — never touch cloud
  if (mode === InferenceMode.ONLY_ON_DEVICE) {
    try {
      return {
        result: await invokeOnce(ai, InferenceMode.ONLY_ON_DEVICE, cloudCandidates[0], true),
        resolvedCloudModel: cloudCandidates[0],
      };
    } catch (firstErr) {
      if (schema) {
        return {
          result: await invokeOnce(ai, InferenceMode.ONLY_ON_DEVICE, cloudCandidates[0], false),
          resolvedCloudModel: cloudCandidates[0],
        };
      }
      throw firstErr;
    }
  }

  // Hybrid modes (`PREFER_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`):
  // Try primary GoogleAIBackend first; if AI Studio prepayment credits return 429, fail over to Blaze AgentPlatformBackend.
  const backends: Array<ReturnType<typeof getFirebaseAI>> = [
    ai,
    getFirebaseAgentPlatformAI(ai.app),
  ];

  let lastError: unknown = null;
  for (let bIdx = 0; bIdx < backends.length; bIdx++) {
    const targetAi = backends[bIdx];
    let switchBackend = false;

    for (let i = 0; i < cloudCandidates.length; i++) {
      const candidateModel = cloudCandidates[i];
      const effectiveMode =
        bIdx === 0 && i === 0 ? mode : InferenceMode.ONLY_IN_CLOUD;
      try {
        const result = await invokeOnce(targetAi, effectiveMode, candidateModel, true);
        return { result, resolvedCloudModel: candidateModel };
      } catch (err) {
        lastError = err;
        const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;

        // If on-device Nano threw QuotaExceededError ("The input is too large") while online, route cleanly to Cloud
        if (
          effectiveMode !== InferenceMode.ONLY_IN_CLOUD &&
          isOnline &&
          isOnDeviceQuotaOrUnavailableError(err)
        ) {
          try {
            const cloudResult = await invokeOnce(
              targetAi,
              InferenceMode.ONLY_IN_CLOUD,
              candidateModel,
              false
            );
            return { result: cloudResult, resolvedCloudModel: candidateModel };
          } catch (cloudErr) {
            lastError = cloudErr;
            if (bIdx === 0 && isQuotaOrBillingDepletedError(cloudErr)) {
              switchBackend = true;
              break;
            }
            if (isModelOrBackendRetryableError(cloudErr)) {
              continue;
            }
            throw cloudErr;
          }
        }

        if (bIdx === 0 && isQuotaOrBillingDepletedError(err)) {
          switchBackend = true;
          break;
        }
        if (isModelOrBackendRetryableError(err)) {
          continue;
        }
        throw err;
      }
    }

    if (!switchBackend && bIdx === 0 && !isModelOrBackendRetryableError(lastError)) {
      break;
    }
  }
  throw lastError ?? new Error('Hybrid inference failed.');
}

// ── Shared Hybrid Structured Output Schemas (`Schema.object(...)`) ────────────
// Kept compact so serialized JSON constraints fit comfortably inside Chrome Gemini Nano's inputQuota.

export const ledgerEntrySchema = Schema.object({
  properties: {
    foods: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          quantityText: Schema.string(),
          portionG: Schema.number(),
          calories: Schema.number(),
          proteinG: Schema.number(),
          carbsG: Schema.number(),
          fatG: Schema.number(),
          fiberG: Schema.number(),
          alcoholDrinks: Schema.number(),
          hasSeedOils: Schema.boolean(),
          cfoCategory: Schema.enumString({
            enum: ['CAPITAL_ASSET_INFLOW', 'LIABILITY_EXPOSURE', 'OPERATING_FUEL'],
          }),
        },
        optionalProperties: ['quantityText', 'fiberG', 'alcoholDrinks', 'hasSeedOils', 'cfoCategory'],
      }),
    }),
    workouts: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          category: Schema.enumString({
            enum: ['strength', 'conditioning', 'recovery', 'cardio'],
          }),
          durationMin: Schema.number(),
          estimatedCaloriesBurned: Schema.number(),
        },
        optionalProperties: ['estimatedCaloriesBurned'],
      }),
    }),
    cfoAuditNote: Schema.string(),
  },
});

export const expenseReceiptSchema = Schema.object({
  properties: {
    receiptTitle: Schema.string(),
    foods: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          quantityText: Schema.string(),
          portionG: Schema.number(),
          calories: Schema.number(),
          proteinG: Schema.number(),
          carbsG: Schema.number(),
          fatG: Schema.number(),
          fiberG: Schema.number(),
          alcoholDrinks: Schema.number(),
          hasSeedOils: Schema.boolean(),
        },
        optionalProperties: ['quantityText', 'fiberG', 'alcoholDrinks', 'hasSeedOils'],
      }),
    }),
    auditVerdict: Schema.enumString({
      enum: ['APPROVED_ASSET', 'CONDITIONAL_OPEX', 'FLAGGED_LIABILITY'],
    }),
    cfoCommentary: Schema.string(),
  },
});

export const earningsCallSchema = Schema.object({
  properties: {
    headline: Schema.string(),
    marketRating: Schema.enumString({
      enum: ['STRONG_BUY', 'OUTPERFORM', 'HOLD', 'UNDERPERFORM', 'MARGIN_CALL'],
    }),
    projected30dEquityDelta: Schema.number(),
    metabolicBreakEvenKcal: Schema.number(),
    executiveSummary: Schema.string(),
    capitalDirectives: Schema.array({
      items: Schema.string(),
    }),
    liabilityRisks: Schema.array({
      items: Schema.string(),
    }),
  },
});

// ── Feature A: Instant Natural-Language Ticker Tape Parser (`PREFER_ON_DEVICE`) ─

interface RawLedgerParseJson {
  foods?: Array<{
    name: string;
    quantityText?: string;
    portionG?: number;
    calories?: number;
    proteinG?: number;
    carbsG?: number;
    fatG?: number;
    fiberG?: number;
    alcoholDrinks?: number;
    hasSeedOils?: boolean;
  }>;
  workouts?: Array<{
    name: string;
    category?: string;
    durationMin?: number;
    estimatedCaloriesBurned?: number;
  }>;
  cfoAuditNote?: string;
}

export interface TickerTapeParseResult {
  foods: ReconciledFoodDraft[];
  workouts: ReconciledWorkoutDraft[];
  cfoAuditNote: string;
  totals: {
    caloriesIn: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    capexBurnKcal: number;
  };
  receipt: HybridExecutionReceipt;
}

/**
 * Parses natural-language shorthand (e.g. "3 eggs, 1 cup oats, black coffee, and 35 min heavy squats")
 * using Hybrid Structured Output (`PREFER_ON_DEVICE`, or `ONLY_ON_DEVICE` when SEC Privacy Lock is active).
 * Must be invoked directly from a user click/submit event.
 */
export async function parseTickerTapeHybrid(params: {
  firebaseApp: FirebaseApp;
  shorthandInput: string;
  secPrivacyLock: boolean;
  userWeightKg?: number;
}): Promise<TickerTapeParseResult> {
  const { firebaseApp, shorthandInput, secPrivacyLock, userWeightKg = 78 } = params;
  const trimmed = shorthandInput.trim();
  if (!trimmed) {
    throw new Error('Enter meal or workout shorthand to parse.');
  }

  const ai = getFirebaseAI(firebaseApp);
  const rc = getCfoRemoteConfigSnapshot(firebaseApp);
  const mode = resolveRequestedMode(secPrivacyLock, rc.hybridDefaultMode, InferenceMode.PREFER_ON_DEVICE);

  const prompt = truncateForNanoBudget(
    [
      'Return JSON matching {foods:[{name,quantityText,portionG,calories,proteinG,carbsG,fatG,fiberG,alcoholDrinks,hasSeedOils,cfoCategory}],workouts:[{name,category,durationMin,estimatedCaloriesBurned}],cfoAuditNote}.',
      personaDirective(rc.cfoPersonaStrictness),
      `Input: "${trimmed}"`,
    ].join('\n'),
    3_500
  );

  const startedAt = performance.now();
  try {
    const { result, resolvedCloudModel } = await runResilientHybridGenerateContent({
      ai,
      mode,
      primaryCloudModel: rc.cfoCloudModel,
      request: prompt,
      schema: ledgerEntrySchema,
    });

    const latencyMs = performance.now() - startedAt;
    const parsed = safeParseJson<RawLedgerParseJson>(result.response.text());

    const foods = (parsed.foods || [])
      .filter((f) => f && f.name)
      .map((f) => reconcileParsedFoodItem(f));
    const workouts = (parsed.workouts || [])
      .filter((w) => w && w.name)
      .map((w) => reconcileParsedWorkout(w, userWeightKg));

    const totals = {
      caloriesIn: foods.reduce((s, f) => s + f.calories, 0),
      proteinG: foods.reduce((s, f) => s + f.proteinG, 0),
      carbsG: foods.reduce((s, f) => s + f.carbsG, 0),
      fatG: foods.reduce((s, f) => s + f.fatG, 0),
      capexBurnKcal: workouts.reduce((s, w) => s + w.adjustedCalories, 0),
    };

    const receipt = buildExecutionReceipt({
      rawSource: result.response.inferenceSource,
      latencyMs,
      modeRequested: mode,
      cloudModelConfigured: resolvedCloudModel,
      feature: 'TICKER_TAPE',
    });

    return {
      foods,
      workouts,
      cfoAuditNote:
        parsed.cfoAuditNote ||
        'Double-entry macro & CapEx audit reconciled against USDA reference baselines.',
      totals,
      receipt,
    };
  } catch (err) {
    if (mode === InferenceMode.ONLY_ON_DEVICE) {
      throw new SecPrivacyLockBlockedError(buildSecComplianceAlert());
    }
    throw err;
  }
}

// ── Feature B: Multimodal "Expense Receipt" Photo Auditor (`PREFER_ON_DEVICE`) ─

export interface NormalizedInlineImage {
  mimeType: 'image/jpeg' | 'image/png';
  base64Data: string;
  previewDataUri: string;
}

/**
 * Normalizes any browser `File` (JPEG, PNG, WebP, camera capture) into compact
 * `image/jpeg` or `image/png` inlineData (`<= 960px`) compatible with Chrome's
 * Multimodal Prompt API and Cloud Gemini.
 */
export async function normalizeImageFileForHybrid(
  file: File
): Promise<NormalizedInlineImage> {
  const targetMime: 'image/jpeg' | 'image/png' =
    file.type === 'image/png' ? 'image/png' : 'image/jpeg';

  const rawDataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

  if (typeof document === 'undefined') {
    const base64Data = rawDataUri.split(',')[1] || '';
    return { mimeType: targetMime, base64Data, previewDataUri: rawDataUri };
  }

  return new Promise<NormalizedInlineImage>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 960;
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        const base64Data = rawDataUri.split(',')[1] || '';
        resolve({ mimeType: targetMime, base64Data, previewDataUri: rawDataUri });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const outUri =
        targetMime === 'image/png'
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', 0.84);
      const base64Data = outUri.split(',')[1] || '';
      resolve({ mimeType: targetMime, base64Data, previewDataUri: outUri });
    };
    img.onerror = () => reject(new Error('Could not decode uploaded meal photo.'));
    img.src = rawDataUri;
  });
}

export function dataUriToInlineImage(dataUri: string): NormalizedInlineImage {
  const match = dataUri.match(/^data:(image\/png|image\/jpeg);base64,(.+)$/i);
  if (match) {
    const mimeType = match[1].toLowerCase() === 'image/png' ? 'image/png' : 'image/jpeg';
    return { mimeType, base64Data: match[2], previewDataUri: dataUri };
  }
  const fallbackBase64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
  return {
    mimeType: 'image/jpeg',
    base64Data: fallbackBase64,
    previewDataUri: dataUri,
  };
}

interface RawExpenseReceiptJson {
  receiptTitle?: string;
  foods?: Array<{
    name: string;
    quantityText?: string;
    portionG?: number;
    calories?: number;
    proteinG?: number;
    carbsG?: number;
    fatG?: number;
    fiberG?: number;
    alcoholDrinks?: number;
    hasSeedOils?: boolean;
  }>;
  auditVerdict?: 'APPROVED_ASSET' | 'CONDITIONAL_OPEX' | 'FLAGGED_LIABILITY';
  cfoCommentary?: string;
}

export interface ExpenseReceiptAuditResult {
  receiptTitle: string;
  foods: ReconciledFoodDraft[];
  auditVerdict: 'APPROVED_ASSET' | 'CONDITIONAL_OPEX' | 'FLAGGED_LIABILITY';
  cfoCommentary: string;
  totals: {
    caloriesIn: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  receipt: HybridExecutionReceipt;
}

/**
 * Multimodal Expense Receipt Auditor (`InferenceMode.PREFER_ON_DEVICE`, or `ONLY_ON_DEVICE` under SEC Lock).
 * Must be invoked directly from a user click/upload interaction.
 */
export async function auditMealPhotoReceiptHybrid(params: {
  firebaseApp: FirebaseApp;
  image: NormalizedInlineImage;
  note?: string;
  secPrivacyLock: boolean;
}): Promise<ExpenseReceiptAuditResult> {
  const { firebaseApp, image, note, secPrivacyLock } = params;
  const ai = getFirebaseAI(firebaseApp);
  const rc = getCfoRemoteConfigSnapshot(firebaseApp);
  const mode = resolveRequestedMode(secPrivacyLock, rc.hybridDefaultMode, InferenceMode.PREFER_ON_DEVICE);

  const imagePart: Part = {
    type: 'inlineData',
    inlineData: {
      mimeType: image.mimeType,
      data: image.base64Data,
    },
  };

  const textPrompt = truncateForNanoBudget(
    [
      'You are the Chief Fitness Officer Multimodal Expense Receipt Auditor.',
      personaDirective(rc.cfoPersonaStrictness),
      'Inspect this meal photo or nutrition facts label. Identify every visible food item or nutrition panel serving, estimate portion grams and macros, flag seed oils or alcohol liabilities, and issue a crisp CFO Expense Audit verdict.',
      note?.trim() ? `Auditor Note from User: "${note.trim()}"` : '',
    ]
      .filter(Boolean)
      .join('\n')
  );

  const startedAt = performance.now();

  try {
    const { result, resolvedCloudModel } = await runResilientHybridGenerateContent({
      ai,
      mode,
      primaryCloudModel: rc.cfoCloudModel,
      request: [textPrompt, imagePart],
      schema: expenseReceiptSchema,
      multimodal: true,
    });

    const latencyMs = performance.now() - startedAt;
    const parsed = safeParseJson<RawExpenseReceiptJson>(result.response.text());
    const foods = (parsed.foods || [])
      .filter((f) => f && f.name)
      .map((f) => reconcileParsedFoodItem(f));

    const totals = {
      caloriesIn: foods.reduce((s, f) => s + f.calories, 0),
      proteinG: foods.reduce((s, f) => s + f.proteinG, 0),
      carbsG: foods.reduce((s, f) => s + f.carbsG, 0),
      fatG: foods.reduce((s, f) => s + f.fatG, 0),
    };

    const verdict =
      parsed.auditVerdict === 'APPROVED_ASSET' ||
      parsed.auditVerdict === 'CONDITIONAL_OPEX' ||
      parsed.auditVerdict === 'FLAGGED_LIABILITY'
        ? parsed.auditVerdict
        : foods.some((f) => f.cfoClass === 'LIABILITY_EXPOSURE')
          ? 'FLAGGED_LIABILITY'
          : totals.proteinG >= 25
            ? 'APPROVED_ASSET'
            : 'CONDITIONAL_OPEX';

    const receipt = buildExecutionReceipt({
      rawSource: result.response.inferenceSource,
      latencyMs,
      modeRequested: mode,
      cloudModelConfigured: resolvedCloudModel,
      feature: 'EXPENSE_RECEIPT',
    });

    return {
      receiptTitle: parsed.receiptTitle || 'Visual Expense Receipt Audit',
      foods,
      auditVerdict: verdict,
      cfoCommentary:
        parsed.cfoCommentary ||
        'Visual macro extraction reconciled against CFO balance-sheet standards.',
      totals,
      receipt,
    };
  } catch (err) {
    if (mode === InferenceMode.ONLY_ON_DEVICE) {
      throw new SecPrivacyLockBlockedError(
        buildSecComplianceAlert(
          'Strict On-Device Multimodal Audit requires Chrome Gemini Nano with Multimodal Input enabled (`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`). Zero image bytes were transmitted to the cloud.'
        )
      );
    }
    throw err;
  }
}

// ── Feature C: SEC Insider Privacy Lock Single-Turn Biometric Audit ───────────

export interface BiometricAuditResult {
  replyText: string;
  receipt: HybridExecutionReceipt;
}

/**
 * Single-turn biometric & health query engine (< 6,000 tokens).
 * When `secPrivacyLock` is true, enforces `InferenceMode.ONLY_ON_DEVICE` so raw
 * weight, visceral fat liabilities, and personal health notes mathematically never leave the browser.
 * Also supports `PREFER_ON_DEVICE` when the user is offline in Coach chat!
 */
export async function runHybridCoachTurn(params: {
  firebaseApp: FirebaseApp;
  userMessage: string;
  secPrivacyLock: boolean;
  healthData?: HealthData | null;
  preferences?: UserPreferences | null;
  attachedImages?: NormalizedInlineImage[];
}): Promise<BiometricAuditResult> {
  const {
    firebaseApp,
    userMessage,
    secPrivacyLock,
    healthData,
    preferences,
    attachedImages = [],
  } = params;

  const ai = getFirebaseAI(firebaseApp);
  const rc = getCfoRemoteConfigSnapshot(firebaseApp);
  const mode = secPrivacyLock
    ? InferenceMode.ONLY_ON_DEVICE
    : resolveRequestedMode(false, rc.hybridDefaultMode, InferenceMode.PREFER_ON_DEVICE);

  const weightKg = healthData?.weightKg ?? preferences?.profile?.weightKg ?? 78;
  const bfPct = healthData?.bodyFatPct ?? 22;
  const alpertKcal = computeAlpertNumber(weightKg, bfPct);
  const recentHistory = (healthData?.history || []).slice(-7);
  const recentSummary = recentHistory
    .map((h) => `${h.isoDate || h.date}: ${h.gain >= 0 ? '+' : ''}${h.gain}pts (Eq:${h.equity})`)
    .join(', ');

  // Keep prompt compact (< 4,500 tokens) so it always fits inside Gemini Nano's 6,000-token ceiling
  const biometricContext = [
    `Portfolio Snapshot: Weight=${Math.round(weightKg * 10) / 10}kg | BF=${bfPct}% | Alpert Fat-Oxidation Ceiling=${alpertKcal} kcal/day`,
    `Today Ledger: CaloriesIn=${healthData?.dailyCaloriesIn ?? 0} kcal | CaloriesOut=${healthData?.dailyCaloriesOut ?? 2000} kcal | Protein=${healthData?.dailyProteinG ?? 0}g/${preferences?.targets?.proteinGoal ?? 150}g | Sleep=${healthData?.sleepHours ?? 7}h | Steps=${healthData?.steps ?? 0}`,
    `Cumulative Visceral Fat Equity=${healthData?.visceralFatPoints ?? 0} pts | 7-Day Tape=[${recentSummary || 'New Ledger'}]`,
  ].join('\n');

  const promptText = truncateForNanoBudget(
    [
      'You are the CFO (Chief Fitness Officer), an institutional biometric portfolio advisor.',
      personaDirective(rc.cfoPersonaStrictness),
      secPrivacyLock
        ? 'SEC INSIDER PRIVACY LOCK ACTIVE: You are executing strictly on-device inside Chrome Gemini Nano. Zero biometric data leaves this browser.'
        : 'Respond with concise, actionable CFO analysis grounded in the user biometric ledger.',
      biometricContext,
      `Client Query: ${userMessage.trim() || 'Audit my current biometric position and today macro balance.'}`,
    ].join('\n\n'),
    14_000
  );

  const requestParts: Array<string | Part> = [promptText];
  for (const img of attachedImages.slice(0, 2)) {
    requestParts.push({
      type: 'inlineData',
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64Data,
      },
    });
  }

  const startedAt = performance.now();
  try {
    const { result, resolvedCloudModel } = await runResilientHybridGenerateContent({
      ai,
      mode,
      primaryCloudModel: rc.cfoCloudModel,
      request: requestParts,
      multimodal: attachedImages.length > 0,
    });
    const latencyMs = performance.now() - startedAt;
    const replyText = result.response.text().trim();

    const receipt = buildExecutionReceipt({
      rawSource: result.response.inferenceSource,
      latencyMs,
      modeRequested: mode,
      cloudModelConfigured: resolvedCloudModel,
      feature: secPrivacyLock ? 'SEC_BIOMETRIC_AUDIT' : 'HYBRID_COACH',
    });

    return { replyText, receipt };
  } catch (err) {
    if (mode === InferenceMode.ONLY_ON_DEVICE) {
      throw new SecPrivacyLockBlockedError(buildSecComplianceAlert());
    }
    throw err;
  }
}

// ── Feature D: "Quarterly Earnings Call" Deep Portfolio Forecast (`PREFER_IN_CLOUD`) ─

export interface QuarterlyEarningsCallResult {
  headline: string;
  marketRating: 'STRONG_BUY' | 'OUTPERFORM' | 'HOLD' | 'UNDERPERFORM' | 'MARGIN_CALL';
  projected30dEquityDelta: number;
  metabolicBreakEvenKcal: number;
  executiveSummary: string;
  capitalDirectives: string[];
  liabilityRisks: string[];
  receipt: HybridExecutionReceipt;
}

/**
 * Intentional upward cloud routing (`InferenceMode.PREFER_IN_CLOUD`) for multi-week
 * Audit Ledger synthesis, Equity Score trajectory, and metabolic break-even forecasting,
 * while seamlessly falling back to on-device Gemini Nano if the browser is offline!
 * Must be invoked directly from a user button click.
 */
export async function runQuarterlyEarningsCallHybrid(params: {
  firebaseApp: FirebaseApp;
  healthData?: HealthData | null;
  preferences?: UserPreferences | null;
  recentFoodLogs?: FoodLogEntry[];
  recentExerciseLogs?: ExerciseLogEntry[];
  secPrivacyLock: boolean;
}): Promise<QuarterlyEarningsCallResult> {
  const {
    firebaseApp,
    healthData,
    preferences,
    recentFoodLogs = [],
    recentExerciseLogs = [],
    secPrivacyLock,
  } = params;

  const ai = getFirebaseAI(firebaseApp);
  const rc = getCfoRemoteConfigSnapshot(firebaseApp);
  const mode = secPrivacyLock
    ? InferenceMode.ONLY_ON_DEVICE
    : InferenceMode.PREFER_IN_CLOUD;

  const weightKg = healthData?.weightKg ?? preferences?.profile?.weightKg ?? 78;
  const bfPct = healthData?.bodyFatPct ?? 22;
  const alpertKcal = computeAlpertNumber(weightKg, bfPct);
  const proteinGoal = preferences?.targets?.proteinGoal ?? 150;

  const historySlice = (healthData?.history || []).slice(-30);
  const historyTape = historySlice
    .map(
      (h) =>
        `${h.isoDate || h.date}: gain=${h.gain >= 0 ? '+' : ''}${h.gain} | equity=${h.equity} | status=${h.status}${
          h.breakdown
            ? ` | in=${h.breakdown.caloriesIn}kcal out=${h.breakdown.caloriesOut}kcal P=${h.breakdown.proteinG}g`
            : ''
        }`
    )
    .join('\n');

  const foodSample = recentFoodLogs
    .slice(0, 25)
    .map(
      (f) =>
        `${f.date} [${f.meal}] ${f.name}: ${f.calories}kcal, ${f.proteinG}g P${
          f.alcoholDrinks ? `, ${f.alcoholDrinks} drinks` : ''
        }${f.hasSeedOils ? ', SEED_OILS' : ''}`
    )
    .join('\n');

  const capexSample = recentExerciseLogs
    .slice(0, 15)
    .map((e) => `${e.date} [${e.category}] ${e.name}: ${e.durationMin ?? 30}m, ${e.adjustedCalories ?? e.estimatedCaloriesBurned ?? 0}kcal`)
    .join('\n');

  const prompt = truncateForNanoBudget(
    [
      'You are the Chief Fitness Officer presiding over a 30-Day Institutional Metabolic Earnings Call.',
      personaDirective(rc.cfoPersonaStrictness),
      `Client Balance Sheet: Weight=${Math.round(weightKg * 10) / 10}kg | BodyFat=${bfPct}% | Alpert Max Fat-Oxidation Ceiling=${alpertKcal} kcal/day | Protein Liquidity Target=${proteinGoal}g/day | Current Cumulative VF Equity=${healthData?.visceralFatPoints ?? 0} pts`,
      preferences?.activeLevel
        ? `Active Sprint: "${preferences.activeLevel.name}" (Target: ${preferences.activeLevel.targetPoints} pts from ${preferences.activeLevel.startDate})`
        : 'Active Sprint: Open Portfolio Ledger',
      `Today Intraday Position: In=${healthData?.dailyCaloriesIn ?? 0}kcal | Out=${healthData?.dailyCaloriesOut ?? 2000}kcal | Protein=${healthData?.dailyProteinG ?? 0}g`,
      `30-Day Equity Ledger Tape (${historySlice.length} sessions):\n${historyTape || 'Day 1 baseline — project forward from current run-rate and Alpert ceiling.'}`,
      foodSample ? `Recent Nutritional Inflows:\n${foodSample}` : '',
      capexSample ? `Recent Training CapEx:\n${capexSample}` : '',
      'Synthesize the multi-week ledger, issue an institutional marketRating, compute metabolicBreakEvenKcal and projected30dEquityDelta, write a sharp 2-3 sentence executiveSummary, 3 concrete capitalDirectives, and 2-3 liabilityRisks.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    mode === InferenceMode.ONLY_ON_DEVICE ? 14_000 : 28_000
  );

  const startedAt = performance.now();
  try {
    const { result, resolvedCloudModel } = await runResilientHybridGenerateContent({
      ai,
      mode,
      primaryCloudModel: rc.cfoCloudModel,
      request: prompt,
      schema: earningsCallSchema,
    });
    const latencyMs = performance.now() - startedAt;
    const parsed = safeParseJson<Partial<QuarterlyEarningsCallResult>>(result.response.text());

    const validRating =
      parsed.marketRating === 'STRONG_BUY' ||
      parsed.marketRating === 'OUTPERFORM' ||
      parsed.marketRating === 'HOLD' ||
      parsed.marketRating === 'UNDERPERFORM' ||
      parsed.marketRating === 'MARGIN_CALL'
        ? parsed.marketRating
        : 'HOLD';

    const receipt = buildExecutionReceipt({
      rawSource: result.response.inferenceSource,
      latencyMs,
      modeRequested: mode,
      cloudModelConfigured: resolvedCloudModel,
      feature: 'EARNINGS_CALL',
    });

    return {
      headline: parsed.headline || '30-Day Metabolic Portfolio Earnings Guidance',
      marketRating: validRating,
      projected30dEquityDelta: Math.round(Number(parsed.projected30dEquityDelta) || 450),
      metabolicBreakEvenKcal: Math.round(
        Number(parsed.metabolicBreakEvenKcal) || healthData?.dailyCaloriesOut || 2100
      ),
      executiveSummary:
        parsed.executiveSummary ||
        'Portfolio audit complete. Maintain daily protein liquidity and keep net caloric deficit inside your Alpert oxidation ceiling to compound visceral fat equity.',
      capitalDirectives:
        Array.isArray(parsed.capitalDirectives) && parsed.capitalDirectives.length > 0
          ? parsed.capitalDirectives.slice(0, 4)
          : [
              `Hit ${proteinGoal}g daily protein liquidity across 3+ boluses to protect lean capital.`,
              `Target a daily caloric deficit near ${Math.round(alpertKcal * 0.7)} kcal (70% of Alpert ceiling).`,
              'Anchor 3 weekly progressive strength CapEx sessions to elevate glycogen sink capacity.',
            ],
      liabilityRisks:
        Array.isArray(parsed.liabilityRisks) && parsed.liabilityRisks.length > 0
          ? parsed.liabilityRisks.slice(0, 3)
          : [
              'Unlogged evening caloric drift eroding net fat-oxidation margin.',
              'Alcohol or seed-oil exposure triggering acute ADH fat-oxidation suppression.',
            ],
      receipt,
    };
  } catch (err) {
    if (mode === InferenceMode.ONLY_ON_DEVICE) {
      throw new SecPrivacyLockBlockedError(buildSecComplianceAlert());
    }
    throw err;
  }
}
