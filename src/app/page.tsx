'use client';

import React, { useState, useEffect } from 'react';
import { ChatInterface } from '@/components/chat-interface';
import { DashboardCards } from '@/components/dashboard-cards';
import { HistoryView } from '@/components/history-view';
import { PreferencesView } from '@/components/preferences-view';
import { Briefcase, Settings, ShieldCheck, MessageSquare, Target, History, LogOut, Cloud, LayoutGrid, Loader2, ArrowRight, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth, useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { signInAnonymously, linkWithPopup, GoogleAuthProvider, signOut, signInWithPopup } from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { runInternalAudit } from '@/lib/internal-audit';
import { healthService } from '@/lib/health-service';

export default function Home() {
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const { toast } = useToast();
  const [isAuditing, setIsAuditing] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData, isLoading: isHealthLoading } = useDoc(userDocRef);

  useEffect(() => {
    if (user && db) {
      healthService.getHealthSummary(db, user.uid);
      healthService.getUserPreferences(db, user.uid);
    }
  }, [user, db]);

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
              Your body is a high-stakes portfolio. We've been hired to audit your visceral fat and protein solvency.
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
              {healthData?.onboardingComplete ? 'Active Portfolio' : 'Discovery Audit'}
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
        <Tabs defaultValue="chat" className="flex-1 flex flex-col h-full overflow-hidden">
          <div className="flex-1 relative overflow-hidden h-full">
            <TabsContent value="chat" className="h-full w-full m-0 absolute inset-0 flex flex-col data-[state=inactive]:hidden">
              <ChatInterface />
            </TabsContent>
            <TabsContent value="daily" className="h-full w-full m-0 absolute inset-0 overflow-y-auto data-[state=inactive]:hidden">
              <DashboardCards data={healthData} isLoading={isHealthLoading} />
            </TabsContent>
            <TabsContent value="history" className="h-full w-full m-0 absolute inset-0 overflow-y-auto data-[state=inactive]:hidden">
              <HistoryView />
            </TabsContent>
            <TabsContent value="assets" className="h-full w-full m-0 absolute inset-0 overflow-y-auto data-[state=inactive]:hidden">
              <PreferencesView />
            </TabsContent>
          </div>

          <TabsList className="grid grid-cols-4 h-20 bg-card border-t rounded-none shrink-0 p-0 gap-0">
            <TabsTrigger value="chat" className="flex flex-col gap-1.5 h-full rounded-none data-[state=active]:bg-muted/50 transition-all">
              <MessageSquare className="w-6 h-6" />
              <span className="text-[10px] font-black uppercase tracking-widest">Coach</span>
            </TabsTrigger>
            <TabsTrigger value="daily" className="flex flex-col gap-1.5 h-full rounded-none data-[state=active]:bg-muted/50 transition-all">
              <Target className="w-6 h-6" />
              <span className="text-[10px] font-black uppercase tracking-widest">Focus</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex flex-col gap-1.5 h-full rounded-none data-[state=active]:bg-muted/50 transition-all">
              <History className="w-6 h-6" />
              <span className="text-[10px] font-black uppercase tracking-widest">Audit</span>
            </TabsTrigger>
            <TabsTrigger value="assets" className="flex flex-col gap-1.5 h-full rounded-none data-[state=active]:bg-muted/50 transition-all">
              <LayoutGrid className="w-6 h-6" />
              <span className="text-[10px] font-black uppercase tracking-widest">Assets</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </main>
    </div>
  );
}
