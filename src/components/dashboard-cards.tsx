
'use client';

import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Target, Zap, DollarSign, Briefcase, Loader2, ShieldAlert, CloudLightning, ShieldCheck, Scale, Ruler, RefreshCw, Unplug } from "lucide-react";
import { HealthData, UserPreferences, FitbitCredentials, healthService } from '@/lib/health-service';
import { fitbitService } from '@/lib/fitbit-service';
import { syncFitbitData, SyncResult } from '@/app/actions/fitbit';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { DashboardCharts } from './dashboard-charts';
import { useToast } from '@/hooks/use-toast';
import { doc } from 'firebase/firestore';

function formatTimeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface DashboardCardsProps {
  data: HealthData | null;
  isLoading?: boolean;
}

export function DashboardCards({ data, isLoading }: DashboardCardsProps) {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  // Read targets from user preferences instead of hardcoding
  const prefsRef = useMemoFirebase(
    () => user ? doc(db, 'users', user.uid, 'preferences', 'settings') : null,
    [db, user]
  );
  const { data: prefs } = useDoc<UserPreferences>(prefsRef);

  // Read Fitbit credentials to show lastSyncedAt in the UI.
  const fitbitTokensRef = useMemoFirebase(
    () => user ? doc(db, 'users', user.uid, 'preferences', 'fitbit_tokens') : null,
    [db, user]
  );
  const { data: fitbitCreds } = useDoc<FitbitCredentials>(fitbitTokensRef);

  const [isSyncing, setIsSyncing] = React.useState(false);

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

  const now = new Date();
  const localDate = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');
  const isNewDay = data.lastActiveDate !== localDate;

  // User-logged intake resets on a new day (nothing eaten yet).
  const dailyProteinG = isNewDay ? 0 : (data.dailyProteinG || 0);
  const dailyCaloriesIn = isNewDay ? 0 : (data.dailyCaloriesIn || 0);
  const dailyCarbsG = isNewDay ? 0 : (data.dailyCarbsG || 0);
  // Fitbit calorie burn is device-sourced — use it whenever available, even on a new day.
  const dailyCaloriesOut = data.dailyCaloriesOut || 2000;

  const visceralFatPoints = data.visceralFatPoints || 0;
  const proteinGoal = prefs?.targets?.proteinGoal ?? 150;
  const fatPointsGoal = prefs?.targets?.fatPointsGoal ?? 3000;

  const proteinProgress = Math.min(100, (dailyProteinG / proteinGoal) * 100);
  const fatProgress = Math.min(100, (visceralFatPoints / fatPointsGoal) * 100);

  const handleConnectFitbit = async () => {
    if (!user) return;

    const clientId = process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID;
    if (!clientId) {
      // No real Fitbit credentials — run mock handshake locally
      try {
        await healthService.saveFitbitCredentials(db, user.uid, {
          accessToken: 'mock_token',
          refreshToken: 'mock_refresh',
          fitbitUserId: 'mock_fitbit_user',
          expiresAt: Date.now() + 8 * 60 * 60 * 1000,
        });
        await healthService.updateHealthData(db, user.uid, {
          isDeviceVerified: true,
          steps: 8432,
          sleepHours: 7.2,
          hrv: 62,
        });
        toast({ title: 'Fitbit Linked (Demo)', description: 'Mock device data loaded. Set NEXT_PUBLIC_FITBIT_CLIENT_ID for real integration.' });
      } catch (e) {
        console.error('[Fitbit Mock] Failed:', e);
        toast({ variant: 'destructive', title: 'Connection Failed', description: 'Could not simulate Fitbit link.' });
      }
      return;
    }

    window.location.href = fitbitService.getAuthUrl(user.uid);
  };

  const handleResync = async () => {
    if (!user || isSyncing) return;
    setIsSyncing(true);
    let result: SyncResult | null = null;
    try {
      const localDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local TZ
      result = await syncFitbitData(user.uid, localDate);
    } catch (e) {
      console.error('[handleResync] syncFitbitData threw:', e);
    } finally {
      setIsSyncing(false);
    }
    if (!result) {
      toast({ variant: 'destructive', title: 'Sync Error', description: 'Unexpected error — check server logs.' });
    } else if (result.success) {
      toast({ title: 'Sync Complete', description: 'Fitbit data refreshed from your device.' });
    } else {
      const descriptions: Record<string, string> = {
        no_credentials: 'No Fitbit credentials found. Reconnect your Fitbit.',
        token_refresh_failed: 'Token expired and could not be refreshed. Reconnect your Fitbit.',
        api_failed: 'Fitbit API returned an error. Check server logs.',
        write_failed: 'Data fetched but Firestore write failed. Check server logs.',
      };
      toast({
        variant: 'destructive',
        title: 'Sync Failed',
        description: descriptions[result.reason] ?? 'Could not pull latest data.',
      });
    }
  };

  const handleDisconnectFitbit = async () => {
    if (!user) return;
    try {
      await healthService.deleteFitbitCredentials(db, user.uid);
      await healthService.updateHealthData(db, user.uid, {
        isDeviceVerified: false,
      });
      toast({ title: 'Fitbit Disconnected', description: 'Your device connection has been removed.' });
    } catch (e) {
      console.error('[Fitbit Disconnect] Failed:', e);
      toast({ variant: 'destructive', title: 'Disconnect Failed', description: 'Could not disconnect properly.' });
    }
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

        {data.isDeviceVerified ? (
          <Card className="border-none bg-emerald-50 ring-1 ring-emerald-200 shadow-sm overflow-hidden">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-tight text-emerald-800">Fitbit Connected</p>
                  <p className="text-[10px] font-bold text-emerald-700/70">
                    {fitbitCreds?.lastSyncedAt
                      ? `Last synced ${formatTimeAgo(fitbitCreds.lastSyncedAt)}. Auto-refreshes every 6h.`
                      : 'Device-verified steps, sleep, and HRV. Auto-refreshes every 6h.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleDisconnectFitbit} className="text-emerald-800 border-emerald-200 hover:bg-emerald-100 uppercase font-black text-[10px] h-8 px-3 rounded-lg">
                  <Unplug className="w-3 h-3 mr-1.5" />
                  Reset
                </Button>
                <Button size="sm" onClick={handleResync} disabled={isSyncing} className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase h-8 px-4 rounded-lg">
                  {isSyncing ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <RefreshCw className="w-3 h-3 mr-2" />}
                  Sync Now
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-none bg-orange-50 ring-1 ring-orange-200 shadow-sm overflow-hidden">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <ShieldAlert className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-tight text-orange-800">Self-Reported Data</p>
                  <p className="text-[10px] font-bold text-orange-700/70">Connect a device for verified steps, sleep, and HRV.</p>
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
              <div className="flex justify-between items-end mb-1">
                <p className="text-base font-black text-foreground uppercase tracking-tight">Protein Liquidity</p>
                <span className="text-sm font-black text-muted-foreground">{dailyProteinG}g <span className="opacity-50">/</span> {proteinGoal}g</span>
              </div>
              <p className="text-[10px] font-medium text-muted-foreground mb-3">Daily protein intake toward your goal. Tell the CFO what you ate to log it.</p>
              <Progress value={proteinProgress} className="h-4 bg-purple-50" />
              <p className="mt-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Solvency Status: {proteinProgress >= 100 ? 'BULLISH' : 'PENDING DEPOSIT'}</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
            <CardContent className="p-6 sm:p-10">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-orange-100 rounded-xl shadow-sm">
                  <Zap className="w-6 h-6 text-orange-600" />
                </div>
                {data.isDeviceVerified && <ShieldCheck className="w-4 h-4 text-emerald-500" />}
              </div>
              <p className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.1em] mb-1">Steps Inventory</p>
              <p className="text-[10px] font-medium text-muted-foreground mb-2">Daily steps from your Fitbit</p>
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
              <p className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.1em] mb-1">Recovery Audit</p>
              <p className="text-[10px] font-medium text-muted-foreground mb-2">Based on HRV ({data.hrv > 0 ? `${data.hrv}ms` : 'no reading'})</p>
              <h4 className="text-4xl font-black italic uppercase tracking-tighter">{data.hrv > 0 ? (data.recoveryStatus || 'MEDIUM') : 'N/A'}</h4>
              <div className="mt-4 h-1 w-12 bg-blue-200 rounded-full" />
            </CardContent>
          </Card>

          <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300">
            <CardContent className="p-6 sm:p-10">
              <div className="p-3 bg-emerald-100 rounded-xl w-fit mb-4 shadow-sm">
                <Scale className="w-6 h-6 text-emerald-600" />
              </div>
              <p className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.1em] mb-1">Portfolio Weight</p>
              <p className="text-[10px] font-medium text-muted-foreground mb-2">Body weight</p>
              <h4 className="text-4xl font-black italic uppercase tracking-tighter">{data.weightKg ? `${data.weightKg}kg` : 'N/A'}</h4>
              <div className="mt-4 h-1 w-12 bg-emerald-200 rounded-full" />
            </CardContent>
          </Card>

          <Card className="border-none shadow-md bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 hover:ring-primary/20 transition-all duration-300 hidden lg:block">
            <CardContent className="p-6 sm:p-10">
              <div className="p-3 bg-indigo-100 rounded-xl w-fit mb-4 shadow-sm">
                <Ruler className="w-6 h-6 text-indigo-600" />
              </div>
              <p className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.1em] mb-1">Height Asset</p>
              <p className="text-[10px] font-medium text-muted-foreground mb-2">Used for BMI calculations</p>
              <h4 className="text-4xl font-black italic uppercase tracking-tighter">{data.heightCm ? `${data.heightCm}cm` : 'N/A'}</h4>
              <div className="mt-4 h-1 w-12 bg-indigo-200 rounded-full" />
            </CardContent>
          </Card>
        </div>

        {/* Charts section */}
        <DashboardCharts caloriesIn={dailyCaloriesIn} caloriesOut={dailyCaloriesOut} carbsG={dailyCarbsG} />
      </div>

      <div className="space-y-4">
        <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-1 italic">Long-Term Portfolio</h2>
        {visceralFatPoints === 0 ? (
          <Card className="border-none shadow-xl overflow-hidden bg-primary text-white cursor-default">
            <CardContent className="p-8 md:p-12 flex flex-col gap-6">
              <div className="flex items-center gap-5">
                <div className="p-5 bg-white/10 rounded-2xl shrink-0">
                  <Briefcase className="w-10 h-10 text-white" />
                </div>
                <div>
                  <p className="text-[12px] font-black uppercase tracking-widest opacity-80 mb-1">Your Scoring System</p>
                  <p className="text-base font-black">Coming online after your first session</p>
                </div>
              </div>
              <div className="space-y-3 text-sm font-medium opacity-80 leading-relaxed">
                <p>The CFO builds a <span className="font-black text-white">custom daily point system</span> tuned to your goals. Every workout, protein target hit, and good night of sleep earns points.</p>
                <p>The score compounds over time — turning the fuzzy question <span className="italic">&ldquo;am I actually making progress?&rdquo;</span> into a number you can track and beat.</p>
                <p className="opacity-60 text-[11px] uppercase tracking-widest font-black">Chat with the CFO to calibrate your system →</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-none shadow-xl overflow-hidden bg-primary text-white group cursor-default">
            <CardContent className="p-8 md:p-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
              <div className="flex items-center gap-6 min-w-0">
                <div className="p-5 bg-white/10 rounded-2xl shrink-0 group-hover:bg-white/20 transition-colors">
                  <Briefcase className="w-10 h-10 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-black uppercase tracking-widest opacity-80 mb-1">Equity Score (VF Points)</p>
                  <p className="text-[10px] font-medium opacity-50 mb-2">Visceral fat reduction progress. Grows as you hit protein, activity, and sleep goals.</p>
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
        )}
      </div>
    </div>
  );
}
