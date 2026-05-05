'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
         CartesianGrid, AreaChart, Area, Legend, ReferenceArea } from 'recharts';
import { Flame, BatteryCharging, Info, Activity, Zap, Microscope, TrendingUp, TrendingDown } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { FoodLogEntry, ExerciseLogEntry } from '@/lib/food-exercise-types';
import type { FitbitActivity } from '@/lib/health-service';
import { runMetabolicSimulation } from '@/lib/metabolic-engine';

interface DashboardChartsProps {
    caloriesIn: number;
    caloriesOut: number;
    carbsG: number;
    foodLogs?: FoodLogEntry[];
    exerciseLogs?: ExerciseLogEntry[];
    /** Morning muscle glycogen %, chained from previous day's end state. 100 for new users. */
    morningGlycogenPct?: number;
    /** From Firestore HealthData — used to size glycogen reservoir from lean mass. */
    weightKg?: number;
    /** 0–100, from DEXA or assessment. Improves glycogen capacity estimate. */
    bodyFatPct?: number;
    /** True when calorie burn data comes from Fitbit (−10% already applied). */
    isDeviceVerified?: boolean;
    /** True when showing today — enables the NOW line + projection shading. */
    isViewingToday?: boolean;
    /** Max sustainable fat oxidation kcal/day — shown as a ceiling on the Energy Balance chart. */
    alpertNumber?: number;
    /** Auto-detected Fitbit activities for this day — used as glycogen model fallback. */
    fitbitActivities?: FitbitActivity[];
    /** Heart Rate Variability. */
    hrv?: number;
    /** User supplement status. */
    hasCreatine?: boolean;
}

/** Liver glycogen capacity — fixed regardless of body size (~100g). */
export const LIVER_MAX_KCAL = 400; // 100g × 4 kcal/g

/**
 * Compute TOTAL glycogen reservoir (liver + muscle) from body composition.
 * Formula: lean_mass_kg × 15 g/kg (muscle) + 100 g (liver), capped 300–700 g.
 * Falls back to 500 g (2000 kcal) when no body comp is available.
 */
export function computeMaxGlycogenKcal(weightKg?: number, bodyFatPct?: number): number {
    if (!weightKg) return 2000;
    const bfFraction = bodyFatPct != null ? bodyFatPct / 100 : 0.25;
    const leanKg = weightKg * (1 - bfFraction);
    const glycogenG = Math.min(700, Math.max(300, Math.round(leanKg * 15 + 100)));
    return glycogenG * 4;
}

// 15-minute intraday glycogen simulation — 6 AM (slot 0) → midnight (slot 72) = 73 slots
const INTERVAL_MIN = 15;
const START_MIN = 6 * 60;   // 360
const END_MIN   = 24 * 60;  // 1440 — captures late-night exercise (e.g. 9 PM basketball)
const NUM_SLOTS = (END_MIN - START_MIN) / INTERVAL_MIN + 1; // 73

// X-axis ticks: 6 AM, 9 AM, 12 PM, 3 PM, 6 PM, 9 PM, midnight (shared across all charts)
const X_TICKS = [0, 12, 24, 36, 48, 60, 72];

// Carb/food absorption window: ~90 min = 6 × 15-min slots
const ABSORPTION_SLOTS = 6;

// Brain glucose demand (~120g/day) satisfied almost entirely from liver glycogen during waking hours.
// 120g × 4 kcal/g ÷ 16 h ÷ 4 slots/h ≈ 7.5 kcal per 15-min slot.
const LIVER_RESTING_BURN_PER_SLOT = (120 * 4) / 16 / (60 / INTERVAL_MIN); // ~7.5 kcal / slot

// Liver gets first 30g (120 kcal) of carbs from every meal — gluconeogenesis refuels liver priority.
const LIVER_CARB_PRIORITY_KCAL = 30 * 4; // 120 kcal

// Alcohol blocks gluconeogenesis via NAD+ depletion → liver forced to dump glycogen.
// Each drink (14g ethanol) ≈ 1h of blocked gluconeogenesis = ~30 kcal extra liver drain.
const LIVER_DRAIN_PER_DRINK_KCAL = 30;
const ALCOHOL_DRAIN_SLOTS = 4; // 1 hour spread

const MEAL_DEFAULT_MIN: Record<string, number> = {
    breakfast: 7  * 60,
    lunch:     12 * 60 + 30,
    dinner:    18 * 60 + 30,
    snack:     15 * 60,
};

const parseHHMM = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
};

const timeToSlot = (minFromMid: number): number =>
    Math.round((minFromMid - START_MIN) / INTERVAL_MIN);

const slotToTimeLabel = (slot: number): string => {
    const m = START_MIN + slot * INTERVAL_MIN;
    const h24 = Math.floor(m / 60) % 24; // normalize midnight (24→0)
    const min = m % 60;
    const h12 = h24 % 12 || 12;
    const ampm = h24 < 12 ? 'AM' : 'PM';
    return min === 0 ? `${h12} ${ampm}` : `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
};

/**
 * Simulate liver and muscle glycogen independently across the day.
 *
 * Liver:
 *   - Morning: 60% (overnight fast depletes ~40g to maintain blood glucose)
 *   - Resting burn: ~7.5 kcal/slot (brain glucose demand)
 *   - Exercise burn: 15% of glycolytic exercise load
 *   - Carb refuel: first 30g (120 kcal) per meal, priority
 *   - Alcohol drain: +30 kcal per drink (NAD+ depletion blocks gluconeogenesis)
 *
 * Muscle:
 *   - Morning: morningMusclePct (carried over from previous day — no overnight drain)
 *   - Resting burn: 0 (muscle lacks glucose-6-phosphatase; glycogen is biologically locked)
 *   - Exercise burn: 85% of glycolytic exercise load
 *   - Carb refuel: remaining carbs after liver priority
 *   - Alcohol drain: 0 direct effect (but impairs resynthesis — noted in UI)
 */
function buildGlycogenCurves(
    caloriesOut: number,
    carbsG: number,
    morningMusclePct: number,
    muscleMaxKcal: number,
    foodLogs?: FoodLogEntry[],
    exerciseLogs?: ExerciseLogEntry[],
    fitbitActivities?: FitbitActivity[],
): { slot: number; liver: number; muscle: number }[] {
    const liverExerciseBurn  = new Array(NUM_SLOTS).fill(0);
    const muscleExerciseBurn = new Array(NUM_SLOTS).fill(0);
    const liverCarbRefuel    = new Array(NUM_SLOTS).fill(0);
    const muscleCarbRefuel   = new Array(NUM_SLOTS).fill(0);
    const liverAlcoholDrain  = new Array(NUM_SLOTS).fill(0);

    // ── Exercise burns ──────────────────────────────────────────────────────────
    const activeLogs = exerciseLogs?.filter(e => !e.ignored) ?? [];
    // Only block the Fitbit fallback if at least one manual log actually has calorie data.
    // A log with 0 calories should fall through to Fitbit activities, not silently zero out.
    const activeLogsWithCalories = activeLogs.filter(e => (e.estimatedCaloriesBurned || 0) > 0);
    if (activeLogsWithCalories.length > 0) {
        for (const ex of activeLogsWithCalories) {
            const glycoCal = (ex.estimatedCaloriesBurned || 0) * 0.70; // ~70% of exercise from glycogen
            const dur       = Math.max(15, ex.durationMin || 30);
            const startMin  = ex.performedAt ? parseHHMM(ex.performedAt) : 12 * 60;
            const startSlot = Math.max(0, Math.min(NUM_SLOTS - 1, timeToSlot(startMin)));
            const numSlots  = Math.max(1, Math.round(dur / INTERVAL_MIN));
            const liverPerSlot  = (glycoCal * 0.15) / numSlots;
            const musclePerSlot = (glycoCal * 0.85) / numSlots;
            for (let s = startSlot; s < Math.min(startSlot + numSlots, NUM_SLOTS); s++) {
                liverExerciseBurn[s]  += liverPerSlot;
                muscleExerciseBurn[s] += musclePerSlot;
            }
        }
    } else if (fitbitActivities && fitbitActivities.length > 0) {
        // Glycolytic fractions by intensity tier (what % of calories comes from glycogen vs fat).
        // Walking is primarily fat-fuelled at normal pace (~10-15% glycolytic);
        // the old 0.40 value was far too high and caused spurious evening muscle drain
        // from Fitbit-detected walking after an intense workout.
        const TIER_GLYCO_FRACTION: Record<string, number> = {
            tier1_walking: 0.12,       // ~90% fat — casual walking barely touches glycogen
            tier2_steady_state: 0.55,  // mixed — aerobic threshold range
            tier3_anaerobic: 0.85,     // basketball/HIIT/lifting — heavily glycogen-dependent
        };
        const TIER_DISCOUNT: Record<string, number> = {
            tier1_walking: 1.0,
            tier2_steady_state: 0.80,
            tier3_anaerobic: 0.65,
        };
        for (const act of fitbitActivities) {
            const adjustedCal = Math.round(act.calories * (TIER_DISCOUNT[act.activityTier] ?? 0.80));
            const glycoFraction = TIER_GLYCO_FRACTION[act.activityTier] ?? 0.65;
            const glycoCal = adjustedCal * glycoFraction;
            if (glycoCal <= 0) continue;
            const dur = Math.max(15, act.durationMin);
            const startMin  = parseHHMM(act.startTime);
            const startSlot = Math.max(0, Math.min(NUM_SLOTS - 1, timeToSlot(startMin)));
            const numSlots  = Math.max(1, Math.round(dur / INTERVAL_MIN));
            const liverPerSlot  = (glycoCal * 0.15) / numSlots;
            const musclePerSlot = (glycoCal * 0.85) / numSlots;
            for (let s = startSlot; s < Math.min(startSlot + numSlots, NUM_SLOTS); s++) {
                liverExerciseBurn[s]  += liverPerSlot;
                muscleExerciseBurn[s] += musclePerSlot;
            }
        }
    } else {
        // Fallback 2: crude TDEE spread (no exercise data at all).
        const activeBurnGlyco = Math.max(0, caloriesOut - 2000) * 0.70;
        if (activeBurnGlyco > 0) {
            const activeSlots = NUM_SLOTS - 24;
            const liverPerSlot  = activeBurnGlyco * 0.15 / activeSlots;
            const musclePerSlot = activeBurnGlyco * 0.85 / activeSlots;
            for (let s = 24; s < NUM_SLOTS; s++) {
                liverExerciseBurn[s]  += liverPerSlot;
                muscleExerciseBurn[s] += musclePerSlot;
            }
        }
    }

    // ── Carb refueling + alcohol drain (per food log entry) ────────────────────
    const activeFoods = foodLogs?.filter(f => !f.ignored) ?? [];
    if (activeFoods.length > 0) {
        for (const food of activeFoods) {
            const carbKcal = (food.carbsG || 0) * 4;
            const eatMin    = food.consumedAt
                ? parseHHMM(food.consumedAt)
                : (MEAL_DEFAULT_MIN[food.meal] ?? 12 * 60);
            const startSlot = Math.max(0, Math.min(NUM_SLOTS - 1, timeToSlot(eatMin)));

            if (carbKcal > 0) {
                const liverKcal  = Math.min(LIVER_CARB_PRIORITY_KCAL, carbKcal);
                const muscleKcal = Math.max(0, carbKcal - LIVER_CARB_PRIORITY_KCAL);
                for (let s = startSlot; s < Math.min(startSlot + ABSORPTION_SLOTS, NUM_SLOTS); s++) {
                    liverCarbRefuel[s]  += liverKcal  / ABSORPTION_SLOTS;
                    muscleCarbRefuel[s] += muscleKcal / ABSORPTION_SLOTS;
                }
            }

            // Alcohol: NAD+ depletion forces liver glycogen dump
            const drinks = food.alcoholDrinks || 0;
            if (drinks > 0) {
                const totalDrain = drinks * LIVER_DRAIN_PER_DRINK_KCAL;
                for (let s = startSlot; s < Math.min(startSlot + ALCOHOL_DRAIN_SLOTS, NUM_SLOTS); s++) {
                    liverAlcoholDrain[s] += totalDrain / ALCOHOL_DRAIN_SLOTS;
                }
            }
        }
    } else {
        // Fallback: spread daily carb total — liver gets first 30g, rest to muscle
        const totalCarbKcal   = carbsG * 4;
        const liverCarbKcal   = Math.min(LIVER_CARB_PRIORITY_KCAL, totalCarbKcal);
        const muscleCarbKcal  = Math.max(0, totalCarbKcal - LIVER_CARB_PRIORITY_KCAL);
        // Liver carbs: 40% morning, 40% midday, 20% evening
        const noonSlot = 24;
        const pm6Slot  = 48;
        if (liverCarbKcal > 0) {
            const p1 = liverCarbKcal * 0.40 / noonSlot;
            for (let s = 0; s < noonSlot; s++)              liverCarbRefuel[s]  += p1;
            const p2 = liverCarbKcal * 0.40 / (pm6Slot - noonSlot);
            for (let s = noonSlot; s < pm6Slot; s++)        liverCarbRefuel[s]  += p2;
            const p3 = liverCarbKcal * 0.20 / (NUM_SLOTS - pm6Slot);
            for (let s = pm6Slot; s < NUM_SLOTS; s++)       liverCarbRefuel[s]  += p3;
        }
        // Muscle carbs: 20% morning, 40% midday, 40% evening
        if (muscleCarbKcal > 0) {
            const p1 = muscleCarbKcal * 0.20 / noonSlot;
            for (let s = 0; s < noonSlot; s++)              muscleCarbRefuel[s] += p1;
            const p2 = muscleCarbKcal * 0.40 / (pm6Slot - noonSlot);
            for (let s = noonSlot; s < pm6Slot; s++)        muscleCarbRefuel[s] += p2;
            const p3 = muscleCarbKcal * 0.40 / (NUM_SLOTS - pm6Slot);
            for (let s = pm6Slot; s < NUM_SLOTS; s++)       muscleCarbRefuel[s] += p3;
        }
    }

    // ── Slot-by-slot simulation ─────────────────────────────────────────────────
    const result: { slot: number; liver: number; muscle: number }[] = [];
    // Liver: 60% morning — standard after overnight fast (brain used ~40g of 100g overnight)
    let liverCurrent  = LIVER_MAX_KCAL * 0.60;
    let muscleCurrent = muscleMaxKcal  * (morningMusclePct / 100);

    for (let s = 0; s < NUM_SLOTS; s++) {
        liverCurrent = Math.max(0, Math.min(LIVER_MAX_KCAL,
            liverCurrent
            - LIVER_RESTING_BURN_PER_SLOT
            - liverExerciseBurn[s]
            - liverAlcoholDrain[s]
            + liverCarbRefuel[s]
        ));
        muscleCurrent = Math.max(0, Math.min(muscleMaxKcal,
            muscleCurrent
            - muscleExerciseBurn[s]
            + muscleCarbRefuel[s]
        ));
        result.push({
            slot:   s,
            liver:  Math.round((liverCurrent  / LIVER_MAX_KCAL) * 100),
            muscle: Math.round((muscleCurrent / muscleMaxKcal)  * 100),
        });
    }
    return result;
}

export function DashboardCharts({
    caloriesIn = 0, caloriesOut = 2000, carbsG = 0,
    foodLogs, exerciseLogs,
    morningGlycogenPct = 100,
    weightKg, bodyFatPct,
    isDeviceVerified,
    isViewingToday = false,
    alpertNumber,
    fitbitActivities,
    hrv,
    hasCreatine,
}: DashboardChartsProps) {
    const [isLabMode, setIsLabMode] = React.useState(false);
    const totalMaxKcal    = computeMaxGlycogenKcal(weightKg, bodyFatPct);
    const muscleMaxKcal   = Math.max(400, totalMaxKcal - LIVER_MAX_KCAL);
    const muscleCapacityG = Math.round(muscleMaxKcal / 4);

    const deficit = caloriesIn - caloriesOut;

    // Total alcohol drinks today (for the UI note)
    const totalAlcoholDrinks = React.useMemo(() =>
        (foodLogs ?? []).reduce((sum, f) => sum + (!f.ignored ? (f.alcoholDrinks || 0) : 0), 0),
        [foodLogs],
    );

    const calorieData = [
        { name: 'Intake',  value: caloriesIn,        color: '#10b981' },
        { name: 'Burned',  value: caloriesOut,        color: '#f97316' },
        { name: 'Deficit', value: Math.abs(deficit),  color: deficit > 0 ? '#ef4444' : '#3b82f6' },
    ];

    // Run the shared metabolic simulation
    const simulationResult = React.useMemo(() => {
        // If no alpert number, we can't run the full partitioning model,
        // so we fall back to the simpler glycogen-only simulation.
        if (!alpertNumber || alpertNumber <= 0) return null;

        return runMetabolicSimulation({
            caloriesOut,
            alpertNumber,
            foodLogs,
            exerciseLogs,
            fitbitActivities,
            caloriesIn,
            morningGlycogenPct,
            muscleGlycogenMaxKcal: muscleMaxKcal,
            liverGlycogenStartKcal: LIVER_MAX_KCAL * 0.60, // Start at 60% (overnight fast)
            hrv,
            hasCreatine,
            weightKg,
            bodyFatPct,
        });
    }, [caloriesOut, alpertNumber, foodLogs, exerciseLogs, fitbitActivities, caloriesIn, morningGlycogenPct, muscleMaxKcal, hrv, hasCreatine, weightKg, bodyFatPct]);

    // Format data for the main Glycogen Reserves chart
    const glycogenData = React.useMemo(() => {
        if (simulationResult) {
            return simulationResult.slots.map(s => ({
                slot: s.slot,
                liver: Math.round((s.liverKcal / LIVER_MAX_KCAL) * 100),
                muscle: Math.round((s.muscleGlycogenKcal / muscleMaxKcal) * 100),
            }));
        }
        // Legacy fallback
        return buildGlycogenCurves(caloriesOut, carbsG, morningGlycogenPct, muscleMaxKcal, foodLogs, exerciseLogs, fitbitActivities);
    }, [simulationResult, caloriesOut, carbsG, morningGlycogenPct, muscleMaxKcal, foodLogs, exerciseLogs, fitbitActivities]);

    // Format data for the Metabolic Buckets section
    const bucketData = React.useMemo(() => {
        if (!simulationResult || !alpertNumber) return [];
        return simulationResult.slots.map(s => {
            const muscleShieldPct = Math.max(0, 100 - (s.cumulativeMuscleLost / (alpertNumber * 0.1)) * 100);
            return {
                slot:                    s.slot,
                gutKcal:                 s.gutKcal,
                liverKcal:               s.liverKcal,
                fatAllowanceKcal:        s.fatAllowanceRemaining,
                muscleShieldPct:         Math.round(muscleShieldPct),
                cumulativeFatBurned:     s.cumulativeFatBurned,
                cumulativeFatStored:     s.cumulativeFatStored,
                cumulativeMuscleLost:    s.cumulativeMuscleLost,
                cumulativeGlycogenDrawn: s.cumulativeGlycogenDrawn,
                insulinLevel:            s.insulinLevel,
                fatOxEfficiency:         s.fatOxEfficiency,
                caffeineLevel:           s.caffeineLevel,
                totalOmega3Mg:           simulationResult.totalOmega3Mg,
            };
        });
    }, [simulationResult, alpertNumber]);

    // Slot index for the current time — null when viewing a past/future date or outside chart hours
    const nowSlot = React.useMemo(() => {
        if (!isViewingToday) return null;
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const slot = Math.round((nowMin - START_MIN) / INTERVAL_MIN);
        if (slot <= 0 || slot >= NUM_SLOTS - 1) return null; // before 6 AM or after 10 PM
        return slot;
    }, [isViewingToday]);

    const last            = glycogenData[glycogenData.length - 1];
    const currentGlycogen = nowSlot != null ? glycogenData[nowSlot] : last;
    const displayLiverPct     = currentGlycogen.liver;
    const displayMusclePct    = currentGlycogen.muscle;
    const displayLiverKcal    = Math.round((displayLiverPct  / 100) * LIVER_MAX_KCAL);
    const displayMuscleKcal   = Math.round((displayMusclePct / 100) * muscleMaxKcal);

    return (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* ── Energy Balance ─────────────────────────────────────────────── */}
            <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
                <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-orange-100 rounded-lg">
                            <Flame className="w-5 h-5 text-orange-500" />
                        </div>
                        <CardTitle className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">Energy Balance</CardTitle>
                    </div>
                    <CardDescription className="text-xs font-medium">Daily Calorie Intake vs Expenditure</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[200px] w-full mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={calorieData} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                                <Tooltip
                                    cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <ReferenceLine y={0} stroke="#000" />
                                {alpertNumber != null && alpertNumber > 0 && (
                                    <ReferenceLine
                                        y={alpertNumber}
                                        stroke="#dc2626"
                                        strokeDasharray="6 3"
                                        strokeWidth={1.5}
                                        label={{ value: `Alpert max ${alpertNumber}`, position: 'insideTopLeft', fontSize: 8, fontWeight: 800, fill: '#dc2626' }}
                                    />
                                )}
                                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                    {calorieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex justify-between items-center mt-4">
                        <div className="text-center">
                            <p className="text-[10px] font-black uppercase text-muted-foreground">In</p>
                            <p className="text-lg font-black text-emerald-600">{caloriesIn} <span className="text-xs font-medium text-emerald-600/60">kcal</span></p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-black uppercase text-muted-foreground">Out</p>
                            <p className="text-lg font-black text-orange-500">{caloriesOut} <span className="text-xs font-medium text-orange-500/60">kcal</span></p>
                            {isDeviceVerified && (
                                <p className="text-[8px] font-bold text-muted-foreground/60 mt-0.5">Fitbit −10% adj.</p>
                            )}
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-black uppercase text-muted-foreground">Net</p>
                            <p className={`text-lg font-black ${deficit > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                                {deficit > 0 ? '+' : ''}{deficit} <span className="text-xs font-medium opacity-60">kcal</span>
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ── Glycogen Reserves ──────────────────────────────────────────── */}
            <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
                <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <BatteryCharging className="w-5 h-5 text-blue-500" />
                        </div>
                        <CardTitle className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">Glycogen Reserves</CardTitle>
                        <TooltipProvider delayDuration={200}>
                            <UITooltip>
                                <TooltipTrigger asChild>
                                    <Info className="w-3.5 h-3.5 text-muted-foreground/50 cursor-help shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[280px] text-xs leading-relaxed">
                                    <p className="font-black uppercase tracking-wide mb-1">What is glycogen?</p>
                                    <p>Glycogen is your body&apos;s fast-access carbohydrate fuel — stored glucose in your liver and muscles.</p>
                                    <p className="mt-1.5"><span className="font-bold text-orange-400">Liver (100g):</span> Maintains blood sugar between meals. Drained by overnight fasting, alcohol, and rest. Refuelled by carbs (priority).</p>
                                    <p className="mt-1.5"><span className="font-bold text-blue-400">Muscle (~{muscleCapacityG}g):</span> Powers high-intensity effort — sprints, lifts, intervals. Biologically locked at rest; only exercise burns it. Alcohol doesn&apos;t drain it directly but impairs resynthesis.</p>
                                    <p className="mt-1.5 opacity-70 italic">Estimated model — not medical advice.</p>
                                </TooltipContent>
                            </UITooltip>
                        </TooltipProvider>
                    </div>
                    <CardDescription className="text-xs font-medium">
                        Liver (100g) + Muscle (~{muscleCapacityG}g) · Estimated · Not medical advice
                        {nowSlot != null && <span className="text-muted-foreground/60"> · dashed line = now, shaded = projected</span>}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[200px] w-full mt-2">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={glycogenData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorLiver" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#f97316" stopOpacity={0.5} />
                                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorMuscle" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                <XAxis
                                    dataKey="slot"
                                    type="number"
                                    domain={[0, NUM_SLOTS - 1]}
                                    ticks={X_TICKS}
                                    tickFormatter={slotToTimeLabel}
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 9, fontWeight: 700 }}
                                />
                                <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 10 }} unit="%" />
                                <Tooltip
                                    labelFormatter={(slot) => slotToTimeLabel(slot as number)}
                                    formatter={(value, name) => [
                                        `${value}%`,
                                        name === 'liver' ? 'Liver' : 'Muscle',
                                    ]}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Legend
                                    formatter={(value) => (
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                            {value === 'liver' ? 'Liver' : 'Muscle'}
                                        </span>
                                    )}
                                />
                                {/* Projection zone — shaded region after current time */}
                                {nowSlot != null && (
                                    <ReferenceArea
                                        x1={nowSlot}
                                        x2={NUM_SLOTS - 1}
                                        fill="#94a3b8"
                                        fillOpacity={0.07}
                                        stroke="none"
                                    />
                                )}
                                {/* NOW line */}
                                {nowSlot != null && (
                                    <ReferenceLine
                                        x={nowSlot}
                                        stroke="#475569"
                                        strokeDasharray="4 3"
                                        strokeWidth={1.5}
                                        label={{ value: 'NOW', position: 'insideTopRight', fontSize: 8, fontWeight: 800, fill: '#475569', offset: 4 }}
                                    />
                                )}
                                <Area
                                    type="monotone"
                                    dataKey="liver"
                                    stroke="#ea580c"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorLiver)"
                                    dot={false}
                                    name="liver"
                                />
                                <Area
                                    type="monotone"
                                    dataKey="muscle"
                                    stroke="#2563eb"
                                    strokeWidth={2.5}
                                    fillOpacity={1}
                                    fill="url(#colorMuscle)"
                                    dot={false}
                                    name="muscle"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Current stats */}
                    <div className="flex justify-around items-end mt-3">
                        <div className="text-center">
                            <p className="text-[9px] font-black uppercase text-orange-500/70 tracking-widest">Liver</p>
                            <p className="text-base font-black text-orange-500">{displayLiverPct}%</p>
                            <p className="text-[9px] font-bold text-muted-foreground">{displayLiverKcal} kcal</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[9px] font-black uppercase text-blue-500/70 tracking-widest">Muscle</p>
                            <p className="text-base font-black text-blue-600">{displayMusclePct}%</p>
                            <p className="text-[9px] font-bold text-muted-foreground">{displayMuscleKcal} kcal</p>
                        </div>
                    </div>

                    {/* Alcohol warning */}
                    {totalAlcoholDrinks > 0 && (
                        <p className="text-[9px] font-bold text-orange-600/80 mt-2 leading-relaxed">
                            ⚠ {totalAlcoholDrinks} drink{totalAlcoholDrinks > 1 ? 's' : ''} logged — liver shown with accelerated glycogen drain (NAD⁺ depletion). Muscle stores unaffected directly but resynthesis is impaired.
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>

        {/* Metabolic Lab Toggle */}
        <div className="flex items-center justify-end gap-2 mt-8 px-2">
            <div className="flex items-center space-x-2 bg-primary/5 px-3 py-1.5 rounded-full ring-1 ring-primary/10">
                <Microscope className="w-3.5 h-3.5 text-primary/60" />
                <Label htmlFor="lab-mode" className="text-[10px] font-black uppercase tracking-widest text-primary/70 cursor-pointer">Metabolic Lab</Label>
                <Switch
                    id="lab-mode"
                    checked={isLabMode}
                    onCheckedChange={setIsLabMode}
                    className="data-[state=checked]:bg-primary"
                />
            </div>
        </div>

        {/* Metabolic Buckets View */}
        {alpertNumber != null && alpertNumber > 0 && (
            <MetabolicBucketsView
                bucketData={bucketData}
                alpertNumber={alpertNumber}
                nowSlot={nowSlot}
                isLabMode={isLabMode}
                hrv={hrv}
            />
        )}
        </>
    );
}

// ─── Metabolic Bucket Curves ────────────────────────────────────────────────

interface BucketSlot {
    slot: number;
    /** Food calories still in the gut (unabsorbed). */
    gutKcal: number;
    /** Liver glycogen kcal — taken from the metabolic engine simulation. */
    liverKcal: number;
    /** Alpert fat-oxidation budget remaining today (starts at alpertNumber). */
    fatAllowanceKcal: number;
    /** Lean tissue shield 0–100 % (100 = fully intact). */
    muscleShieldPct: number;
    /** Running total of kcal burned sustainably from fat. */
    cumulativeFatBurned: number;
    /** Running total of kcal lost from lean tissue (all fuel sources exhausted). */
    cumulativeMuscleLost: number;
    /** Running total of kcal drawn from liver + muscle glycogen (bridges deficit when fat faucet paused). */
    cumulativeGlycogenDrawn: number;
    /** Insulin level 0-1. */
    insulinLevel: number;
    /** Fat oxidation efficiency 0-1. */
    fatOxEfficiency: number;
    /** Caffeine level in mg. */
    caffeineLevel: number;
    /** Total Omega-3 mg for the day. */
    totalOmega3Mg: number;
}

/**
 * Delegates to the shared MetabolicEngine for correct 4-bucket sequential drain:
 *   Gut → Fat Faucet (rate-limited, paused while gut non-empty) → Liver → Muscle
 */

// ─── Metabolic Buckets View ──────────────────────────────────────────────────

interface MetabolicBucketsViewProps {
    bucketData: BucketSlot[];
    alpertNumber: number;
    nowSlot: number | null;
    isLabMode?: boolean;
    hrv?: number;
}

/** Single vertical gauge card used in the top row. */
function BucketGauge({
    title, subtitle, value, max, fillColor, textColor, formatValue,
}: {
    title: string;
    subtitle: string;
    value: number;
    max: number;
    fillColor: string;
    textColor: string;
    formatValue: (v: number) => string;
}) {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    return (
        <div className="flex flex-col items-center gap-1 w-full">
            <p className={`text-[9px] font-black uppercase tracking-widest ${textColor} text-center min-h-[28px] flex items-center justify-center w-full leading-tight`}>{title}</p>
            <p className="text-[8px] font-bold text-muted-foreground/60 text-center leading-tight min-h-[20px] flex items-center justify-center w-full">{subtitle}</p>
            <div 
                className="relative w-full h-28 rounded-xl overflow-hidden bg-muted/30 border border-border/40"
                style={{ isolation: 'isolate' }}
            >
                <div
                    className={`absolute bottom-0 left-0 right-0 transition-all duration-700 ${fillColor}`}
                    style={{ height: `${pct}%`, transform: 'translateZ(0)' }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[10px] font-black text-foreground/80 drop-shadow-sm">
                        {formatValue(value)}
                    </span>
                </div>
            </div>
        </div>
    );
}

export function MetabolicBucketsView({
    bucketData, alpertNumber, nowSlot, isLabMode, hrv,
}: MetabolicBucketsViewProps) {

    const current = nowSlot != null ? bucketData[nowSlot] : bucketData[bucketData.length - 1];
    const last     = bucketData[bucketData.length - 1];

    // Max values for gauge scaling
    const maxGut = Math.max(400, ...bucketData.map(d => d.gutKcal));
    const maxInsulin = Math.max(1, ...bucketData.map(d => d.insulinLevel));
    const maxCaffeine = Math.max(100, ...bucketData.map(d => d.caffeineLevel));
    const maxAnabolic = Math.max(1.0, ...bucketData.map(d => d.anabolicSignal));
    const maxO3 = Math.max(2000, current.totalOmega3Mg);

    // Dynamic Insight Logic
    let engineStatus = "Nominal";
    let statusColor = "text-blue-500";
    let statusDesc = "Standard metabolic partitioning.";

    if (current.insulinLevel > 0.5) {
        engineStatus = "Storage Active";
        statusColor = "text-indigo-600";
        statusDesc = "Insulin levels are high. Fat oxidation is currently suppressed.";
    } else if (current.caffeineLevel > 50 && current.fatOxEfficiency > 1.0) {
        engineStatus = "Stimulated Burn";
        statusColor = "text-amber-600";
        statusDesc = "Caffeine is boosting your fat oxidation rate.";
    } else if (current.fatOxEfficiency < 0.9 && hrv && hrv < 30) {
        engineStatus = "Recovery Tax";
        statusColor = "text-red-500";
        statusDesc = "Low HRV is imposing a metabolic tax on efficiency.";
    } else if (current.insulinLevel < 0.1 && current.gutKcal < 50) {
        engineStatus = "Primary Fat Burn";
        statusColor = "text-emerald-600";
        statusDesc = "Hormones are clear. Your engine is primarily fueled by fat.";
    }

    const hrvStatus = hrv ? (hrv < 30 ? 'tax' : hrv > 80 ? 'bonus' : 'neutral') : 'neutral';
    const hrvColor = hrvStatus === 'tax' ? 'text-red-500' : hrvStatus === 'bonus' ? 'text-emerald-500' : 'text-blue-500';
    const hrvBg = hrvStatus === 'tax' ? 'bg-red-50' : hrvStatus === 'bonus' ? 'bg-emerald-50' : 'bg-blue-50';

    return (
        <div className="mt-6 space-y-6">
            {/* ── Engine Status & Recovery (Lab Mode Only) ─────────────────── */}
            {isLabMode && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 bg-primary/5 rounded-xl`}>
                                    <Zap className={`w-6 h-6 text-primary`} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Engine Status</p>
                                    <p className={`text-xl font-black ${statusColor}`}>{engineStatus}</p>
                                    <p className="text-[10px] font-medium text-muted-foreground leading-tight mt-0.5">{statusDesc}</p>
                                    {isLabMode && current.anabolicSignal > 0.5 && (
                                        <p className="text-[10px] font-bold text-emerald-600 mt-1 uppercase tracking-tighter">Anabolic Window Active</p>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {hrv && (
                        <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-3 ${hrvBg} rounded-xl`}>
                                            <Activity className={`w-6 h-6 ${hrvColor}`} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Recovery (HRV)</p>
                                            <p className={`text-xl font-black ${hrvColor}`}>{hrv} <span className="text-xs font-medium opacity-60">ms</span></p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Multiplier</p>
                                        <p className={`text-xl font-black ${hrvColor}`}>
                                            {hrvStatus === 'bonus' ? '1.10x' : hrvStatus === 'tax' ? '0.85x' : '1.00x'}
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}

            {/* ── Bucket Gauges ──────────────────────────────────────────────── */}
            <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
                <CardHeader className="pb-2">
                    <CardTitle className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">
                        {isLabMode ? 'Engine Diagnostics' : 'Metabolic Reserves'}
                    </CardTitle>
                    <CardDescription className="text-xs font-medium">
                        {isLabMode ? 'Advanced physiological modeling' : 'Current energy bucket levels · Estimated model'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className={`grid ${isLabMode ? 'grid-cols-3' : 'grid-cols-4'} gap-3`}>
                        {!isLabMode && (
                            <BucketGauge
                                title="Gut / Exog."
                                subtitle="In Transit"
                                value={current.gutKcal}
                                max={maxGut}
                                fillColor="bg-gradient-to-t from-blue-500 to-blue-400"
                                textColor="text-blue-500"
                                formatValue={v => `${Math.round(v)} kcal`}
                            />
                        )}
                        {!isLabMode && (
                            <BucketGauge
                                title="Liver Glycogen"
                                subtitle="400 kcal max"
                                value={current.liverKcal}
                                max={LIVER_MAX_KCAL}
                                fillColor="bg-gradient-to-t from-orange-500 to-orange-400"
                                textColor="text-orange-500"
                                formatValue={v => `${v} kcal`}
                            />
                        )}
                        {isLabMode && (
                            <BucketGauge
                                title="Insulin Load"
                                subtitle="Lipolysis Suppression"
                                value={current.insulinLevel * 100}
                                max={100}
                                fillColor="bg-gradient-to-t from-indigo-500 to-indigo-400"
                                textColor="text-indigo-500"
                                formatValue={v => `${Math.round(v)}%`}
                            />
                        )}
                        {isLabMode && (
                            <BucketGauge
                                title="Efficiency"
                                subtitle="Fat-Ox Rate"
                                value={current.fatOxEfficiency * 100}
                                max={120}
                                fillColor="bg-gradient-to-t from-emerald-500 to-emerald-400"
                                textColor="text-emerald-600"
                                formatValue={v => `${Math.round(v)}%`}
                            />
                        )}
                        {isLabMode && (
                            <BucketGauge
                                title="Caffeine"
                                subtitle="Active Stim"
                                value={current.caffeineLevel}
                                max={maxCaffeine}
                                fillColor="bg-gradient-to-t from-amber-600 to-amber-500"
                                textColor="text-amber-700"
                                formatValue={v => `${v} mg`}
                            />
                        )}
                         {isLabMode && (
                             <BucketGauge
                                 title="Anabolic Signal"
                                 subtitle="MPS Potential"
                                 value={current.anabolicSignal * 100}
                                 max={100}
                                 fillColor="bg-gradient-to-t from-emerald-600 to-emerald-400"
                                 textColor="text-emerald-700"
                                 formatValue={v => `${Math.round(v)}%`}
                             />
                         )}
                         {isLabMode && (
                             <BucketGauge
                                 title="Omega-3"
                                subtitle="Sensitivity Signal"
                                value={current.totalOmega3Mg}
                                max={maxO3}
                                fillColor="bg-gradient-to-t from-cyan-500 to-cyan-400"
                                textColor="text-cyan-600"
                                formatValue={v => `${v} mg`}
                            />
                        )}
                        {!isLabMode && (
                            <BucketGauge
                                title="Fat Allowance"
                                subtitle="Alpert budget left"
                                value={current.fatAllowanceKcal}
                                max={alpertNumber}
                                fillColor="bg-gradient-to-t from-emerald-500 to-emerald-400"
                                textColor="text-emerald-600"
                                formatValue={v => `${v} kcal`}
                            />
                        )}
                        {!isLabMode && (
                            <BucketGauge
                                title="Muscle Shield"
                                subtitle="Lean Tissue"
                                value={current.muscleShieldPct}
                                max={100}
                                fillColor="bg-gradient-to-t from-red-500 to-red-400"
                                textColor="text-red-500"
                                formatValue={v => `${Math.round(v)}% intact`}
                            />
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* ── Lab Charts ────────────────────────────────────────────────── */}
            {isLabMode && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">Hormonal Curve</CardTitle>
                            <CardDescription className="text-xs font-medium">Insulin response to carbohydrate intake</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[200px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={bucketData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="gradInsulin" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                        <XAxis dataKey="slot" type="number" domain={[0, NUM_SLOTS - 1]} ticks={X_TICKS} tickFormatter={slotToTimeLabel} axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} domain={[0, 1]} />
                                        <Tooltip labelFormatter={(slot) => slotToTimeLabel(slot as number)} formatter={(v) => [`${Math.round(Number(v) * 100)}%`, 'Insulin Level']} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                        {nowSlot != null && <ReferenceLine x={nowSlot} stroke="#475569" strokeDasharray="4 3" strokeWidth={1.5} />}
                                        <Area type="monotone" dataKey="insulinLevel" stroke="#6366f1" strokeWidth={2.5} fill="url(#gradInsulin)" dot={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">Lipolysis Efficiency</CardTitle>
                            <CardDescription className="text-xs font-medium">Real-time fat oxidation rate capacity</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[200px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={bucketData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="gradEff" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                        <XAxis dataKey="slot" type="number" domain={[0, NUM_SLOTS - 1]} ticks={X_TICKS} tickFormatter={slotToTimeLabel} axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} domain={[0, 1.2]} />
                                        <Tooltip labelFormatter={(slot) => slotToTimeLabel(slot as number)} formatter={(v) => [`${Math.round(Number(v) * 100)}%`, 'Efficiency']} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                        {nowSlot != null && <ReferenceLine x={nowSlot} stroke="#475569" strokeDasharray="4 3" strokeWidth={1.5} />}
                                        <Area type="monotone" dataKey="fatOxEfficiency" stroke="#10b981" strokeWidth={2.5} fill="url(#gradEff)" dot={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">Anabolic Signal</CardTitle>
                                <CardDescription className="text-xs font-medium text-emerald-600 font-bold">Daily Potential: {(result.totalAnabolicPotential / 4).toFixed(1)} pts</CardDescription>
                            </div>
                            <Zap className="w-4 h-4 text-emerald-500 animate-pulse" />
                        </CardHeader>
                        <CardContent>
                            <div className="h-[200px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={bucketData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="gradAnabolic" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#059669" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                        <XAxis dataKey="slot" type="number" domain={[0, NUM_SLOTS - 1]} ticks={X_TICKS} tickFormatter={slotToTimeLabel} axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} domain={[0, 1.0]} />
                                        <Tooltip labelFormatter={(slot) => slotToTimeLabel(slot as number)} formatter={(v) => [`${Math.round(Number(v) * 100)}%`, 'MPS Intensity']} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                        {nowSlot != null && <ReferenceLine x={nowSlot} stroke="#475569" strokeDasharray="4 3" strokeWidth={1.5} />}
                                        <Area type="monotone" dataKey="anabolicSignal" stroke="#059669" strokeWidth={2.5} fill="url(#gradAnabolic)" dot={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* ── Bucket Drain Chart ──────────────────────────────────────────── */}
            <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
                <CardHeader className="pb-2">
                    <CardTitle className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">
                        Calories Remaining in Bucket
                    </CardTitle>
                    <CardDescription className="text-xs font-medium">
                        How each reservoir fills and drains through the day
                        {nowSlot != null && <span className="text-muted-foreground/60"> · dashed = now, shaded = projected</span>}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[220px] w-full mt-2">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={bucketData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gradGut" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="gradLiver" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#f97316" stopOpacity={0.5} />
                                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="gradFat" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#10b981" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="gradMuscle" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                <XAxis
                                    dataKey="slot"
                                    type="number"
                                    domain={[0, NUM_SLOTS - 1]}
                                    ticks={X_TICKS}
                                    tickFormatter={slotToTimeLabel}
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 9, fontWeight: 700 }}
                                />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                                <Tooltip
                                    labelFormatter={(slot) => slotToTimeLabel(slot as number)}
                                    formatter={(value, name) => {
                                        const labels: Record<string, string> = {
                                            gutKcal: 'Gut', liverKcal: 'Liver Glycogen',
                                            fatAllowanceKcal: 'Fat Allowance', muscleShieldPct: 'Muscle Shield',
                                        };
                                        const unit = name === 'muscleShieldPct' ? '%' : ' kcal';
                                        return [`${value}${unit}`, labels[name as string] ?? name];
                                    }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Legend formatter={(value) => {
                                    const labels: Record<string, string> = {
                                        gutKcal: 'Gut / Exog.', liverKcal: 'Liver Glycogen',
                                        fatAllowanceKcal: 'Fat Allowance', muscleShieldPct: 'Muscle Shield %',
                                    };
                                    return <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{labels[value] ?? value}</span>;
                                }} />
                                {nowSlot != null && (
                                    <ReferenceArea x1={nowSlot} x2={NUM_SLOTS - 1} fill="#94a3b8" fillOpacity={0.07} stroke="none" />
                                )}
                                {nowSlot != null && (
                                    <ReferenceLine x={nowSlot} stroke="#475569" strokeDasharray="4 3" strokeWidth={1.5}
                                        label={{ value: 'NOW', position: 'insideTopRight', fontSize: 8, fontWeight: 800, fill: '#475569', offset: 4 }}
                                    />
                                )}
                                <Area type="monotone" dataKey="gutKcal"          stroke="#3b82f6" strokeWidth={2} fill="url(#gradGut)"    dot={false} />
                                <Area type="monotone" dataKey="liverKcal"        stroke="#ea580c" strokeWidth={2} fill="url(#gradLiver)"  dot={false} />
                                <Area type="monotone" dataKey="fatAllowanceKcal" stroke="#10b981" strokeWidth={2.5} fill="url(#gradFat)"  dot={false} />
                                <Area type="monotone" dataKey="muscleShieldPct"  stroke="#ef4444" strokeWidth={1.5} fill="url(#gradMuscle)" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* ── Cumulative Ledger ──────────────────────────────────────────── */}
            <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
                <CardHeader className="pb-2">
                    <CardTitle className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">
                        Cumulative Ledger: Fat vs Muscle
                    </CardTitle>
                    <CardDescription className="text-xs font-medium">
                        Fat burned (ledger points) vs lean tissue lost · Ideal = red line stays flat
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[180px] w-full mt-2">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={bucketData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gradFatCumul" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="gradFatStored" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="gradMuscleCumul" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="gradGlycoCumul" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                <XAxis
                                    dataKey="slot"
                                    type="number"
                                    domain={[0, NUM_SLOTS - 1]}
                                    ticks={X_TICKS}
                                    tickFormatter={slotToTimeLabel}
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 9, fontWeight: 700 }}
                                />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                                <Tooltip
                                    labelFormatter={(slot) => slotToTimeLabel(slot as number)}
                                    formatter={(value, name) => {
                                        const labels: Record<string, string> = {
                                            cumulativeFatBurned: 'Fat Burned',
                                            cumulativeFatStored: 'Fat Stored',
                                            cumulativeMuscleLost: 'Muscle Lost',
                                            cumulativeGlycogenDrawn: 'Glycogen Drawn',
                                        };
                                        return [`${value} kcal`, labels[name as string] ?? name];
                                    }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Legend formatter={(value) => {
                                    const labels: Record<string, string> = {
                                        cumulativeFatBurned: 'Fat Burned',
                                        cumulativeFatStored: 'Fat Stored',
                                        cumulativeMuscleLost: 'Muscle Lost',
                                        cumulativeGlycogenDrawn: 'Glycogen Drawn',
                                    };
                                    return <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{labels[value] ?? value}</span>;
                                }} />
                                {nowSlot != null && (
                                    <ReferenceArea x1={nowSlot} x2={NUM_SLOTS - 1} fill="#94a3b8" fillOpacity={0.07} stroke="none" />
                                )}
                                {nowSlot != null && (
                                    <ReferenceLine x={nowSlot} stroke="#475569" strokeDasharray="4 3" strokeWidth={1.5} />
                                )}
                                <Area type="monotone" dataKey="cumulativeFatBurned"     stroke="#10b981" strokeWidth={2.5} fill="url(#gradFatCumul)"    dot={false} name="cumulativeFatBurned" />
                                <Area type="monotone" dataKey="cumulativeGlycogenDrawn" stroke="#8b5cf6" strokeWidth={2}   fill="url(#gradGlycoCumul)"  dot={false} name="cumulativeGlycogenDrawn" />
                                <Area type="monotone" dataKey="cumulativeFatStored"     stroke="#f59e0b" strokeWidth={2}   fill="url(#gradFatStored)"   dot={false} name="cumulativeFatStored" />
                                <Area type="monotone" dataKey="cumulativeMuscleLost"    stroke="#ef4444" strokeWidth={2}   fill="url(#gradMuscleCumul)" dot={false} name="cumulativeMuscleLost" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    {/* End-of-day summary */}
                    <div className="grid grid-cols-4 gap-2 mt-3">
                        <div className="text-center">
                            <p className="text-[9px] font-black uppercase text-emerald-600/70 tracking-widest">Fat Burned</p>
                            <p className="text-base font-black text-emerald-600">{last.cumulativeFatBurned}</p>
                            <p className="text-[9px] font-bold text-muted-foreground">kcal</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[9px] font-black uppercase text-violet-500/70 tracking-widest">Glycogen</p>
                            <p className="text-base font-black text-violet-500">{last.cumulativeGlycogenDrawn}</p>
                            <p className="text-[9px] font-bold text-muted-foreground">kcal drawn</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[9px] font-black uppercase text-amber-500/70 tracking-widest">Fat Stored</p>
                            <p className="text-base font-black text-amber-500">{last.cumulativeFatStored}</p>
                            <p className="text-[9px] font-bold text-muted-foreground">kcal</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[9px] font-black uppercase text-red-500/70 tracking-widest">Muscle Lost</p>
                            <p className="text-base font-black text-red-500">{last.cumulativeMuscleLost}</p>
                            <p className="text-[9px] font-bold text-muted-foreground">kcal</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
