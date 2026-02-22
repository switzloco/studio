'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar, Construction, Target, Save, Plus, X, Briefcase } from "lucide-react";
import { useUser, useFirestore } from '@/firebase';
import { healthService, UserPreferences } from '@/lib/health-service';
import { useToast } from '@/hooks/use-toast';

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function PreferencesView() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [schedule, setSchedule] = useState<Record<string, string>>({});
  const [newAsset, setNewAsset] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user) {
      healthService.getUserPreferences(db, user.uid).then((data) => {
        setPrefs(data);
        if (data?.weeklySchedule) {
          try {
            setSchedule(JSON.parse(data.weeklySchedule));
          } catch (e) {
            console.error("Schedule Parse Error", e);
          }
        }
      });
    }
  }, [user, db]);

  const handleSave = async () => {
    if (!user || !prefs) return;
    setIsSaving(true);
    try {
      const updatedPrefs = {
        ...prefs,
        weeklySchedule: JSON.stringify(schedule, null, 2)
      };
      await healthService.updateUserPreferences(db, user.uid, updatedPrefs);
      toast({ title: "Audit Context Updated", description: "The CFO is now aware of your new asset allocation." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update Failed", description: e.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleScheduleChange = (day: string, value: string) => {
    setSchedule(prev => ({ ...prev, [day]: value }));
  };

  const addAsset = () => {
    if (!newAsset.trim() || !prefs) return;
    setPrefs({ ...prefs, equipment: [...prefs.equipment, newAsset.trim()] });
    setNewAsset('');
  };

  const removeAsset = (index: number) => {
    if (!prefs) return;
    const newEq = [...prefs.equipment];
    newEq.splice(index, 1);
    setPrefs({ ...prefs, equipment: newEq });
  };

  if (!prefs) return (
    <div className="p-6 sm:p-10 space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded-lg mb-4" />
      <div className="h-64 bg-muted rounded-2xl" />
      <div className="h-48 bg-muted rounded-2xl" />
    </div>
  );

  return (
    <div className="p-6 sm:p-10 space-y-10 pb-24 overflow-y-auto h-full bg-background">
      <div className="flex items-center justify-between px-1">
        <div className="space-y-1">
          <h2 className="text-3xl font-black tracking-tighter uppercase italic text-foreground">Portfolio Management</h2>
          <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-[0.3em]">Fixed Assets & Audit Scheduling</p>
        </div>
        <div className="p-4 bg-primary/10 rounded-2xl">
          <Briefcase className="w-6 h-6 text-primary" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Left Column: Schedule */}
        <div className="lg:col-span-7 space-y-8">
          <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-[12px] font-black uppercase text-muted-foreground flex items-center gap-3 tracking-widest">
                <Calendar className="w-4 h-4" />
                Weekly Audit Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {DAYS.map((day) => (
                  <div key={day} className="space-y-2 group">
                    <Label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1 flex items-center justify-between">
                      {day}
                      <span className="w-1 h-1 bg-primary/20 rounded-full group-focus-within:bg-primary transition-colors" />
                    </Label>
                    <Input 
                      placeholder="Activity (e.g. Lift)" 
                      value={schedule[day] || ''}
                      onChange={(e) => handleScheduleChange(day, e.target.value)}
                      className="bg-white/50 border-muted-foreground/10 focus:bg-white h-10 text-sm font-bold italic"
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Assets & Targets */}
        <div className="lg:col-span-5 space-y-8">
          <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-[12px] font-black uppercase text-muted-foreground flex items-center gap-3 tracking-widest">
                <Construction className="w-4 h-4" />
                Home Equipment Assets
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-4 space-y-6">
              <div className="flex flex-wrap gap-2 min-h-[40px]">
                {prefs.equipment.length > 0 ? (
                  prefs.equipment.map((asset, i) => (
                    <Badge key={i} variant="secondary" className="gap-2 pr-1.5 py-1.5 pl-3 rounded-lg bg-primary/5 hover:bg-primary/10 text-primary border-none shadow-sm transition-all group">
                      <span className="text-xs font-black uppercase tracking-tighter">{asset}</span>
                      <X className="w-3.5 h-3.5 cursor-pointer hover:text-destructive text-muted-foreground transition-colors" onClick={() => removeAsset(i)} />
                    </Badge>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground italic">No assets registered in the warehouse.</p>
                )}
              </div>
              <div className="flex gap-2">
                <Input 
                  placeholder="Add asset (e.g. 55lb KB)" 
                  value={newAsset} 
                  onChange={(e) => setNewAsset(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addAsset()}
                  className="h-10 text-sm bg-white/50 border-muted-foreground/10"
                />
                <Button size="icon" className="h-10 w-10 shrink-0 rounded-xl" onClick={addAsset}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-[12px] font-black uppercase text-muted-foreground flex items-center gap-3 tracking-widest">
                <Target className="w-4 h-4" />
                Portfolio Targets
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-4 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest px-1">Protein Goal (g)</Label>
                  <Input 
                    type="number" 
                    value={prefs.targets.proteinGoal}
                    onChange={(e) => setPrefs({ ...prefs, targets: { ...prefs.targets, proteinGoal: Number(e.target.value) } })}
                    className="h-10 text-sm font-black bg-white/50 border-muted-foreground/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest px-1">VF Points Goal</Label>
                  <Input 
                    type="number" 
                    value={prefs.targets.fatPointsGoal}
                    onChange={(e) => setPrefs({ ...prefs, targets: { ...prefs.targets, fatPointsGoal: Number(e.target.value) } })}
                    className="h-10 text-sm font-black bg-white/50 border-muted-foreground/10"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Button className="w-full gap-3 rounded-2xl h-14 shadow-xl text-sm font-black uppercase tracking-[0.2em] italic" onClick={handleSave} disabled={isSaving}>
            <Save className="w-5 h-5" />
            {isSaving ? "Syncing Assets..." : "Sync Portfolio Context"}
          </Button>
        </div>
      </div>
    </div>
  );
}
