'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, BarChart3, ArrowUpRight } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, ResponsiveContainer } from "recharts";
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';

export function HistoryView() {
  const { user } = useUser();
  const db = useFirestore();

  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData, isLoading } = useDoc(userDocRef);

  const history = healthData?.history || [];
  const chartData = [...history].reverse().map(entry => ({ day: entry.date, equity: entry.equity }));

  if (isLoading) return <div className="p-4 animate-pulse space-y-4"><div className="h-48 bg-muted rounded-xl" /></div>;

  return (
    <div className="p-4 space-y-6 pb-20">
      <div className="space-y-1">
        <h2 className="text-xl font-black tracking-tight">Portfolio History</h2>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Historical Asset Audit</p>
      </div>

      <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
        <CardHeader className="p-4 pb-0">
          <CardTitle className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-2">
            <BarChart3 className="w-3 h-3" />
            Equity Growth Curve
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-4">
          <ChartContainer config={{ equity: { label: "Equity", color: "hsl(var(--primary))" } }} className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} dy={10} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="equity" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={0.1} fill="hsl(var(--primary))" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {history.map((audit, i) => (
          <Card key={i} className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Briefcase className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-black">{audit.date}</p>
                    <span className={`text-[8px] font-black uppercase px-1 rounded ${audit.status === 'Bullish' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {audit.status}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground font-medium">{audit.detail}</p>
                </div>
              </div>
              <div className="text-right">
                <span className={`text-xs font-black ${audit.gain >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {audit.gain > 0 ? `+${audit.gain}` : audit.gain}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
