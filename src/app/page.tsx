'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Briefcase, ShieldCheck, MessageSquare, Target, History, LogOut, Cloud, LayoutGrid, Loader2, ArrowRight, User as UserIcon, Info, RefreshCw, Settings } from 'lucide-react';
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
import { backfillScoreHistory } from '@/app/actions/score-history';
import { syncWithingsData } from '@/app/actions/withings';

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
const OnboardingTutorial = dynamic(() => import('@/components/onboarding-tutorial').then(m => ({ default: m.OnboardingTutorial })), {
  ssr: false,
});
const PublicLanding = dynamic(() => import('@/components/public-landing').then(m => ({ default: m.PublicLanding })), {
  ssr: false,
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
  const [showTutorial, setShowTutorial] = useState(false);
  const hasSyncedFitbit = useRef(false);
  const hasBackfilledFitbit = useRef(false);
  const hasBackfilledScores = useRef(false);

  // Pull-to-refresh state (Today tab)
  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const dailyScrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const isPullCandidate = useRef(false);
  const pullDistanceRef = useRef(0);
  const isPullRefreshingRef = useRef(false);
  // Gesture-classification dead-zone: the user must drag past this much in
  // the downward direction before we commit to PTR. Anything less is treated
  // as normal scrolling and never blocks the page.
  const PULL_COMMIT_PX = 16;
  // Distance past the dead-zone the user has to keep pulling for the refresh
  // to actually fire. Tuned to iOS Safari's native PTR feel.
  const PULL_THRESHOLD = 110;

  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData, isLoading: isHealthLoading } = useDoc<HealthData>(userDocRef);

  useEffect(() => {
    if (user && db) {
      healthService.getHealthSummary(db, user.uid);
      healthService.getUserPreferences(db, user.uid);
    }
  }, [user, db]);

  // Sync device data on load if the last sync was more than 6 hours ago
  // (or if we've never synced). Runs once per session.
  useEffect(() => {
    if (!user || !healthData?.isDeviceVerified || hasSyncedFitbit.current) return;
    
    // Skip if it's Oura (they use different patterns/background tasks usually)
    // Actually, let's just focus on Fitbit and Withings which we manage here.
    if (healthData?.connectedDevice === 'oura' || healthData?.connectedDevice === 'google') return;
    hasSyncedFitbit.current = true;

    (async () => {
      try {
        const lastSynced = await getFitbitLastSyncedAt(user.uid);
        const stale = !lastSynced || Date.now() - lastSynced >= SYNC_INTERVAL_MS;
        if (stale) {
          const localDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local TZ
          
          if (healthData?.connectedDevice === 'withings') {
            await syncWithingsData(user.uid, localDate);
          } else {
            const result = await syncFitbitData(user.uid, localDate);
            if (!result.success && result.reason === 'token_refresh_failed') {
              console.warn('[AutoSync] Fitbit/Google Health token refresh failed silently.');
            }
          }
        }
      } catch (e) {
        console.error('[AutoSync] Failed:', e);
      }
    })();
  }, [user, healthData?.isDeviceVerified, healthData?.connectedDevice, toast]);

  // Backfill historical Fitbit snapshots once per session if yesterday is missing.
  // Silently fires in the background — no toast, no spinner.
  useEffect(() => {
    if (!user || !healthData?.isDeviceVerified || healthData?.connectedDevice === 'oura' || healthData?.connectedDevice === 'google' || hasBackfilledFitbit.current) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('en-CA');
    const hasYesterday = !!healthData?.fitbitByDate?.[yesterdayStr];
    if (hasYesterday) return; // already populated, skip
    hasBackfilledFitbit.current = true;
    backfillFitbitHistory(user.uid).catch(e => console.error('[BackfillFitbit] Failed:', e));
  }, [user, healthData?.isDeviceVerified, healthData?.connectedDevice, healthData?.fitbitByDate]);

  // Auto-score backdated days into the equity history once per session.
  // Runs regardless of device — it scores any day with logged food/exercise,
  // using device calorie-burn where available and BMR estimates beyond it.
  useEffect(() => {
    if (!user || !healthData || hasBackfilledScores.current) return;
    hasBackfilledScores.current = true;
    const localDate = new Date().toLocaleDateString('en-CA');
    backfillScoreHistory(user.uid, localDate, 90).catch(e => console.error('[BackfillScores] Failed:', e));
  }, [user, healthData]);

  // Persist active tab across page reloads (prevents native PTR from resetting to 'chat').
  useEffect(() => {
    const saved = sessionStorage.getItem('cfo_activeTab');
    if (saved && ['chat', 'daily', 'history', 'assets', 'about'].includes(saved)) {
      setActiveTab(saved);
    }

    // Check if tutorial has been seen
    const tutorialSeen = localStorage.getItem('cfo_tutorialSeen');
    if (!tutorialSeen && user) {
      setShowTutorial(true);
    }
  }, [user]);

  const handleTutorialComplete = () => {
    setShowTutorial(false);
    localStorage.setItem('cfo_tutorialSeen', 'true');
  };

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
      
      if (healthData?.connectedDevice === 'withings') {
        const result = await syncWithingsData(user.uid, localDate);
        if (result.success) {
          toast({ title: 'Withings Synced', description: 'Calorie data refreshed.' });
        } else {
          toast({ variant: 'destructive', title: 'Sync Failed', description: 'Could not sync Withings data.' });
        }
        return;
      }

      const result = await syncFitbitData(user.uid, localDate);
      if (result.success) {
        toast({ title: 'Synced', description: 'Portfolio data updated.' });
      } else if (result.reason === 'token_refresh_failed') {
        toast({ variant: 'destructive', title: 'Sync Failed', description: 'Token expired — reconnect your device.' });
      } else if (result.reason === 'no_credentials') {
        toast({ title: 'Refreshed', description: 'Data is live from Firestore.' });
      } else {
        toast({ variant: 'destructive', title: 'Sync Failed', description: 'Could not reach the health API. Please try again.' });
      }
    } finally {
      setIsPullRefreshing(false);
      isPullRefreshingRef.current = false;
    }
  }, [user, toast, healthData?.connectedDevice]);

  const doFitbitSyncRef = useRef(doFitbitSync);
  useEffect(() => { doFitbitSyncRef.current = doFitbitSync; }, [doFitbitSync]);

  // Custom pull-to-refresh on the Today tab.
  // A touch at scrollTop=0 starts as a "candidate"; it only becomes a real
  // pull once the user has dragged past PULL_COMMIT_PX downward without first
  // moving upward. This dead-zone lets normal upward scroll-swipes through
  // without blocking the page.
  useEffect(() => {
    const el = dailyScrollRef.current;
    if (!el || activeTab !== 'daily') return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop === 0 && !isPullRefreshingRef.current) {
        touchStartY.current = e.touches[0].clientY;
        isPulling.current = false;
        isPullCandidate.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isPullRefreshingRef.current) return;
      if (!isPullCandidate.current && !isPulling.current) return;

      const delta = e.touches[0].clientY - touchStartY.current;

      // Classification phase: we haven't committed to PTR yet.
      if (!isPulling.current) {
        // Any upward movement during the dead-zone means the user is scrolling.
        // Abandon candidacy so the rest of the gesture is owned by the browser.
        if (delta < 0) {
          isPullCandidate.current = false;
          return;
        }
        // Still in the dead-zone — don't intercept the gesture.
        if (delta < PULL_COMMIT_PX) return;
        // Crossed the dead-zone going down. Only commit if we're still at the
        // top of the scroll container — otherwise the user already scrolled
        // somewhere and we shouldn't hijack the gesture.
        if (el.scrollTop !== 0) {
          isPullCandidate.current = false;
          return;
        }
        isPulling.current = true;
        isPullCandidate.current = false;
      }

      // Active pull — drive the indicator.
      const effective = delta - PULL_COMMIT_PX;
      if (effective > 0 && el.scrollTop === 0) {
        e.preventDefault();
        const clamped = Math.min(effective, PULL_THRESHOLD * 1.4);
        pullDistanceRef.current = clamped;
        setPullDistance(clamped);
      } else if (effective <= 0) {
        // User backed the pull off — release without firing.
        isPulling.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      isPullCandidate.current = false;
      if (!isPulling.current) return;
      isPulling.current = false;
      const dist = pullDistanceRef.current;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      if (dist >= PULL_THRESHOLD) {
        doFitbitSyncRef.current();
      }
    };

    const onTouchCancel = () => {
      isPullCandidate.current = false;
      isPulling.current = false;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchCancel);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [activeTab]);

  // Show toast for Fitbit OAuth callback result.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('fitbit_sync') === 'success') {
      toast({ title: 'Fitbit Linked', description: 'Hardware verified. Device data is now trusted.' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('withings_sync') === 'success') {
      toast({ title: 'Withings Linked', description: 'Withings hardware verified. Calorie data is now trusted.' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('error')?.startsWith('fitbit_')) {
      toast({ variant: 'destructive', title: 'Fitbit Link Failed', description: 'Check your Fitbit credentials and try again.' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('error')?.startsWith('withings_')) {
      toast({ variant: 'destructive', title: 'Withings Link Failed', description: 'Check your Withings credentials and try again.' });
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
      <PublicLanding 
        onLogin={handleGoogleLogin} 
        onAnonymousLogin={handleAnonymousLogin} 
        isLoggingIn={isLoggingIn} 
      />
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
    <div className="flex flex-col flex-1 w-full md:max-w-6xl mx-auto bg-background md:shadow-2xl md:border-x">
      <OnboardingTutorial 
        isOpen={showTutorial} 
        onComplete={handleTutorialComplete} 
      />
      <header className="p-4 px-6 flex items-center justify-between glass-morphism border-b z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary text-white rounded-xl shadow-md">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter leading-none text-foreground italic uppercase">the CFO</h1>
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
              <span className="text-[9px] font-black uppercase tracking-widest">Metrics</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex flex-col gap-1.5 h-full rounded-none data-[state=active]:bg-muted/50 transition-all">
              <History className="w-5 h-5" />
              <span className="text-[9px] font-black uppercase tracking-widest">Ledger</span>
            </TabsTrigger>
            <TabsTrigger value="assets" className="flex flex-col gap-1.5 h-full rounded-none data-[state=active]:bg-muted/50 transition-all">
              <Settings className="w-5 h-5" />
              <span className="text-[9px] font-black uppercase tracking-widest">Settings</span>
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
