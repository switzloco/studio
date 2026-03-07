'use client';

import React, { useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Briefcase, TrendingUp, AlertCircle, ArrowRight, History as HistoryIcon } from "lucide-react";
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, orderBy, limit, Timestamp } from 'firebase/firestore';
import { HealthData, HealthLog, HistoryEntry } from '@/lib/health-service';
import { VFScoreChart } from './vf-score-chart';
import { VFHeatmap } from './vf-heatmap';
import { VFDayDetail } from './vf-day-detail';

export function HistoryView() {
  const { user } = useUser();
  const db = useFirestore();

  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // 1. Fetch High-Level Equity Summary (for the charts)
  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData, isLoading: isHealthLoading } = useDoc<HealthData>(userDocRef);

  // 2. Fetch Detailed Audit Logs (for the transaction list)
  const logsQuery = useMemoFirebase(() => user ? query(
    collection(db, 'users', user.uid, 'logs'),
    orderBy('timestamp', 'desc'),
    limit(15)
  ) : null, [db, user]);
  const { data: logs, isLoading: isLogsLoading } = useCollection<HealthLog>(logsQuery);

  const history = healthData?.history || [];

  const handleDayClick = (entry: HistoryEntry) => {
    setSelectedEntry(entry);
    setSheetOpen(true);
  };

  if (isHealthLoading || isLogsLoading) {
    return (
      <div className="p-6 sm:p-10 space-y-10">
        <div className="h-10 w-64 bg-muted animate-pulse rounded-xl" />
        <div className="h-80 bg-muted animate-pulse rounded-2xl" />
        <div className="h-48 bg-muted animate-pulse rounded-2xl" />
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-10 space-y-10 pb-24 h-full overflow-y-auto bg-background">
      <div className="flex items-center justify-between px-1">
        <div className="space-y-2">
          <h2 className="text-3xl font-black tracking-tighter uppercase italic text-foreground">Portfolio History</h2>
          <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.3em]">Historical Asset Audit</p>
        </div>
        <div className="p-4 bg-emerald-100 rounded-2xl shadow-sm">
          <TrendingUp className="w-6 h-6 text-emerald-600" />
        </div>
      </div>

      {/* VF Score Bar + Cumulative Line Chart */}
      {history.length > 0 ? (
        <VFScoreChart history={history} onDayClick={handleDayClick} />
      ) : (
        <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
          <CardContent className="p-6">
            <div className="h-72 flex flex-col items-center justify-center text-center gap-4 bg-muted/20 rounded-2xl border-2 border-dashed">
              <AlertCircle className="w-12 h-12 text-muted-foreground opacity-30" />
              <div className="space-y-1">
                <p className="text-[12px] font-black text-muted-foreground uppercase tracking-widest">No Historical Market Data</p>
                <p className="text-xs text-muted-foreground italic px-6 max-w-sm">Transactions will appear here once you begin depositing assets into your ledger.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* VF Heatmap Calendar */}
      <VFHeatmap history={history} onDayClick={handleDayClick} />

      {/* Audit Log (Transactions) */}
      <div className="space-y-6">
        <h3 className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.2em] px-1 italic">Transaction Ledger</h3>

        {logs && logs.length > 0 ? (
          <div className="space-y-4">
            {logs.map((log) => (
              <Card key={log.id} className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:bg-white hover:ring-primary/20 transition-all duration-300">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-5">
                    <div className={`p-3 rounded-xl shadow-sm ${log.category === 'food' ? 'bg-purple-100' : 'bg-orange-100'}`}>
                      <Briefcase className={`w-5 h-5 ${log.category === 'food' ? 'text-accent' : 'text-orange-600'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <p className="text-sm font-black italic">
                          {log.timestamp instanceof Timestamp ? log.timestamp.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Pending...'}
                        </p>
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-tighter ${log.category === 'food' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-orange-50 text-orange-700 border border-orange-200'}`}>
                          {log.category}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground font-medium truncate max-w-[250px] sm:max-w-md">{log.content}</p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-4">
                    <div className="hidden sm:block">
                      <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest opacity-50">Liquidity Adjustment</p>
                      <p className="text-xs font-bold text-foreground">{log.metrics?.[0]?.split(':')[1] || '---'}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-30" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="p-20 text-center bg-white/50 rounded-3xl border-2 border-dashed border-muted space-y-6 flex flex-col items-center">
            <div className="p-5 bg-muted/20 rounded-full shadow-inner">
              <HistoryIcon className="w-12 h-12 text-muted-foreground/40" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-black text-muted-foreground uppercase tracking-[0.2em]">Audit Trail: Cold</p>
              <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                The transaction ledger is empty. Complete your Discovery Audit and start logging activities to see them analyzed here in your personal transaction stream.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Day Detail Sheet */}
      <VFDayDetail entry={selectedEntry} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}
