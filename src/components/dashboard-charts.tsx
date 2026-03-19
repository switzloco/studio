'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
         CartesianGrid, AreaChart, Area, Legend } from 'recharts';
import { Flame, BatteryCharging } from 'lucide-react';
import type { FoodLogEntry, ExerciseLogEntry } from '@/lib/food-exercise-types';

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

// 15-minute intraday glycogen simulation — 6 AM (slot 0) → 10 PM (slot 64) = 65 slots
const INTERVAL_MIN = 15;
const START_MIN = 6 * 60;   // 360
const END_MIN   = 22 * 60;  // 1320
const NUM_SLOTS = (END_MIN - START_MIN) / INTERVAL_MIN + 1; // 65

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
    const h = Math.floor(m / 60);
    const min = m % 60;
    const h12 = h % 12 || 12;
    const ampm = h < 12 ? 'AM' : 'PM';
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
): { slot: number; liver: number; muscle: number }[] {
    const liverExerciseBurn  = new Array(NUM_SLOTS).fill(0);
    const muscleExerciseBurn = new Array(NUM_SLOTS).fill(0);
    const liverCarbRefuel    = new Array(NUM_SLOTS).fill(0);
    const muscleCarbRefuel   = new Array(NUM_SLOTS).fill(0);
    const liverAlcoholDrain  = new Array(NUM_SLOTS).fill(0);

    // ── Exercise burns ──────────────────────────────────────────────────────────
    const activeLogs = exerciseLogs?.filter(e => !e.ignored) ?? [];
    if (activeLogs.length > 0) {
        for (const ex of activeLogs) {
            const glycoCal = (ex.estimatedCaloriesBurned || 0) * 0.70; // ~70% of exercise from glycogen
            if (glycoCal <= 0) continue;
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
    } else {
        // Fallback: active burn (above BMR) spread noon → 10 PM
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
    const ABSORPTION_SLOTS = 6; // ~90 min absorption window
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
}: DashboardChartsProps) {
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

    const glycogenData = React.useMemo(
        () => buildGlycogenCurves(caloriesOut, carbsG, morningGlycogenPct, muscleMaxKcal, foodLogs, exerciseLogs),
        [caloriesOut, carbsG, morningGlycogenPct, muscleMaxKcal, foodLogs, exerciseLogs],
    );

    const last            = glycogenData[glycogenData.length - 1];
    const endLiverPct     = last.liver;
    const endMusclePct    = last.muscle;
    const endLiverKcal    = Math.round((endLiverPct  / 100) * LIVER_MAX_KCAL);
    const endMuscleKcal   = Math.round((endMusclePct / 100) * muscleMaxKcal);

    // X-axis ticks: 6 AM, 9 AM, 12 PM, 3 PM, 6 PM, 10 PM
    const X_TICKS = [0, 12, 24, 36, 48, 64];

    return (
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
                    </div>
                    <CardDescription className="text-xs font-medium">
                        Liver (100g) + Muscle (~{muscleCapacityG}g) · Estimated · Not medical advice
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

                    {/* End-of-day stats */}
                    <div className="flex justify-between items-end mt-3">
                        <div className="text-center">
                            <p className="text-[9px] font-black uppercase text-orange-500/70 tracking-widest">Liver</p>
                            <p className="text-base font-black text-orange-500">{endLiverPct}%</p>
                            <p className="text-[9px] font-bold text-muted-foreground">{endLiverKcal} kcal</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[9px] font-black uppercase text-blue-500/70 tracking-widest">Muscle</p>
                            <p className="text-base font-black text-blue-600">{endMusclePct}%</p>
                            <p className="text-[9px] font-bold text-muted-foreground">{endMuscleKcal} kcal</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[9px] font-black uppercase text-muted-foreground/70 tracking-widest">Combined</p>
                            <p className="text-base font-black text-foreground">{endLiverKcal + endMuscleKcal}</p>
                            <p className="text-[9px] font-bold text-muted-foreground">kcal left</p>
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
    );
}
