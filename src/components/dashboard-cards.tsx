'use client';

import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, Target, Zap, Activity, DollarSign } from "lucide-react";
import { HealthData } from '@/lib/health-service';

export function DashboardCards({ data }: { data: HealthData | null }) {
  if (!data) return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />
      ))}
    </div>
  );

  const fatProgress = (data.visceralFatPoints / 3000) * 100;
  const proteinProgress = (data.proteinGrams / 150) * 100;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 pb-2">
      <Card className="border-none shadow-sm overflow-hidden bg-white/50">
        <CardContent className="p-4 flex flex-col justify-between h-full">
          <div className="flex justify-between items-start">
            <div className="p-1.5 bg-blue-100 rounded-lg">
              <TrendingUp className="w-4 h-4 text-primary" />
            </div>
            <span className="text-[10px] font-semibold text-green-600 flex items-center gap-0.5">
              +5.2% <Activity className="w-2.5 h-2.5" />
            </span>
          </div>
          <div className="mt-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Visceral Fat Portfolio</p>
            <h3 className="text-lg font-bold text-foreground">{data.visceralFatPoints.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">pts</span></h3>
          </div>
          <Progress value={fatProgress} className="h-1 mt-2 bg-blue-100" />
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm overflow-hidden bg-white/50">
        <CardContent className="p-4 flex flex-col justify-between h-full">
          <div className="flex justify-between items-start">
            <div className="p-1.5 bg-purple-100 rounded-lg">
              <DollarSign className="w-4 h-4 text-accent" />
            </div>
            <span className="text-[10px] font-semibold text-amber-600">IN DEBT</span>
          </div>
          <div className="mt-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Protein Solvency</p>
            <h3 className="text-lg font-bold text-foreground">{data.proteinGrams} <span className="text-sm font-normal text-muted-foreground">/ 150g</span></h3>
          </div>
          <Progress value={proteinProgress} className="h-1 mt-2 bg-purple-100" />
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm overflow-hidden bg-white/50">
        <CardContent className="p-4 flex flex-col justify-between h-full">
          <div className="flex justify-between items-start">
            <div className="p-1.5 bg-orange-100 rounded-lg">
              <Zap className="w-4 h-4 text-orange-600" />
            </div>
          </div>
          <div className="mt-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Explosiveness Trend</p>
            <h3 className="text-lg font-bold text-foreground">BULLISH</h3>
          </div>
          <div className="flex gap-1 mt-2 h-1 overflow-hidden rounded-full">
             <div className="flex-1 bg-green-500 rounded-full" />
             <div className="flex-1 bg-green-500 rounded-full" />
             <div className="flex-1 bg-green-300 rounded-full" />
             <div className="flex-1 bg-muted rounded-full" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm overflow-hidden bg-white/50">
        <CardContent className="p-4 flex flex-col justify-between h-full">
          <div className="flex justify-between items-start">
            <div className="p-1.5 bg-emerald-100 rounded-lg">
              <Target className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <div className="mt-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Strength Index</p>
            <h3 className="text-lg font-bold text-foreground">92.4 <span className="text-sm font-normal text-muted-foreground">pts</span></h3>
          </div>
          <div className="flex items-end gap-0.5 mt-2 h-4">
             <div className="w-2 bg-emerald-200 h-[20%] rounded-t-sm" />
             <div className="w-2 bg-emerald-300 h-[40%] rounded-t-sm" />
             <div className="w-2 bg-emerald-400 h-[70%] rounded-t-sm" />
             <div className="w-2 bg-emerald-600 h-[90%] rounded-t-sm" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
