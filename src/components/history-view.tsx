'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, BarChart3, ArrowUpRight, UploadCloud } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, ResponsiveContainer } from "recharts";
import { mockHealthService, HistoryEntry } from '@/lib/health-service';
import { Button } from '@/components/ui/button';

export function HistoryView() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      const data = await mockHealthService.getHealthSummary();
      setHistory(data.history);
      setLoading(false);
    };
    fetchHistory();
  }, []);

  // Format chart data (Oldest to newest for the chart)
  const chartData = [...history].reverse().map(entry => ({
    day: entry.date,
    equity: entry.equity
  }));

  const chartConfig = {
    equity: {
      label: "Visceral Fat Points",
      color: "hsl(var(--primary))",
    },
  };

  if (loading) return (
    <div className="p-4 space-y-4">
      <div className="h-8 w-1/2 bg-muted animate-pulse rounded" />
      <div className="h-48 bg-muted animate-pulse rounded-xl" />
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />
        ))}
      </div>
    </div>
  );

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-black tracking-tight text-foreground">Portfolio History</h2>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Historical Asset Audit</p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          className="rounded-full flex items-center gap-2 border-primary/20 text-primary hover:bg-primary/5"
          onClick={() => {
            // In a real app, this would trigger a dedicated upload flow.
            // Here, we point users to the chat where the CFO handles ingestion.
            const chatTab = document.querySelector('[value="chat"]') as HTMLButtonElement;
            if (chatTab) chatTab.click();
            setTimeout(() => {
                const input = document.querySelector('input[placeholder*="Send message"]') as HTMLInputElement;
                if (input) input.placeholder = "Upload your spreadsheet audit sheet here...";
            }, 100);
          }}
        >
          <UploadCloud className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Ingest Audit</span>
        </Button>
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
          {history.length > 0 ? (
            history.map((audit, i) => (
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
                      <span className={`text-xs font-black ${audit.gain >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {audit.gain > 0 ? `+${audit.gain}` : audit.gain} pts
                      </span>
                      <ArrowUpRight className={`w-3 h-3 ${audit.gain >= 0 ? 'text-emerald-600' : 'text-amber-600 rotate-90'}`} />
                    </div>
                    <p className="text-[8px] font-bold text-muted-foreground uppercase">{audit.equity} total</p>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <p className="text-center text-xs text-muted-foreground py-8">No historical assets audited yet. Upload a sheet to begin ingestion.</p>
          )}
        </div>
      </div>
    </div>
  );
}
