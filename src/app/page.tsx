
'use client';

import React, { useState, useEffect } from 'react';
import { ChatInterface } from '@/components/chat-interface';
import { DashboardCards } from '@/components/dashboard-cards';
import { HistoryView } from '@/components/history-view';
import { PreferencesView } from '@/components/preferences-view';
import { Briefcase, Settings, ShieldCheck, MessageSquare, Target, History, LogOut, Cloud, LayoutGrid } from 'lucide-react';
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

export default function Home() {
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const { toast } = useToast();

  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData } = useDoc(userDocRef);

  useEffect(() => {
    if (!isUserLoading && !user) {
      signInAnonymously(auth).catch(console.error);
    }
  }, [user, isUserLoading, auth]);

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

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto bg-background shadow-xl overflow-hidden">
      <header className="p-4 flex items-center justify-between glass-morphism border-b z-10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-primary text-white rounded-lg">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-none text-foreground">CFO Fitness</h1>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mt-0.5">Asset Management System</p>
          </div>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Settings className="w-5 h-5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {user?.isAnonymous && (
              <DropdownMenuItem onClick={handleUpgradeAccount} className="flex items-center gap-2 text-primary font-bold">
                <Cloud className="w-4 h-4" />
                <span>Save My Portfolio</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              <span>Internal Audit</span>
            </DropdownMenuItem>
            {!user?.isAnonymous && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut(auth)} className="text-destructive">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <Tabs defaultValue="chat" className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <TabsContent value="chat" className="h-full m-0 flex flex-col">
              <ChatInterface />
            </TabsContent>
            <TabsContent value="daily" className="h-full m-0 overflow-y-auto">
              <DashboardCards data={healthData} />
            </TabsContent>
            <TabsContent value="history" className="h-full m-0 overflow-y-auto">
              <HistoryView />
            </TabsContent>
            <TabsContent value="assets" className="h-full m-0 overflow-y-auto">
              <PreferencesView />
            </TabsContent>
          </div>

          <TabsList className="grid grid-cols-4 h-16 bg-card border-t rounded-none shrink-0 p-0">
            <TabsTrigger value="chat" className="flex flex-col gap-1 h-full rounded-none">
              <MessageSquare className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase">Coach</span>
            </TabsTrigger>
            <TabsTrigger value="daily" className="flex flex-col gap-1 h-full rounded-none">
              <Target className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase">Focus</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex flex-col gap-1 h-full rounded-none">
              <History className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase">Audit</span>
            </TabsTrigger>
            <TabsTrigger value="assets" className="flex flex-col gap-1 h-full rounded-none">
              <LayoutGrid className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase">Portfolio</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </main>
    </div>
  );
}
