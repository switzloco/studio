'use client';

import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Target, Zap, Activity, DollarSign, Briefcase } from "lucide-react";
import { HealthData } from '@/lib/health-service';

export function DashboardCards({ data }: { data: HealthData | null }) {
  if (!data) return (
    <div className="space-y-4 p-4">
      <div className="h-24 bg-muted animate-pulse rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />
        ))}
      </div>
    </div>
  );

  const fatProgress = (data.visceralFatPoints / 3000) * 100;
  const proteinProgress = (data.proteinGrams / 150) * 100;

  return (
    <div className="flex flex-col gap-4 p-4 pb-2">
      {/* Secondary: Total Portfolio Score */}
      <Card className="border-none shadow-sm overflow-hidden bg-primary text-white">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Briefcase className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase opacity-80 tracking-wider">Total Portfolio Value</p>
              <h3 className="text-xl font-bold">{data.visceralFatPoints.toLocaleString()} <span className="text-sm font-normal opacity-70">/ 3,000 pts</span></h3>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase opacity-80 tracking-wider">Market Cap</p>
            <p className="text-sm font-bold text-emerald-300">{fatProgress.toFixed(1)}%</p>
          </div>
        </CardContent>
        <Progress value={fatProgress} className="h-1 rounded-none bg-white/10" />
      </Card>

      {/* Primary: Daily Scores Breakdown */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Daily Performance Audit</h2>
          <span className="text-[10px] font-bold text-primary uppercase">Open Market</span>
        </div>
        
        <div className="grid grid-cols-1 gap-3">
          {/* Protein Score */}
          <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-purple-100 rounded-xl">
                <DollarSign className="w-5 h-5 text-accent" />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-end mb-1">
                  <p className="text-xs font-bold text-foreground">Protein Solvency</p>
                  <span className="text-[10px] font-bold text-muted-foreground">{data.proteinGrams}g / 150g</span>
                </div>
                <Progress value={proteinProgress} className="h-2 bg-purple-50" />
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] font-bold text-amber-600 uppercase">In Debt</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            {/* Activity/Explosiveness Score */}
            <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <Zap className="w-4 h-4 text-orange-600" />
                  </div>
                  <TrendingUp className="w-3 h-3 text-green-500" />
                </div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Daily Yield</p>
                <h4 className="text-lg font-bold text-foreground">+12.4%</h4>
                <p className="text-[10px] font-medium text-green-600">BULLISH TREND</p>
              </CardContent>
            </Card>

            {/* Recovery/Audit Score */}
            <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="p-2 bg-emerald-100 rounded-lg">
                    <Target className="w-4 h-4 text-emerald-600" />
                  </div>
                  <Activity className="w-3 h-3 text-blue-500" />
                </div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Audit Score</p>
                <h4 className="text-lg font-bold text-foreground">92.4</h4>
                <div className="flex gap-0.5 mt-1 h-1.5">
                   <div className="flex-1 bg-emerald-500 rounded-full" />
                   <div className="flex-1 bg-emerald-500 rounded-full" />
                   <div className="flex-1 bg-emerald-500 rounded-full" />
                   <div className="flex-1 bg-muted rounded-full" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
