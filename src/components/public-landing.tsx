'use client';

import React from 'react';
import Link from 'next/link';
import { Briefcase, ShieldCheck, MessageSquare, Target, History, ArrowRight, Activity, Zap, BarChart3, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface PublicLandingProps {
  onLogin: () => void;
  onAnonymousLogin: () => void;
  isLoggingIn: boolean;
}

export function PublicLanding({ onLogin, onAnonymousLogin, isLoggingIn }: PublicLandingProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Navigation */}
      <nav className="p-4 px-6 flex items-center justify-between glass-morphism border-b sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary text-white rounded-xl shadow-md">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter leading-none text-foreground italic uppercase">the CFO</h1>
            <p className="text-[10px] font-black text-muted-foreground uppercase mt-0.5 tracking-widest opacity-70">
              Chief Fitness Officer
            </p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-6">
          <Link href="#features" className="text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">Features</Link>
          <Link href="#purpose" className="text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">Purpose</Link>
          <Link href="/privacy" className="text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">Privacy</Link>
          <Button 
            size="sm" 
            className="rounded-xl font-black uppercase tracking-widest text-[10px] h-9"
            onClick={onLogin}
            disabled={isLoggingIn}
          >
            Launch App
          </Button>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          className="md:hidden rounded-xl font-black uppercase tracking-widest text-[10px] h-9 border-2"
          onClick={onLogin}
          disabled={isLoggingIn}
        >
          Login
        </Button>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-20 pb-32 px-6 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent/5 rounded-full blur-3xl animate-pulse" />
        
        <div className="max-w-4xl mx-auto text-center space-y-10 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary mb-4">
            <Zap className="w-3 h-3 fill-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Now in Public Beta</span>
          </div>
          
          <div className="space-y-4">
            <h2 className="text-6xl md:text-8xl font-black tracking-tighter italic uppercase text-foreground leading-[0.9]">
              Audit Your <span className="text-primary">Biology</span>
            </h2>
            <p className="text-xl md:text-2xl font-medium text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              the CFO (Chief Fitness Officer) treats your health as a high-stakes portfolio. We audit your metrics, identify liabilities, and optimize your assets.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Button
              className="h-16 px-10 rounded-2xl text-base font-black uppercase tracking-widest shadow-2xl group w-full sm:w-auto"
              onClick={onLogin}
              disabled={isLoggingIn}
            >
              Start Your Audit
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button
              variant="outline"
              className="h-16 px-10 rounded-2xl text-xs font-black uppercase tracking-widest border-2 w-full sm:w-auto bg-background/50 backdrop-blur-sm"
              onClick={onAnonymousLogin}
              disabled={isLoggingIn}
            >
              Quick Preview (No Data Save)
            </Button>
          </div>

          <div className="pt-12 flex flex-wrap justify-center gap-8 opacity-40 grayscale group-hover:grayscale-0 transition-all">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />
              <span className="text-xs font-black uppercase tracking-widest">Secure Data</span>
            </div>
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              <span className="text-xs font-black uppercase tracking-widest">Private Audit</span>
            </div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              <span className="text-xs font-black uppercase tracking-widest">Real-time Sync</span>
            </div>
          </div>
        </div>
      </section>

      {/* Purpose Section */}
      <section id="purpose" className="py-24 px-6 bg-muted/30">
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-16 items-center">
          <div className="space-y-6">
            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-primary italic">Our Purpose</h3>
            <h4 className="text-4xl font-black tracking-tight leading-none uppercase">Health is the ultimate <span className="italic">Solvency</span></h4>
            <p className="text-lg text-muted-foreground leading-relaxed">
              We believe health tracking is often too vague. &quot;the CFO&quot; was built to bring clinical-grade rigor to daily habits. By quantifying your activity, nutrition, and sleep into a unified &quot;Equity Score,&quot; we help you stay accountable to the only ledger that truly matters.
            </p>
            <ul className="space-y-3">
              {[
                "Eliminate 'Garbage Data' through hardware verification",
                "Calibrate metabolic engines via DEXA scan integration",
                "Provide data-driven coaching that never guesses"
              ].map(item => (
                <li key={item} className="flex items-center gap-3 text-sm font-bold">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative">
            <div className="aspect-square bg-gradient-to-br from-primary/20 to-accent/20 rounded-[3rem] rotate-3 flex items-center justify-center p-8 border-4 border-dashed border-primary/20">
              <div className="text-center space-y-4">
                <BarChart3 className="w-24 h-24 text-primary mx-auto opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Calibration Suite v1.0</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto space-y-16">
          <div className="text-center space-y-4">
            <h3 className="text-4xl font-black tracking-tight uppercase">Audit Modules</h3>
            <p className="text-muted-foreground max-w-xl mx-auto">Everything you need to maintain biological solvency.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: <MessageSquare className="w-6 h-6" />,
                title: "AI Coach",
                desc: "Real-time nutritional audit and workout programming powered by Gemini 2.0 Flash."
              },
              {
                icon: <Target className="w-6 h-6" />,
                title: "Asset Tracker",
                desc: "Monitor your protein intake and muscle mass like a high-growth asset class."
              },
              {
                icon: <History className="w-6 h-6" />,
                title: "Audit Ledger",
                desc: "A permanent, encrypted record of every health decision and metabolic shift."
              }
            ].map((feature, i) => (
              <Card key={i} className="border-none shadow-xl bg-card hover:translate-y-[-4px] transition-transform duration-300">
                <CardContent className="p-8 space-y-4">
                  <div className="p-4 bg-primary/10 text-primary w-fit rounded-2xl">
                    {feature.icon}
                  </div>
                  <h4 className="text-xl font-black uppercase italic tracking-tight">{feature.title}</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Footer / Privacy */}
      <footer className="py-12 border-t bg-background mt-auto">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-8 text-center md:text-left">
          <div className="space-y-2">
            <div className="flex items-center justify-center md:justify-start gap-2">
              <Briefcase className="w-4 h-4 text-primary" />
              <span className="font-black uppercase tracking-tighter text-lg">the CFO</span>
            </div>
            <p className="text-xs text-muted-foreground max-w-xs">
              Your data is your property. We only audit it with your explicit permission.
            </p>
          </div>
          
          <div className="flex flex-col items-center md:items-end gap-4">
            <div className="flex items-center gap-6">
              <Link href="/privacy" className="text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
                Privacy Policy
              </Link>
              <Link href="/terms" className="text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors">
                Terms of Service
              </Link>
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-40">
              © 2026 the CFO • All Rights Reserved
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
