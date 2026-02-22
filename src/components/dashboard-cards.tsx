
'use client';

import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Target, Zap, DollarSign, Briefcase, Loader2, Lock, ShieldAlert } from "lucide-react";
import { HealthData } from '@/lib/health-service';

interface DashboardCardsProps {
  data: HealthData | null;
  isLoading?: boolean;
}

export function DashboardCards({ data, isLoading }: DashboardCardsProps) {
  // 1. LOADING STATE - Skeletons for a high-fidelity feel
  if (isLoading) {
    return (
      <div className="flex flex-col h-full space-y-6 p-4 bg-background">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest italic">Live Market Audit</h2>
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
            <span className="text-[10px] font-bold text-muted-foreground uppercase">Syncing Ledger...</span>
          </div>
        </div>
        <div className="space-y-4">
          <div className="h-24 bg-muted/50 animate-pulse rounded-xl" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-32 bg-muted/50 animate-pulse rounded-xl" />
            <div className="h-32 bg-muted/50 animate-pulse rounded-xl" />
          </div>
          <div className="h-32 bg-muted/50 animate-pulse rounded-xl" />
        </div>
        <div className="flex-1 flex items-end justify-center pb-8">
          <p className="text-[10px] font-bold text-muted-foreground uppercase animate-pulse">Initializing CFO Diagnostic Suite</p>
        </div>
      </div>
    );
  }

  // 2. NO DATA / INITIALIZING STATE (Wait for useEffect to create the doc)
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-8 text-center bg-background space-y-6">
        <div className="p-4 bg-primary/10 rounded-full">
          <ShieldAlert className="w-12 h-12 text-primary animate-pulse" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-black tracking-tight">Portfolio Discovery</h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
            Opening your terminal... The CFO is initializing your personal ledger in the secure vault.
          </p>
        </div>
        <div className="flex items-center gap-2 text-primary">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-[10px] font-black uppercase tracking-widest">Establishing Connection...</span>
        </div>
      </div>
    );
  }

  // 3. ONBOARDING LOCKED STATE - Explicit instruction for the user
  if (!data.onboardingComplete) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[500px] p-8 text-center bg-background space-y-8">
        <div className="p-6 bg-muted/30 rounded-full relative">
          <Lock className="w-12 h-12 text-muted-foreground opacity-50" />
          <div className="absolute -bottom-1 -right-1 bg-primary text-white p-2 rounded-full shadow-lg ring-4 ring-background">
            <ShieldAlert className="w-4 h-4" />
          </div>
        </div>
        <div className="space-y-4">
          <h2 className="text-2xl font-black tracking-tighter uppercase italic text-primary">Portfolio Under Audit</h2>
          <div className="h-1 w-16 bg-primary mx-auto rounded-full" />
          <p className="text-sm text-muted-foreground max-w-[300px] mx-auto leading-relaxed font-medium">
            The CFO is currently performing a <span className="font-bold text-foreground underline decoration-primary decoration-2 underline-offset-4">Discovery Audit</span>. 
            <br/><br/>
            Switch to the <span className="font-bold text-primary italic">COACH</span> tab and complete the briefing to unlock your performance metrics.
          </p>
        </div>
        <Card className="bg-card border-dashed border-2 p-5 mt-4 max-w-[300px] shadow-none">
          <p className="text-[10px] font-black text-muted-foreground uppercase text-left mb-3 tracking-widest">Audit Requirements:</p>
          <ul className="text-[10px] font-black text-left space-y-2">
            <li className="flex items-center gap-2 text-muted-foreground">
              <div className="w-1.5 h-1.5 bg-primary/30 rounded-full" />
              IDENTIFY PHYSICAL ASSETS
            </li>
            <li className="flex items-center gap-2 text-muted-foreground">
              <div className="w-1.5 h-1.5 bg-primary/30 rounded-full" />
              SET PROTEIN SOLVENCY TARGETS
            </li>
            <li className="flex items-center gap-2 text-muted-foreground">
              <div className="w-1.5 h-1.5 bg-primary/30 rounded-full" />
              ESTABLISH WEEKLY ROUTINE
            </li>
          </ul>
        </Card>
      </div>
    );
  }

  // 4. ACTIVE DASHBOARD
  const dailyProteinG = data.dailyProteinG || 0;
  const visceralFatPoints = data.visceralFatPoints || 0;
  const proteinGoal = 150; 
  const fatPointsGoal = 3000; 

  const proteinProgress = Math.min(100, (dailyProteinG / proteinGoal) * 100);
  const fatProgress = Math.min(100, (visceralFatPoints / fatPointsGoal) * 100);

  return (
    <div className="flex flex-col gap-6 p-4 pb-20 bg-background h-full overflow-y-auto">
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
                <span className="text-[10px] font-bold text-muted-foreground">{dailyProteinG}g / {proteinGoal}g</span>
              </div>
              <Progress value={proteinProgress} className="h-2 bg-purple-50" />
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
              <h4 className="text-lg font-bold">{(data.steps || 0).toLocaleString()}</h4>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
            <CardContent className="p-4">
              <div className="p-2 bg-blue-100 rounded-lg w-fit mb-2">
                <Target className="w-4 h-4 text-blue-600" />
              </div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Recovery Audit</p>
              <h4 className="text-lg font-bold uppercase">{data.recoveryStatus || 'MEDIUM'}</h4>
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
                <h3 className="text-xl font-black">{(visceralFatPoints).toLocaleString()} <span className="text-[10px] font-normal opacity-70">/ {fatPointsGoal.toLocaleString()}</span></h3>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-black text-emerald-300">{fatProgress.toFixed(1)}%</p>
            </div>
          </CardContent>
          <Progress value={fatProgress} className="h-1 rounded-none bg-white/10" />
        </Card>
      </div>
    </div>
  );
}
