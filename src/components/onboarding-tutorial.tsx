
'use client';

import React, { useState, useEffect } from 'react';
import { 
  Briefcase, 
  Target, 
  MessageSquare, 
  History, 
  LayoutGrid, 
  ArrowRight, 
  CheckCircle2, 
  X,
  Zap
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";

interface OnboardingTutorialProps {
  onComplete: () => void;
  isOpen: boolean;
}

const steps = [
  {
    title: "Welcome to The Briefing",
    description: "Your body is a high-stakes portfolio. We've been hired to audit your visceral fat and protein solvency. I am your Chief Fitness Officer.",
    icon: <Briefcase className="w-12 h-12 text-primary" />,
    tab: null
  },
  {
    title: "The Coach Terminal",
    description: "This is where we talk. Log your meals by typing or snapping photos. I'll analyze the data and update your ledger in real-time.",
    icon: <MessageSquare className="w-12 h-12 text-primary" />,
    tab: 'chat'
  },
  {
    title: "Real-Time Dashboard",
    description: "The 'Today' tab shows your current asset allocation: Steps, Sleep, HRV, and your Protein Solvency. Keep these in the green to avoid a correction.",
    icon: <Target className="w-12 h-12 text-primary" />,
    tab: 'daily'
  },
  {
    title: "Historical Ledger",
    description: "Track your long-term equity. Every meal and workout is an entry. We're looking for consistent growth and low visceral fat liability.",
    icon: <History className="w-12 h-12 text-primary" />,
    tab: 'history'
  },
  {
    title: "Asset Management",
    description: "In 'About Me', you define your goals and equipment. This context helps me tailor your audits to your specific physiological constraints.",
    icon: <LayoutGrid className="w-12 h-12 text-primary" />,
    tab: 'assets'
  },
  {
    title: "System Ready",
    description: "The audit begins now. Start by telling me your main goal in the Coach terminal. Let's get to work.",
    icon: <Zap className="w-12 h-12 text-primary" />,
    tab: 'chat'
  }
];

export function OnboardingTutorial({ onComplete, isOpen }: OnboardingTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const skip = () => {
    onComplete();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onComplete()}>
      <DialogContent className="sm:max-w-[450px] bg-background/95 backdrop-blur-xl border-primary/20 shadow-2xl rounded-[2rem] p-8">
        <div className="absolute top-4 right-4">
          <Button variant="ghost" size="icon" onClick={skip} className="rounded-full opacity-50 hover:opacity-100">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex flex-col items-center text-center space-y-8 pt-4">
          <div className="p-6 bg-primary/5 rounded-[2.5rem] shadow-inner animate-in zoom-in duration-500">
            {steps[currentStep].icon}
          </div>

          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-3xl font-black italic uppercase tracking-tighter text-foreground">
              {steps[currentStep].title}
            </h2>
            <p className="text-base font-medium text-muted-foreground leading-relaxed px-2">
              {steps[currentStep].description}
            </p>
          </div>

          <div className="flex items-center gap-1.5 pt-2">
            {steps.map((_, i) => (
              <div 
                key={i} 
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentStep ? 'w-8 bg-primary' : 'w-2 bg-primary/20'
                }`} 
              />
            ))}
          </div>

          <div className="w-full pt-4">
            <Button 
              onClick={nextStep} 
              className="w-full h-16 rounded-2xl text-base font-black uppercase tracking-widest shadow-xl group relative overflow-hidden"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {currentStep === steps.length - 1 ? (
                  <>
                    Initialize Terminal
                    <CheckCircle2 className="w-5 h-5" />
                  </>
                ) : (
                  <>
                    Next Phase
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-primary to-primary/80 group-hover:scale-105 transition-transform duration-500" />
            </Button>
            
            {currentStep === 0 && (
              <Button 
                variant="link" 
                onClick={skip} 
                className="mt-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 hover:text-primary transition-colors"
              >
                Skip Orientation
              </Button>
            )}
          </div>
        </div>

        <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-full text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground/30">
            Sector 7-G • Portfolio Briefing
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
