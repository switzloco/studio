
'use client';

import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Target, Zap, DollarSign, Briefcase, Loader2, Lock, ShieldAlert, CloudLightning, ShieldCheck } from "lucide-react";
import { HealthData } from '@/lib/health-service';
import { fitbitService } from '@/lib/fitbit-service';
import { useUser } from '@/firebase';

interface DashboardCardsProps {
  data: HealthData | null;
  isLoading?: boolean;
}

export function DashboardCards({ data, isLoading }: DashboardCardsProps) {
  const { user } = useUser();

  if (isLoading) {
    return (
      <div className="flex flex-col h-full space-y-6 p-6 md:p-12 lg:p-16 bg-background">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest italic">Live Market Audit</h2>
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-[12px] font-bold text-muted-foreground uppercase">Syncing Ledger...</span>
          </div>
        </div>
        <div className="space-y-6">
          <div className="h-32 bg-muted/50 animate-pulse rounded-2xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="h-40 bg-muted/50 animate-pulse rounded-2xl" />
            <div className="h-40 bg-muted/50 animate-pulse rounded-2xl" />
            <div className="h-40 bg-muted/50 animate-pulse rounded-2xl hidden lg:block" />
          </div>
          <div className="h-40 bg-muted/50 animate-pulse rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[500px] p-6 text-center bg-background space-y-8">
        <div className="p-6 bg-primary/10 rounded-full">
          <ShieldAlert className="w-16 h-16 text-primary animate-pulse" />
        </div>
        <div className="space-y-4">
          <h2 className="text-2xl font-black tracking-tight">Portfolio Discovery</h2>
          <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
            The CFO is initializing your personal ledger. This secure handshake ensures your assets are properly allocated before the first audit begins.
          </p>
        </div>
        <div className="flex items-center gap-3 text-primary">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[12px] font-black uppercase tracking-widest">Establishing Connection...</span>
        </div>
      </div>
    );
  }

  if (!data.onboardingComplete) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[600px] p-6 md:p-16 lg:p-24 text-center bg-background space-y-10">
        <div className="p-8 bg-muted/30 rounded-full relative">
          <Lock className="w-16 h-16 text-muted-foreground opacity-50" />
          <div className="absolute -bottom-2 -right-2 bg-primary text-white p-3 rounded-full shadow-2xl ring-4 ring-background">
            <ShieldAlert className="w-6 h-6" />
          </div>
        </div>
        <div className="space-y-6 w-full">
          <h2 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tighter uppercase italic text-primary">Portfolio Under Audit</h2>
          <div className="h-1.5 w-24 bg-primary mx-auto rounded-full" />
          <p className="text-base sm:text-lg lg:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed font-medium">
            The CFO is currently performing a <span className="font-bold text-foreground underline decoration-primary decoration-4 underline-offset-8">Discovery Audit</span>. 
            <br/><br/>
            Complete your onboarding in the <span className="font-bold text-primary italic uppercase tracking-tighter">COACH</span> tab to unlock high-stakes performance metrics and your live dashboard.
          </p>
        </div>
        
        <Card className="bg-card border-dashed border-2 p-8 lg:p-12 mt-6 w-full max-w-4xl shadow-none">
          <p className="text-[12px] font-black text-muted-foreground uppercase text-left mb-5 tracking-[0.2em]">Audit Requirements:</p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6 text-sm sm:text-base font-black text-left">
            <li className="flex items-center gap-4 text-muted-foreground">
              <div className="w-3 h-3 bg-primary shrink-0 rounded-full" />
              IDENTIFY PHYSICAL ASSETS (EQUIPMENT)
            </li>
            <li className="flex items-center gap-4 text-muted-foreground">
              <div className="w-3 h-3 bg-primary shrink-0 rounded-full" />
              SET PROTEIN SOLVENCY TARGETS
            </li>
            <li className="flex items-center gap-4 text-muted-foreground">
              <div className="w-3 h-3 bg-primary shrink-0 rounded-full" />
              ESTABLISH WEEKLY PERFORMANCE ROUTINE
            </li>
            <li className="flex items-center gap-4 text-muted-foreground">
              <div className={`w-3 h-3 ${data.isDeviceVerified ? 'bg-emerald-500' : 'bg-orange-400 animate-pulse'} shrink-0 rounded-full`} />
              HARDWARE VERIFICATION (FITBIT)
            </li>
          </ul>
        </Card>
      </div>
    );
  }

  const dailyProteinG = data.dailyProteinG || 0;
  const visceralFatPoints = data.visceralFatPoints || 0;
  const proteinGoal = 150; 
  const fatPointsGoal = 3000; 

  const proteinProgress = Math.min(100, (dailyProteinG / proteinGoal) * 100);
  const fatProgress = Math.min(100, (visceralFatPoints / fatPointsGoal) * 100);

  const handleConnectFitbit = () => {
    if (!user) return;
    window.location.href = fitbitService.getAuthUrl(user.uid);
  };

  return (
    <div className="flex flex-col gap-10 p-6 md:p-12 lg:p-16 pb-24 bg-background h-full overflow-y-auto">
      <div className="space-y-6">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.2em] italic">Live Market Audit</h2>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <span className="text-[12px] font-bold text-emerald-600 uppercase">Active Session</span>
          </div>
        </div>

        {!data.isDeviceVerified && (
          <Card className="border-none bg-orange-50 ring-1 ring-orange-200 shadow-sm overflow-hidden">
             <CardContent className="p-4 flex items-center justify-between gap-4">
               <div className="flex items-center gap-3">
                 <div className="p-2 bg-orange-100 rounded-lg">
                   <ShieldAlert className="w-5 h-5 text-orange-600" />
                 </div>
                 <div>
                   <p className="text-xs font-black uppercase tracking-tight text-orange-800">Unverified Metrics Detected</p>
                   <p className="text-[10px] font-bold text-orange-700/70">Connect hardware to authorize a "Triple-A Rated" audit.</p>
                 </div>
               </div>
               <Button size="sm" onClick={handleConnectFitbit} className="bg-orange-600 hover:bg-orange-700 text-white font-black text-[10px] uppercase h-8 px-4 rounded-lg">
                 Connect Fitbit
                 <CloudLightning className="w-3 h-3 ml-2" />
               </Button>
             </CardContent>
          </Card>
        )}
        
        <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
          <CardContent className="p-6 sm:p-10 flex items-center gap-8">
            <div className="p-6 bg-purple-100 rounded-2xl shrink-0 shadow-sm">
              <DollarSign className="w-10 h-10 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-end mb-4">
                <p className="text-base font-black text-foreground uppercase tracking-tight">Protein Liquidity</p>
                <span className="text-sm font-black text-muted-foreground">{dailyProteinG}g <span className="opacity-50">/</span> {proteinGoal}g</span>
              </div>
              <Progress value={proteinProgress} className="h-4 bg-purple-50" />
              <p className="mt-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Solvency Status: {proteinProgress >= 100 ? 'BULLISH' : 'PENDING DEPOSIT'}</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
            <CardContent className="p-6 sm:p-10">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-orange-100 rounded-xl shadow-sm">
                  <Zap className="w-6 h-6 text-orange-600" />
                </div>
                {data.isDeviceVerified && <ShieldCheck className="w-4 h-4 text-emerald-500" />}
              </div>
              <p className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.1em] mb-2">Steps Inventory</p>
              <h4 className="text-4xl font-black italic">{(data.steps || 0).toLocaleString()}</h4>
              <div className="mt-4 h-1 w-12 bg-orange-200 rounded-full" />
            </CardContent>
          </Card>

          <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
            <CardContent className="p-6 sm:p-10">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-blue-100 rounded-xl shadow-sm">
                  <Target className="w-6 h-6 text-blue-600" />
                </div>
                {data.isDeviceVerified && <ShieldCheck className="w-4 h-4 text-emerald-500" />}
              </div>
              <p className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.1em] mb-2">Recovery Audit</p>
              <h4 className="text-4xl font-black italic uppercase tracking-tighter">{data.recoveryStatus || 'MEDIUM'}</h4>
              <div className="mt-4 h-1 w-12 bg-blue-200 rounded-full" />
            </CardContent>
          </Card>

          <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300 lg:col-span-1 hidden lg:block">
            <CardContent className="p-6 sm:p-10">
              <div className="p-3 bg-emerald-100 rounded-xl w-fit mb-4 shadow-sm">
                <Target className="w-6 h-6 text-emerald-600" />
              </div>
              <p className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.1em] mb-2">Portfolio Day</p>
              <h4 className="text-4xl font-black italic uppercase tracking-tighter">{data.onboardingDay || 1}</h4>
              <div className="mt-4 h-1 w-12 bg-emerald-200 rounded-full" />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-1 italic">Long-Term Portfolio</h2>
        <Card className="border-none shadow-xl overflow-hidden bg-primary text-white group cursor-default">
          <CardContent className="p-8 md:p-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="flex items-center gap-6 min-w-0">
              <div className="p-5 bg-white/10 rounded-2xl shrink-0 group-hover:bg-white/20 transition-colors">
                <Briefcase className="w-10 h-10 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-black uppercase tracking-widest opacity-80 mb-2">Equity Score (VF Points)</p>
                <h3 className="text-4xl lg:text-5xl font-black italic tracking-tighter truncate">
                  {(visceralFatPoints).toLocaleString()} 
                  <span className="text-sm font-normal opacity-60 ml-4">/ {fatPointsGoal.toLocaleString()}</span>
                </h3>
              </div>
            </div>
            <div className="text-right shrink-0 bg-white/10 p-4 px-8 rounded-2xl backdrop-blur-md">
              <p className="text-3xl font-black text-emerald-300 italic">{fatProgress.toFixed(1)}%</p>
              <p className="text-[10px] font-black uppercase opacity-60">Audit Completion</p>
            </div>
          </CardContent>
          <Progress value={fatProgress} className="h-2.5 rounded-none bg-white/10" />
        </Card>
      </div>
    </div>
  );
}
