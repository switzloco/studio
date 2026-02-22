'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, TrendingUp, BarChart3, ArrowUpRight } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, ResponsiveContainer } from "recharts";

const chartData = [
  { day: "Mon", equity: 800 },
  { day: "Tue", equity: 950 },
  { day: "Wed", equity: 920 },
  { day: "Thu", equity: 1100 },
  { day: "Fri", equity: 1250 },
  { day: "Sat", equity: 1400 },
  { day: "Sun", equity: 1750 },
];

const chartConfig = {
  equity: {
    label: "Visceral Fat Points",
    color: "hsl(var(--primary))",
  },
};

export function HistoryView() {
  return (
    <div className="p-4 space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-black tracking-tight text-foreground">Portfolio History</h2>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">7-Day Fiscal Audit</p>
      </div>

      {/* Growth Chart */}
      <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
        <CardHeader className="p-4 pb-0">
          <CardTitle className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-2">
            <BarChart3 className="w-3 h-3" />
            Equity Growth Curve
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-4">
          <ChartContainer config={chartConfig} className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                <XAxis 
                  dataKey="day" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700 }}
                  dy={10}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area 
                  type="monotone" 
                  dataKey="equity" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorEquity)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Audit Log */}
      <div className="space-y-3">
        <h3 className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest px-1">Historical Audit Log</h3>
        
        <div className="space-y-2">
          {[
            { date: "Oct 24", gain: "+350 pts", status: "Bullish", detail: "High Protein Intake | Solvency Met" },
            { date: "Oct 23", gain: "+150 pts", status: "Stable", detail: "Recovery Audit: Prime" },
            { date: "Oct 22", gain: "+200 pts", status: "Bullish", detail: "Capital Infusion: Leg Day" },
            { date: "Oct 21", gain: "-50 pts", status: "Correction", detail: "Liquidity Shortage | Sleep Debt" },
          ].map((audit, i) => (
            <Card key={i} className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Briefcase className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-black">{audit.date}</p>
                      <span className={`text-[8px] font-black uppercase px-1 rounded ${
                        audit.status === 'Bullish' ? 'bg-emerald-100 text-emerald-700' : 
                        audit.status === 'Stable' ? 'bg-blue-100 text-blue-700' : 
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {audit.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-medium">{audit.detail}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <span className={`text-xs font-black ${audit.gain.startsWith('+') ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {audit.gain}
                    </span>
                    <ArrowUpRight className={`w-3 h-3 ${audit.gain.startsWith('+') ? 'text-emerald-600' : 'text-amber-600 rotate-90'}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}