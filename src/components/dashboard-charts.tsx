'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, CartesianGrid, AreaChart, Area } from 'recharts';
import { Flame, BatteryCharging } from 'lucide-react';

interface DashboardChartsProps {
    caloriesIn: number;
    caloriesOut: number;
    carbsG: number;
}

export function DashboardCharts({ caloriesIn = 0, caloriesOut = 2000, carbsG = 0 }: DashboardChartsProps) {
    const deficit = caloriesIn - caloriesOut;

    const calorieData = [
        { name: 'Intake', value: caloriesIn, color: '#10b981' }, // emerald
        { name: 'Burned', value: caloriesOut, color: '#f97316' }, // orange
        { name: 'Deficit', value: Math.abs(deficit), color: deficit > 0 ? '#ef4444' : '#3b82f6' } // red if surplus, blue if deficit
    ];

    // Intraday glycogen curve.
    // Capacity: ~500g (400g muscle + 100g liver) = 2000 kcal.
    // Morning default: 30% — conservative post-overnight-fast baseline.
    // Carbs logged during the day drive the refueling curve upward.
    const maxGlycogenKcal = 500 * 4; // 2000 kcal capacity
    const morningStartKcal = maxGlycogenKcal * 0.30; // ~30% after overnight fast

    // Resting carb burn: ~30% of a 2000 kcal/day BMR uses glycogen, spread over 16 waking hours
    const restingHourlyBurnKcal = (2000 * 0.30) / 16; // ~37.5 kcal/h
    const burnByNoon   = restingHourlyBurnKcal * 6;  // 6 AM → 12 PM
    const burnBy6pm    = restingHourlyBurnKcal * 12; // 6 AM → 6 PM
    const burnByEnd    = restingHourlyBurnKcal * 16; // 6 AM → 10 PM

    // Active workout burn on top of resting (70% of calories above BMR use glycogen)
    const activeBurnKcal = Math.max(0, caloriesOut - 2000) * 0.7;

    const carbKcal = carbsG * 4;
    // Distribute logged carbs across the day: 50% by noon, 85% by 6pm, 100% by end
    const refuelByNoon = carbKcal * 0.50;
    const refuelBy6pm  = carbKcal * 0.85;
    const refuelByEnd  = carbKcal;

    const noonKcal  = Math.max(0, Math.min(maxGlycogenKcal, morningStartKcal - burnByNoon  + refuelByNoon));
    const pm6Kcal   = Math.max(0, Math.min(maxGlycogenKcal, morningStartKcal - burnBy6pm   + refuelBy6pm  - activeBurnKcal * 0.6));
    let endGlycogenKcal = Math.max(0, Math.min(maxGlycogenKcal, morningStartKcal - burnByEnd + refuelByEnd - activeBurnKcal));

    const startGlycogenPct = (morningStartKcal  / maxGlycogenKcal) * 100;
    const noonPct           = (noonKcal          / maxGlycogenKcal) * 100;
    const pm6Pct            = (pm6Kcal           / maxGlycogenKcal) * 100;
    const endGlycogenPct    = (endGlycogenKcal   / maxGlycogenKcal) * 100;

    const glycogenData = [
        { time: '6 AM',  level: Math.round(startGlycogenPct) },
        { time: '12 PM', level: Math.round(noonPct) },
        { time: '6 PM',  level: Math.round(pm6Pct) },
        { time: '10 PM', level: Math.round(endGlycogenPct) },
    ];

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
                    <CardDescription className="text-xs font-medium">Estimated Liver & Muscle Glycogen (%)</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[200px] w-full mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={glycogenData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorLevel" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                                <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                                <Tooltip
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Area type="monotone" dataKey="level" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorLevel)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex justify-between items-center mt-4">
                        <div className="text-center">
                            <p className="text-[10px] font-black uppercase text-muted-foreground">Est. Status</p>
                            <p className="text-lg font-black text-blue-600">{endGlycogenPct.toFixed(0)}% <span className="text-xs font-medium text-blue-600/60">Full</span></p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-black uppercase text-muted-foreground">Calories</p>
                            <p className={`text-[12px] font-black text-blue-500 mt-1`}>
                                {endGlycogenKcal.toFixed(0)} <span className="text-[10px] font-medium opacity-60">kcal</span>
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
