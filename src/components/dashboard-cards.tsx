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

  const fatProgress = (data.visceral_fat_points / 3000) * 100;
  const proteinProgress = (data.protein_g / 150) * 100;

  return (
    <div className="flex flex-col gap-6 p-4 pb-20">
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest italic">Live Market Audit</h2>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-600 uppercase">Active Session</span>
          </div>
        </div>
        
        <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-purple-100 rounded-xl">
              <DollarSign className="w-5 h-5 text-accent" />
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-end mb-1">
                <p className="text-xs font-bold text-foreground">Protein Liquidity</p>
                <span className="text-[10px] font-bold text-muted-foreground">{data.protein_g}g / 150g</span>
              </div>
              <Progress value={proteinProgress} className="h-2 bg-purple-50" />
            </div>
            <div className="text-right shrink-0">
              <p className={`text-[10px] font-black uppercase ${data.protein_g >= 110 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {data.protein_g >= 110 ? 'Solvent' : 'Debt Alert'}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
            <CardContent className="p-4">
              <div className="p-2 bg-orange-100 rounded-lg w-fit mb-2">
                <Zap className="w-4 h-4 text-orange-600" />
              </div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Steps Inventory</p>
              <h4 className="text-lg font-bold">{data.steps.toLocaleString()}</h4>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
            <CardContent className="p-4">
              <div className="p-2 bg-blue-100 rounded-lg w-fit mb-2">
                <Target className="w-4 h-4 text-blue-600" />
              </div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Recovery Audit</p>
              <h4 className="text-lg font-bold uppercase">{data.recoveryStatus}</h4>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1 italic">Long-Term Portfolio</h2>
        <Card className="border-none shadow-sm overflow-hidden bg-primary text-white">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <Briefcase className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase opacity-80">Equity Score (VF Points)</p>
                <h3 className="text-xl font-black">{data.visceral_fat_points.toLocaleString()} <span className="text-[10px] font-normal opacity-70">/ 3,000</span></h3>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-black text-emerald-300">{Math.min(100, fatProgress).toFixed(1)}%</p>
            </div>
          </CardContent>
          <Progress value={fatProgress} className="h-1 rounded-none bg-white/10" />
        </Card>
      </div>
    </div>
  );
}
