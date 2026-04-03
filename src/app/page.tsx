'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Briefcase, ShieldCheck, MessageSquare, Target, History, LogOut, Cloud, LayoutGrid, Loader2, ArrowRight, User as UserIcon, Info, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth, useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { signInAnonymously, linkWithPopup, GoogleAuthProvider, signOut, signInWithPopup } from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { runInternalAudit } from '@/lib/internal-audit';
import { healthService, HealthData } from '@/lib/health-service';
import { syncFitbitData, getFitbitLastSyncedAt, backfillFitbitHistory } from '@/app/actions/fitbit';

const ChatInterface = dynamic(() => import('@/components/chat-interface').then(m => ({ default: m.ChatInterface })), {
  ssr: false,
  loading: () => <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>,
});
const DashboardCards = dynamic(() => import('@/components/dashboard-cards').then(m => ({ default: m.DashboardCards })), {
  ssr: false,
  loading: () => <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>,
});
const HistoryView = dynamic(() => import('@/components/history-view').then(m => ({ default: m.HistoryView })), {
  ssr: false,
  loading: () => <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>,
});
const PreferencesView = dynamic(() => import('@/components/preferences-view').then(m => ({ default: m.PreferencesView })), {
  ssr: false,
  loading: () => <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>,
});
const AboutView = dynamic(() => import('@/components/about-view').then(m => ({ default: m.AboutView })), {
  ssr: false,
  loading: () => <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>,
});

/** Must match SYNC_INTERVAL_MS in fitbit-sync.ts — 6 hours. */
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export default function Home() {
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('chat');
  const [isAuditing, setIsAuditing] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const hasSyncedFitbit = useRef(false);
  const hasBackfilledFitbit = useRef(false);

  // Pull-to-refresh state (Today tab)
  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const dailyScrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const pullDistanceRef = useRef(0);
  const isPullRefreshingRef = useRef(false);
  const PULL_THRESHOLD = 72;

  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData, isLoading: isHealthLoading } = useDoc<HealthData>(userDocRef);

  useEffect(() => {
    if (user && db) {
      healthService.getHealthSummary(db, user.uid);
      healthService.getUserPreferences(db, user.uid);
    }
  }, [user, db]);

  // Sync Fitbit data on load if the last sync was more than 6 hours ago
  // (or if we've never synced). Runs once per session.
  useEffect(() => {
    if (!user || !healthData?.isDeviceVerified || healthData?.connectedDevice === 'oura' || hasSyncedFitbit.current) return;
    hasSyncedFitbit.current = true;

    (async () => {
      try {
        const lastSynced = await getFitbitLastSyncedAt(user.uid);
        const stale = !lastSynced || Date.now() - lastSynced >= SYNC_INTERVAL_MS;
        if (stale) {
          const localDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local TZ
          const result = await syncFitbitData(user.uid, localDate);
          if (!result.success && result.reason === 'token_refresh_failed') {
            toast({ variant: 'destructive', title: 'Sync Failed', description: 'Token expired and could not be refreshed. Reconnect your Fitbit.' });
          }
        }
      } catch (e) {
        console.error('[AutoSync] Failed:', e);
      }
    })();
  }, [user, healthData?.isDeviceVerified, healthData?.connectedDevice]);

  // Backfill historical Fitbit snapshots once per session if yesterday is missing.
  // Silently fires in the background — no toast, no spinner.
  useEffect(() => {
    if (!user || !healthData?.isDeviceVerified || healthData?.connectedDevice === 'oura' || hasBackfilledFitbit.current) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('en-CA');
    const hasYesterday = !!healthData?.fitbitByDate?.[yesterdayStr];
    if (hasYesterday) return; // already populated, skip
    hasBackfilledFitbit.current = true;
    backfillFitbitHistory(user.uid).catch(e => console.error('[BackfillFitbit] Failed:', e));
  }, [user, healthData?.isDeviceVerified, healthData?.fitbitByDate]);

  // Persist active tab across page reloads (prevents native PTR from resetting to 'chat').
  useEffect(() => {
    const saved = sessionStorage.getItem('cfo_activeTab');
    if (saved && ['chat', 'daily', 'history', 'assets', 'about'].includes(saved)) {
      setActiveTab(saved);
    }
  }, []);

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    sessionStorage.setItem('cfo_activeTab', tab);
  }, []);

  // Keep the ref in sync so PTR handlers always see the latest value.
  useEffect(() => { isPullRefreshingRef.current = isPullRefreshing; }, [isPullRefreshing]);

  // Fitbit sync used by pull-to-refresh — stable ref pattern so the touch
  // handlers registered once still call the latest version.
  const doFitbitSync = useCallback(async () => {
    if (!user) return;
    setIsPullRefreshing(true);
    isPullRefreshingRef.current = true;
    try {
      const localDate = new Date().toLocaleDateString('en-CA');
      const result = await syncFitbitData(user.uid, localDate);
      if (result.success) {
        toast({ title: 'Synced', description: 'Portfolio data updated.' });
      } else if (result.reason === 'token_refresh_failed') {
        toast({ variant: 'destructive', title: 'Sync Failed', description: 'Token expired — reconnect your Fitbit.' });
      } else if (result.reason === 'no_credentials') {
        toast({ title: 'Refreshed', description: 'Data is live from Firestore.' });
      } else {
        toast({ variant: 'destructive', title: 'Sync Failed', description: 'Could not reach Fitbit API.' });
      }
    } finally {
      setIsPullRefreshing(false);
      isPullRefreshingRef.current = false;
    }
  }, [user, toast]);

  const doFitbitSyncRef = useRef(doFitbitSync);
  useEffect(() => { doFitbitSyncRef.current = doFitbitSync; }, [doFitbitSync]);

  // Custom pull-to-refresh on the Today tab.
  // Uses passive:true for touchstart, passive:false for touchmove (to call preventDefault).
  // overscroll-y-contain on the container blocks the native browser PTR.
  useEffect(() => {
    const el = dailyScrollRef.current;
    if (!el || activeTab !== 'daily') return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop === 0 && !isPullRefreshingRef.current) {
        touchStartY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPulling.current || isPullRefreshingRef.current) return;
      const delta = e.touches[0].clientY - touchStartY.current;
      if (delta > 0 && el.scrollTop === 0) {
        e.preventDefault();
        const clamped = Math.min(delta, PULL_THRESHOLD * 1.5);
        pullDistanceRef.current = clamped;
        setPullDistance(clamped);
      } else if (delta < 0) {
        isPulling.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      if (!isPulling.current) return;
      isPulling.current = false;
      const dist = pullDistanceRef.current;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      if (dist >= PULL_THRESHOLD) {
        doFitbitSyncRef.current();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [activeTab]);

  // Show toast for Fitbit OAuth callback result.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('fitbit_sync') === 'success') {
      toast({ title: 'Fitbit Linked', description: 'Hardware verified. Device data is now trusted.' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('error')?.startsWith('fitbit_')) {
      toast({ variant: 'destructive', title: 'Fitbit Link Failed', description: 'Check your Fitbit credentials and try again.' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [toast]);

  const handleAnonymousLogin = async () => {
    setIsLoggingIn(true);
    try {
      await signInAnonymously(auth);
      toast({ title: "Quick Entry Authorized", description: "Orientation briefing initiated." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Access Denied", description: e.message });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      toast({ title: "Portfolio Secured", description: "Identity verified. Full ledger access granted." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Verification Failed", description: e.message });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleUpgradeAccount = async () => {
    if (!user) return;
    const provider = new GoogleAuthProvider();
    try {
      await linkWithPopup(user, provider);
      toast({ title: "Portfolio Secured", description: "Your assets are now linked to your Google account." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Sync Failed", description: error.message });
    }
  };

  const handleInternalAudit = async () => {
    if (!user) return;
    setIsAuditing(true);
    toast({ title: "Audit Initialized", description: "Running CFO diagnostic suite..." });

    await runInternalAudit(db, user.uid, (test, success, message) => {
      toast({
        variant: success ? "default" : "destructive",
        title: `Audit ${test} ${success ? 'Passed' : 'Failed'}`,
        description: message
      });
    });

    setIsAuditing(false);
  };

  if (!user && !isUserLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent/5 rounded-full blur-3xl" />

        <div className="max-w-md w-full space-y-10 text-center relative z-10">
          <div className="space-y-6">
            <div className="mx-auto p-5 bg-primary text-white w-fit rounded-[2rem] shadow-2xl rotate-3 hover:rotate-0 transition-transform duration-500">
              <Briefcase className="w-10 h-10" />
            </div>
            <div className="space-y-2">
              <h1 className="text-5xl font-black tracking-tighter italic uppercase text-foreground leading-none">The CFO</h1>
              <p className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.4em]">Chief Fitness Officer</p>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-lg font-medium text-muted-foreground leading-relaxed px-4">
              Your body is a high-stakes portfolio. We&apos;ve been hired to audit your visceral fat and protein solvency.
            </p>
            <div className="h-1 w-12 bg-primary/20 mx-auto rounded-full" />
          </div>

          <div className="grid gap-4 px-2">
            <Button
              className="h-16 rounded-2xl text-base font-black uppercase tracking-widest shadow-xl group"
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
            >
              {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                <>
                  Secure Portfolio Entry
                  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </Button>
            <Button
              variant="outline"
              className="h-16 rounded-2xl text-xs font-black uppercase tracking-widest border-2"
              onClick={handleAnonymousLogin}
              disabled={isLoggingIn}
            >
              Quick Audit (Anonymous)
            </Button>
          </div>

          <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-40">
            Strict Data Solvency • Encrypted Audit Trails • No Garbage Data
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/privacy" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              Privacy Policy
            </Link>
            <span className="text-muted-foreground/30 text-[9px]">•</span>
            <Link href="/terms" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isUserLoading || (user && !healthData && isHealthLoading)) {
    return (
      <div className="h-screen bg-background flex flex-col items-center justify-center space-y-6">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
        <div className="text-center space-y-1">
          <p className="text-[12px] font-black uppercase tracking-[0.3em] text-muted-foreground">Initializing Terminal</p>
          <p className="text-xs font-bold text-primary italic">Syncing Portfolio Assets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full md:max-w-6xl mx-auto bg-background md:shadow-2xl overflow-hidden md:border-x">
      <header className="p-4 px-6 flex items-center justify-between glass-morphism border-b z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary text-white rounded-xl shadow-md">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter leading-none text-foreground italic uppercase">The CFO</h1>
            <p className="text-[10px] font-black text-muted-foreground uppercase mt-0.5 tracking-widest opacity-70">
              Chief Fitness Officer <span className="opacity-50 font-mono normal-case">· {process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!user?.isAnonymous && (
            <div className="hidden md:flex flex-col items-end mr-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary italic">Verified Identity</p>
              <p className="text-xs font-bold text-foreground truncate max-w-[150px]">{user?.displayName || user?.email}</p>
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-muted relative overflow-hidden h-10 w-10 border-2 border-primary/20 p-0">
                {isAuditing ? (
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                ) : (
                  <Avatar className="h-full w-full">
                    <AvatarImage src={user?.photoURL || undefined} />
                    <AvatarFallback className="bg-secondary text-primary font-black text-xs">
                      {user?.displayName?.charAt(0) || user?.email?.charAt(0) || <UserIcon className="w-4 h-4" />}
                    </AvatarFallback>
                  </Avatar>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="flex flex-col gap-1 p-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Portfolio Owner</span>
                <span className="text-sm font-bold text-foreground truncate">{user?.displayName || user?.email || 'Anonymous Auditor'}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {user?.isAnonymous && (
                <DropdownMenuItem onClick={handleUpgradeAccount} className="flex items-center gap-2 text-primary font-black uppercase text-xs p-3 cursor-pointer">
                  <Cloud className="w-4 h-4" />
                  <span>Secure Portfolio (Google)</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleInternalAudit} className="flex items-center gap-2 font-bold uppercase text-xs p-3 cursor-pointer">
                <ShieldCheck className="w-4 h-4" />
                <span>Run Internal Audit</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut(auth)} className="text-destructive font-bold uppercase text-xs p-3 cursor-pointer">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col h-full overflow-hidden">
          <div className="flex-1 relative overflow-hidden h-full">
            {activeTab === 'chat' && (
              <div className="h-full w-full absolute inset-0 flex flex-col">
                <ChatInterface />
              </div>
            )}
            {activeTab === 'daily' && (
              <div ref={dailyScrollRef} className="h-full w-full absolute inset-0 overflow-y-auto overscroll-y-contain">
                {/* Pull-to-refresh indicator */}
                <div
                  className="flex items-center justify-center overflow-hidden transition-all duration-150"
                  style={{ height: isPullRefreshing ? 52 : Math.round(pullDistance * 0.55) }}
                >
                  {isPullRefreshing ? (
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  ) : pullDistance > 0 ? (
                    <RefreshCw
                      className="w-5 h-5 text-primary/60"
                      style={{
                        transform: `rotate(${Math.min((pullDistance / PULL_THRESHOLD) * 180, 180)}deg)`,
                        opacity: Math.min(pullDistance / PULL_THRESHOLD, 1),
                      }}
                    />
                  ) : null}
                </div>
                <DashboardCards data={healthData} isLoading={isHealthLoading} />
              </div>
            )}
            {activeTab === 'history' && (
              <div className="h-full w-full absolute inset-0 overflow-y-auto">
                <HistoryView />
              </div>
            )}
            {activeTab === 'assets' && (
              <div className="h-full w-full absolute inset-0 overflow-y-auto">
                <PreferencesView />
              </div>
            )}
            {activeTab === 'about' && (
              <div className="h-full w-full absolute inset-0 overflow-y-auto">
                <AboutView />
              </div>
            )}
          </div>

          <TabsList className="grid grid-cols-5 h-20 bg-card border-t rounded-none shrink-0 p-0 gap-0">
            <TabsTrigger value="chat" className="flex flex-col gap-1.5 h-full rounded-none data-[state=active]:bg-muted/50 transition-all">
              <MessageSquare className="w-5 h-5" />
              <span className="text-[9px] font-black uppercase tracking-widest">Coach</span>
            </TabsTrigger>
            <TabsTrigger value="daily" className="flex flex-col gap-1.5 h-full rounded-none data-[state=active]:bg-muted/50 transition-all">
              <Target className="w-5 h-5" />
              <span className="text-[9px] font-black uppercase tracking-widest">Today</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex flex-col gap-1.5 h-full rounded-none data-[state=active]:bg-muted/50 transition-all">
              <History className="w-5 h-5" />
              <span className="text-[9px] font-black uppercase tracking-widest">Ledger</span>
            </TabsTrigger>
            <TabsTrigger value="assets" className="flex flex-col gap-1.5 h-full rounded-none data-[state=active]:bg-muted/50 transition-all">
              <LayoutGrid className="w-5 h-5" />
              <span className="text-[9px] font-black uppercase tracking-widest">About Me</span>
            </TabsTrigger>
            <TabsTrigger value="about" className="flex flex-col gap-1.5 h-full rounded-none data-[state=active]:bg-muted/50 transition-all">
              <Info className="w-5 h-5" />
              <span className="text-[9px] font-black uppercase tracking-widest">About</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </main>
    </div>
  );
}
