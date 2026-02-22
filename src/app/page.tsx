'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ChatInterface } from '@/components/chat-interface';
import { DashboardCards } from '@/components/dashboard-cards';
import { mockHealthService, HealthData } from '@/lib/health-service';
import { Briefcase, Settings, Menu, TrendingUp, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { runInternalAudit } from '@/lib/internal-audit';
import { useToast } from '@/hooks/use-toast';

export default function Home() {
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const { toast } = useToast();

  const fetchHealthData = useCallback(async () => {
    const data = await mockHealthService.getHealthSummary();
    setHealthData(data);
  }, []);

  useEffect(() => {
    fetchHealthData();
  }, [fetchHealthData]);

  const handleRunAudit = async () => {
    setIsAuditing(true);
    toast({
      title: "Initiating Internal Audit",
      description: "Executing Solvency, Blindness, and Liquidity protocols...",
    });

    await runInternalAudit((testNum, success, message) => {
      toast({
        variant: success ? "default" : "destructive",
        title: `Audit ${testNum}: ${success ? 'PASSED' : 'FAILED'}`,
        description: message,
      });
      fetchHealthData(); // Refresh UI after each test step
    });

    setIsAuditing(false);
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto bg-background shadow-xl overflow-hidden">
      {/* Header */}
      <header className="p-4 flex items-center justify-between glass-morphism border-b z-10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-primary text-white rounded-lg shadow-sm">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground leading-none">CFO Fitness</h1>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mt-0.5 text-xs">Asset Management System</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="rounded-full">
            <TrendingUp className="w-5 h-5 text-muted-foreground" />
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full" disabled={isAuditing}>
                <Settings className="w-5 h-5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={handleRunAudit} className="flex items-center gap-2 cursor-pointer">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span>Run Internal Audit</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="opacity-50 cursor-not-allowed">Market Configuration</DropdownMenuItem>
              <DropdownMenuItem className="opacity-50 cursor-not-allowed">Account Liquidity</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Main App Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        
        {/* Morning Audit Alert */}
        <div className="px-4 py-2 mt-2">
            <div className="bg-primary text-white p-3 rounded-xl flex items-center justify-between shadow-lg animate-in slide-in-from-top-4 duration-500">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase opacity-80">Audit Complete</p>
                        <p className="text-xs font-semibold">Portfolios healthy. High-intensity assets active.</p>
                    </div>
                </div>
                <ChevronRight className="w-4 h-4 opacity-50" />
            </div>
        </div>

        <DashboardCards data={healthData} />
        <ChatInterface onMessageProcessed={fetchHealthData} />
      </main>
    </div>
  );
}

function ChevronRight({ className }: { className?: string }) {
    return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m9 18 6-6-6-6"/></svg>;
}
