'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, BarChart3, TrendingUp, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, ResponsiveContainer } from "recharts";
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, orderBy, limit } from 'firebase/firestore';
import { Button } from '@/components/ui/button';

export function HistoryView() {
  const { user } = useUser();
  const db = useFirestore();

  // 1. Fetch High-Level Equity Summary (for the chart)
  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData, isLoading: isHealthLoading } = useDoc(userDocRef);

  // 2. Fetch Detailed Audit Logs (for the transaction list)
  const logsQuery = useMemoFirebase(() => user ? query(
    collection(db, 'users', user.uid, 'logs'),
    orderBy('timestamp', 'desc'),
    limit(15)
  ) : null, [db, user]);
  const { data: logs, isLoading: isLogsLoading } = useCollection(logsQuery);

  const history = healthData?.history || [];
  const chartData = [...history].map(entry => ({ 
    day: entry.date, 
    equity: entry.equity 
  }));

  if (isHealthLoading || isLogsLoading) {
    return (
      <div className="p-4 space-y-6">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-48 bg-muted animate-pulse rounded-xl" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-24 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-black tracking-tight">Portfolio History</h2>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Historical Asset Audit</p>
        </div>
        <div className="p-2 bg-emerald-100 rounded-full">
          <TrendingUp className="w-4 h-4 text-emerald-600" />
        </div>
      </div>

      {/* Equity Growth Curve */}
      <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
        <CardHeader className="p-4 pb-0">
          <CardTitle className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-2">
            <BarChart3 className="w-3 h-3" />
            Equity Growth Curve
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-4">
          {chartData.length > 0 ? (
            <ChartContainer config={{ equity: { label: "Equity", color: "hsl(var(--primary))" } }} className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} dy={10} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area 
                    type="monotone" 
                    dataKey="equity" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={3} 
                    fillOpacity={0.1} 
                    fill="hsl(var(--primary))" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-48 flex flex-col items-center justify-center text-center gap-2 bg-muted/20 rounded-lg border border-dashed">
              <AlertCircle className="w-8 h-8 text-muted-foreground opacity-50" />
              <p className="text-[10px] font-bold text-muted-foreground uppercase">No Historical Market Data</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit Log (Transactions) */}
      <div className="space-y-3">
        <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1 italic">Transaction Ledger</h3>
        
        {logs && logs.length > 0 ? (
          <div className="space-y-2">
            {logs.map((log) => (
              <Card key={log.id} className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:bg-white transition-colors">
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${log.category === 'food' ? 'bg-purple-100' : 'bg-orange-100'}`}>
                      <Briefcase className={`w-4 h-4 ${log.category === 'food' ? 'text-accent' : 'text-orange-600'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-black">
                          {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Pending...'}
                        </p>
                        <span className={`text-[8px] font-black uppercase px-1 rounded ${log.category === 'food' ? 'bg-purple-50 text-purple-700' : 'bg-orange-50 text-orange-700'}`}>
                          {log.category}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-medium truncate max-w-[180px]">{log.content}</p>
                    </div>
                  </div>
                  <div className="text-right">
                     <ArrowRight className="w-3 h-3 text-muted-foreground opacity-50" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center bg-white/50 rounded-xl border-2 border-dashed border-muted space-y-4">
            <p className="text-xs font-bold text-muted-foreground">The audit trail is currently cold.</p>
            <Button variant="outline" className="text-[10px] font-bold uppercase gap-2 h-8 rounded-full">
               Start Auditing Assets
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
