'use client';

import React, { useState, useEffect } from 'react';
import { ChatInterface } from '@/components/chat-interface';
import { DashboardCards } from '@/components/dashboard-cards';
import { HistoryView } from '@/components/history-view';
import { PreferencesView } from '@/components/preferences-view';
import { Briefcase, Settings, ShieldCheck, MessageSquare, Target, History, LogOut, Cloud, LayoutGrid, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth, useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { signInAnonymously, linkWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
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

  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData, isLoading: isHealthLoading } = useDoc(userDocRef);

  // Auto-login logic
  useEffect(() => {
    if (!isUserLoading && !user) {
      signInAnonymously(auth).catch(console.error);
    }
  }, [user, isUserLoading, auth]);

  // Data Initialization logic: Ensure the user's "Portfolio" exists in Firestore
  useEffect(() => {
    if (user && db) {
      // Trigger "get or create" for profile and preferences
      healthService.getHealthSummary(db, user.uid);
      healthService.getUserPreferences(db, user.uid);
    }
  }, [user, db]);

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

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto bg-background shadow-2xl overflow-hidden border-x">
      <header className="p-4 px-6 flex items-center justify-between glass-morphism border-b z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary text-white rounded-xl shadow-md">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter leading-none text-foreground italic uppercase">The CFO</h1>
            <p className="text-[10px] font-black text-muted-foreground uppercase mt-0.5 tracking-widest opacity-70">Chief Fitness Officer • v2.0</p>
          </div>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-muted">
              {isAuditing ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : <Settings className="w-5 h-5 text-muted-foreground" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {user?.isAnonymous && (
              <DropdownMenuItem onClick={handleUpgradeAccount} className="flex items-center gap-2 text-primary font-black uppercase text-xs p-3">
                <Cloud className="w-4 h-4" />
                <span>Save My Portfolio</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleInternalAudit} className="flex items-center gap-2 font-bold uppercase text-xs p-3">
              <ShieldCheck className="w-4 h-4" />
              <span>Run Internal Audit</span>
            </DropdownMenuItem>
            {!user?.isAnonymous && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut(auth)} className="text-destructive font-bold uppercase text-xs p-3">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
