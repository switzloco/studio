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

    // Real intraday curve estimation based on carbs vs burn
    // ~500g capacity (400g muscle, 100g liver). Assuming morning start at 80% full if no previous data.
    const maxGlycogenKcal = 500 * 4; // 2000 kcal capacity
    const assumedMorningStartKcal = maxGlycogenKcal * 0.8;
    const workoutBurnKcal = caloriesOut > 2000 ? (caloriesOut - 2000) * 0.7 : 0; // 70% of active burn uses carbs
    const baseBurnKcal = 2000 * 0.3; // 30% of resting burn uses carbs

    // Estimate end glycogen
    const netCarbKcal = (carbsG * 4) - workoutBurnKcal - baseBurnKcal;
    let endGlycogenKcal = Math.max(0, Math.min(maxGlycogenKcal, assumedMorningStartKcal + netCarbKcal));
    const startGlycogenPct = (assumedMorningStartKcal / maxGlycogenKcal) * 100;
    const endGlycogenPct = (endGlycogenKcal / maxGlycogenKcal) * 100;

    const glycogenData = [
        { time: '6 AM', level: startGlycogenPct },
        { time: '12 PM', level: Math.max(5, startGlycogenPct - 15 + ((carbsG > 100 ? 50 : carbsG) / 500 * 100)) },
        { time: '6 PM', level: Math.max(5, startGlycogenPct - 25 + ((carbsG > 100 ? 100 : carbsG) / 500 * 100)) },
        { time: '10 PM', level: endGlycogenPct },
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
