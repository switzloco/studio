'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, CartesianGrid, AreaChart, Area } from 'recharts';
import { Flame, BatteryCharging } from 'lucide-react';
import type { FoodLogEntry, ExerciseLogEntry } from '@/lib/food-exercise-types';

interface DashboardChartsProps {
    caloriesIn: number;
    caloriesOut: number;
    carbsG: number;
    foodLogs?: FoodLogEntry[];
    exerciseLogs?: ExerciseLogEntry[];
    /** Morning glycogen %, chained from previous day's end state. 100 for new users. */
    morningGlycogenPct?: number;
}

// 15-minute intraday glycogen simulation
// Covers 6 AM (slot 0) → 10 PM (slot 64) = 65 slots
const INTERVAL_MIN = 15;
const START_MIN = 6 * 60;   // 360
const END_MIN   = 22 * 60;  // 1320
const NUM_SLOTS = (END_MIN - START_MIN) / INTERVAL_MIN + 1; // 65

const MAX_GLYCOGEN_KCAL = 500 * 4; // 2000 kcal (400g muscle + 100g liver)
// 30% of a 2000-kcal BMR is fuelled by glycogen, spread over 16 waking hours, per slot
const RESTING_BURN_PER_SLOT = (2000 * 0.30) / 16 / (60 / INTERVAL_MIN); // ~9.4 kcal / 15 min

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

function buildGlycogenCurve(
    caloriesOut: number,
    carbsG: number,
    morningPct: number,
    foodLogs?: FoodLogEntry[],
    exerciseLogs?: ExerciseLogEntry[],
): { slot: number; level: number }[] {
    const exerciseBurn = new Array(NUM_SLOTS).fill(0);
    const carbRefuel   = new Array(NUM_SLOTS).fill(0);

    // --- Exercise burns ---
    const activeLogs = exerciseLogs?.filter(e => !e.ignored) ?? [];
    if (activeLogs.length > 0) {
        for (const ex of activeLogs) {
            const cal = (ex.estimatedCaloriesBurned || 0) * 0.70; // 70% from glycogen
            if (cal <= 0) continue;
            const dur       = Math.max(15, ex.durationMin || 30);
            const startMin  = ex.performedAt ? parseHHMM(ex.performedAt) : 12 * 60;
            const startSlot = Math.max(0, Math.min(NUM_SLOTS - 1, timeToSlot(startMin)));
            const numSlots  = Math.max(1, Math.round(dur / INTERVAL_MIN));
            const perSlot   = cal / numSlots;
            for (let s = startSlot; s < Math.min(startSlot + numSlots, NUM_SLOTS); s++) {
                exerciseBurn[s] += perSlot;
            }
        }
    } else {
        // Fallback: spread active burn (above BMR) across noon → 10 PM
        const activeBurn = Math.max(0, caloriesOut - 2000) * 0.70;
        if (activeBurn > 0) {
            const activeSlots = NUM_SLOTS - 24;
            const perSlot = activeBurn / activeSlots;
            for (let s = 24; s < NUM_SLOTS; s++) exerciseBurn[s] += perSlot;
        }
    }

    // --- Carb refueling ---
    // Carbs raise blood glucose and replenish glycogen over ~90 min (6 slots)
    const ABSORPTION_SLOTS = 6;
    const activeFoods = foodLogs?.filter(f => !f.ignored) ?? [];
    if (activeFoods.length > 0) {
        for (const food of activeFoods) {
            const carbCal = (food.carbsG || 0) * 4;
            if (carbCal <= 0) continue;
            const eatMin    = food.consumedAt
                ? parseHHMM(food.consumedAt)
                : (MEAL_DEFAULT_MIN[food.meal] ?? 12 * 60);
            const startSlot = Math.max(0, Math.min(NUM_SLOTS - 1, timeToSlot(eatMin)));
            const perSlot   = carbCal / ABSORPTION_SLOTS;
            for (let s = startSlot; s < Math.min(startSlot + ABSORPTION_SLOTS, NUM_SLOTS); s++) {
                carbRefuel[s] += perSlot;
            }
        }
    } else {
        // Fallback: distribute carbsG as 50% by noon, 35% by 6 PM, 15% by 10 PM
        const carbCal  = carbsG * 4;
        const noonSlot = 24; // slot index for 12 PM
        const pm6Slot  = 48; // slot index for 6 PM
        if (carbCal > 0) {
            const p1 = carbCal * 0.50 / noonSlot;
            for (let s = 0; s < noonSlot; s++) carbRefuel[s] += p1;
            const p2 = carbCal * 0.35 / (pm6Slot - noonSlot);
            for (let s = noonSlot; s < pm6Slot; s++) carbRefuel[s] += p2;
            const p3 = carbCal * 0.15 / (NUM_SLOTS - pm6Slot);
            for (let s = pm6Slot; s < NUM_SLOTS; s++) carbRefuel[s] += p3;
        }
    }

    // --- Simulate slot by slot ---
    const result: { slot: number; level: number }[] = [];
    let current = MAX_GLYCOGEN_KCAL * (morningPct / 100);
    for (let s = 0; s < NUM_SLOTS; s++) {
        current = Math.max(0, Math.min(MAX_GLYCOGEN_KCAL,
            current - RESTING_BURN_PER_SLOT - exerciseBurn[s] + carbRefuel[s]
        ));
        result.push({ slot: s, level: Math.round((current / MAX_GLYCOGEN_KCAL) * 100) });
    }
    return result;
}

export function DashboardCharts({ caloriesIn = 0, caloriesOut = 2000, carbsG = 0, foodLogs, exerciseLogs, morningGlycogenPct = 100 }: DashboardChartsProps) {
    const deficit = caloriesIn - caloriesOut;

    const calorieData = [
        { name: 'Intake',  value: caloriesIn,        color: '#10b981' },
        { name: 'Burned',  value: caloriesOut,        color: '#f97316' },
        { name: 'Deficit', value: Math.abs(deficit),  color: deficit > 0 ? '#ef4444' : '#3b82f6' },
    ];

    const glycogenData = React.useMemo(
        () => buildGlycogenCurve(caloriesOut, carbsG, morningGlycogenPct, foodLogs, exerciseLogs),
        [caloriesOut, carbsG, morningGlycogenPct, foodLogs, exerciseLogs],
    );

    const endGlycogenPct  = glycogenData[glycogenData.length - 1].level;
    const endGlycogenKcal = Math.round((endGlycogenPct / 100) * MAX_GLYCOGEN_KCAL);

    // Show tick labels at 6 AM, 9 AM, 12 PM, 3 PM, 6 PM, 10 PM
    const X_TICKS = [0, 12, 24, 36, 48, 64];

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
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

            <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
                <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <BatteryCharging className="w-5 h-5 text-blue-500" />
                        </div>
                        <CardTitle className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">Glycogen Reserves</CardTitle>
                    </div>
                    <CardDescription className="text-xs font-medium">Estimated Liver & Muscle Glycogen (%) · Not medical advice</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[200px] w-full mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={glycogenData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorLevel" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.8} />
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
                                <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                                <Tooltip
                                    labelFormatter={(slot) => slotToTimeLabel(slot as number)}
                                    formatter={(value) => [`${value}%`, 'Glycogen']}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Area type="monotone" dataKey="level" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorLevel)" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex justify-between items-center mt-4">
                        <div className="text-center">
                            <p className="text-[10px] font-black uppercase text-muted-foreground">Est. Status</p>
                            <p className="text-lg font-black text-blue-600">{endGlycogenPct}% <span className="text-xs font-medium text-blue-600/60">Full</span></p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-black uppercase text-muted-foreground">Calories</p>
                            <p className="text-[12px] font-black text-blue-500 mt-1">
                                {endGlycogenKcal} <span className="text-[10px] font-medium opacity-60">kcal</span>
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
