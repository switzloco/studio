'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar, Construction, Target, Save, Plus, X, Briefcase, Fingerprint, Check, Loader2, Trophy, RotateCcw, Activity, MessageSquare } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { healthService, UserPreferences, HealthData } from '@/lib/health-service';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';

// Rank tiers — financial seniority ladder matching the app's portfolio metaphor
const RANKS = [
  { label: 'Analyst I',         min: 0,     max: 999,      color: 'text-slate-500',   bg: 'bg-slate-100'   },
  { label: 'Analyst II',        min: 1000,  max: 1999,     color: 'text-blue-500',    bg: 'bg-blue-100'    },
  { label: 'Associate',         min: 2000,  max: 2999,     color: 'text-indigo-500',  bg: 'bg-indigo-100'  },
  { label: 'Vice President',    min: 3000,  max: 4999,     color: 'text-violet-600',  bg: 'bg-violet-100'  },
  { label: 'Director',          min: 5000,  max: 7499,     color: 'text-amber-600',   bg: 'bg-amber-100'   },
  { label: 'Managing Director', min: 7500,  max: 9999,     color: 'text-orange-600',  bg: 'bg-orange-100'  },
  { label: 'Partner',           min: 10000, max: Infinity,  color: 'text-emerald-600', bg: 'bg-emerald-100' },
] as const;

const STARTING_EQUITY = 0;

function getRank(points: number) {
  return RANKS.find(r => points >= r.min && points <= r.max) ?? RANKS[0];
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function PreferencesView() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [schedule, setSchedule] = useState<Record<string, string>>({});
  const [newAsset, setNewAsset] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedRecently, setSavedRecently] = useState(false);
  const isLoadedRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live points subscription
  const userDocRef = useMemoFirebase(() => user ? doc(db, 'users', user.uid) : null, [db, user]);
  const { data: healthData } = useDoc<HealthData>(userDocRef);
  const points = healthData?.visceralFatPoints ?? STARTING_EQUITY;

  // Points editor state
  const [pointsInput, setPointsInput] = useState('');
  const [isSavingPoints, setIsSavingPoints] = useState(false);

  // Body composition inputs — seeded from live health data
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [bodyFatPct, setBodyFatPct] = useState('');
  const [isSavingBodyComp, setIsSavingBodyComp] = useState(false);
  const [bodyCompSavedRecently, setBodyCompSavedRecently] = useState(false);

  // Seed body comp fields once health data loads
  const bodyCompSeededRef = useRef(false);
  useEffect(() => {
    if (healthData && !bodyCompSeededRef.current) {
      bodyCompSeededRef.current = true;
      if (healthData.heightCm)   setHeightCm(String(healthData.heightCm));
      if (healthData.weightKg)   setWeightKg(String(healthData.weightKg));
      if (healthData.bodyFatPct != null) setBodyFatPct(String(healthData.bodyFatPct));
    }
  }, [healthData]);

  const handleSaveBodyComp = async () => {
    if (!user) return;
    const updates: Partial<import('@/lib/health-service').HealthData> = {};
    const h = parseFloat(heightCm);
    const w = parseFloat(weightKg);
    const bf = parseFloat(bodyFatPct);
    if (!isNaN(h) && h > 0)   updates.heightCm   = h;
    if (!isNaN(w) && w > 0)   updates.weightKg   = w;
    if (!isNaN(bf) && bf > 0 && bf < 60) updates.bodyFatPct = bf;
    if (Object.keys(updates).length === 0) return;
    setIsSavingBodyComp(true);
    try {
      await healthService.updateHealthData(db, user.uid, updates);
      setBodyCompSavedRecently(true);
      setTimeout(() => setBodyCompSavedRecently(false), 2000);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Save Failed', description: e.message });
    } finally {
      setIsSavingBodyComp(false);
    }
  };

  const handleSetPoints = async (newPoints: number) => {
    if (!user || isNaN(newPoints)) return;
    setIsSavingPoints(true);
    try {
      await healthService.updateHealthData(db, user.uid, { visceralFatPoints: newPoints });
      toast({ title: 'Points Updated', description: `Equity set to ${newPoints.toLocaleString()} pts.` });
      setPointsInput('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    } finally {
      setIsSavingPoints(false);
    }
  };

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
        isLoadedRef.current = true;
      });
    }
  }, [user, db]);

  const handleSave = useCallback(async (currentPrefs: UserPreferences, currentSchedule: Record<string, string>) => {
    if (!user || !currentPrefs) return;
    setIsSaving(true);
    try {
      const updatedPrefs = {
        ...currentPrefs,
        weeklySchedule: JSON.stringify(currentSchedule, null, 2)
      };
      await healthService.updateUserPreferences(db, user.uid, updatedPrefs);
      setSavedRecently(true);
      setTimeout(() => setSavedRecently(false), 2000);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update Failed", description: e.message });
    } finally {
      setIsSaving(false);
    }
  }, [user, db, toast]);

  // Auto-save 800ms after any change, once initial data is loaded
  useEffect(() => {
    if (!isLoadedRef.current || !prefs) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      handleSave(prefs, schedule);
    }, 800);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [prefs, schedule]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* Rank / Leveling Card */}
      {(() => {
        const rank = getRank(points);
        const rankIdx = RANKS.indexOf(rank as typeof RANKS[number]);
        const nextRank = rankIdx < RANKS.length - 1 ? RANKS[rankIdx + 1] : null;

        // Numeric level: every 3000 pts = 1 level. Level 1 = 0-2999, Level 2 = 3000-5999, etc.
        const LEVEL_STEP = 3000;
        const level = Math.floor(Math.max(0, points) / LEVEL_STEP) + 1;
        const levelBase = (level - 1) * LEVEL_STEP;
        const levelProgressPct = Math.min(100, Math.round(((points - levelBase) / LEVEL_STEP) * 100));
        const ptsToNextLevel = LEVEL_STEP - (points - levelBase);
        // First 1000 milestone within Level 1
        const hit1kMilestone = points >= 1000;
        const show1kBadge = level === 1; // only relevant in level 1
        return (
          <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-[12px] font-black uppercase text-muted-foreground flex items-center gap-3 tracking-widest">
                <Trophy className="w-4 h-4" />
                Portfolio Rank
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-4 space-y-5">
              {/* Current rank + level display */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-3 ${rank.bg} rounded-xl relative`}>
                    <Trophy className={`w-5 h-5 ${rank.color}`} />
                    <span className="absolute -top-1.5 -right-1.5 text-[9px] font-black bg-primary text-white rounded-full px-1.5 py-0.5 leading-none">
                      L{level}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className={`text-lg font-black uppercase tracking-tight ${rank.color}`}>{rank.label}</p>
                      <span className="text-[10px] font-black text-muted-foreground/60 bg-muted rounded px-1.5 py-0.5">LVL {level}</span>
                    </div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      {points.toLocaleString()} pts · {ptsToNextLevel.toLocaleString()} to Level {level + 1}
                    </p>
                  </div>
                </div>
              </div>

              {/* Level progress bar with 1K milestone marker */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  <span>Level {level}</span>
                  <span>Level {level + 1} at {((level) * LEVEL_STEP).toLocaleString()} pts</span>
                </div>
                <div className="relative">
                  <Progress value={levelProgressPct} className="h-2" />
                  {/* 1K milestone tick within Level 1 */}
                  {show1kBadge && (
                    <div className="absolute top-0 h-2" style={{ left: `${(1000 / LEVEL_STEP) * 100}%` }}>
                      <div className={`w-0.5 h-full ${hit1kMilestone ? 'bg-violet-500' : 'bg-muted-foreground/30'}`} />
                    </div>
                  )}
                </div>
                {show1kBadge && (
                  <p className={`text-[9px] font-bold ${hit1kMilestone ? 'text-violet-500' : 'text-muted-foreground/60'}`}>
                    {hit1kMilestone ? '✓ 1K Milestone reached' : `1K Milestone at 1,000 pts · ${(1000 - points).toLocaleString()} away`}
                  </p>
                )}
              </div>

              {/* Prestige tier ladder */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 pt-1">
                {RANKS.map((r) => (
                  r.max === Infinity ? null :
                  <div key={r.label} className={`p-2 rounded-lg text-center border ${points >= r.min ? `${r.bg} border-transparent` : 'border-dashed border-muted-foreground/20 opacity-40'}`}>
                    <p className={`text-[9px] font-black uppercase tracking-wider ${points >= r.min ? r.color : 'text-muted-foreground'}`}>{r.label}</p>
                    <p className="text-[8px] text-muted-foreground font-bold">{r.min.toLocaleString()}+</p>
                  </div>
                ))}
                <div key="Partner" className={`p-2 rounded-lg text-center border ${points >= 10000 ? 'bg-emerald-100 border-transparent' : 'border-dashed border-muted-foreground/20 opacity-40'}`}>
                  <p className={`text-[9px] font-black uppercase tracking-wider ${points >= 10000 ? 'text-emerald-600' : 'text-muted-foreground'}`}>Partner</p>
                  <p className="text-[8px] text-muted-foreground font-bold">10,000+</p>
                </div>
              </div>

              {/* Controls */}
              <div className="border-t pt-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Equity Controls</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Set points manually…"
                    value={pointsInput}
                    onChange={e => setPointsInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSetPoints(Number(pointsInput))}
                    className="h-10 text-sm bg-white/50 border-muted-foreground/10 font-bold"
                  />
                  <Button
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl"
                    disabled={isSavingPoints || !pointsInput}
                    onClick={() => handleSetPoints(Number(pointsInput))}
                  >
                    {isSavingPoints ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl border-dashed"
                    disabled={isSavingPoints}
                    title="Reset to starting equity (1,250 pts)"
                    onClick={() => handleSetPoints(STARTING_EQUITY)}
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-[9px] text-muted-foreground italic">Reset returns to {STARTING_EQUITY.toLocaleString()} pts (starting equity). Enter any value to jump to a specific tier.</p>
              </div>
            </CardContent>
          </Card>
        );
      })()}

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

          {/* Body Composition */}
          <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-[12px] font-black uppercase text-muted-foreground flex items-center gap-3 tracking-widest">
                <Activity className="w-4 h-4" />
                Body Composition
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest px-1">Height (cm)</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 178"
                    value={heightCm}
                    onChange={e => setHeightCm(e.target.value)}
                    className="h-10 text-sm font-black bg-white/50 border-muted-foreground/10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest px-1">Weight (kg)</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 82"
                    value={weightKg}
                    onChange={e => setWeightKg(e.target.value)}
                    className="h-10 text-sm font-black bg-white/50 border-muted-foreground/10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest px-1">Body Fat %</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 18"
                    value={bodyFatPct}
                    onChange={e => setBodyFatPct(e.target.value)}
                    className="h-10 text-sm font-black bg-white/50 border-muted-foreground/10"
                  />
                </div>
              </div>
              <p className="text-[9px] text-muted-foreground italic leading-relaxed">
                Body fat % drives glycogen reserve estimates. Use DEXA, BodPod, or a reliable assessment. Can also be set via coach chat.
              </p>
              <Button
                onClick={handleSaveBodyComp}
                disabled={isSavingBodyComp}
                className="w-full h-10 rounded-xl font-black uppercase tracking-widest text-xs"
              >
                {isSavingBodyComp ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : bodyCompSavedRecently ? <Check className="w-4 h-4 mr-2" /> : null}
                {isSavingBodyComp ? 'Saving…' : bodyCompSavedRecently ? 'Saved' : 'Save Body Comp'}
              </Button>
            </CardContent>
          </Card>

          {/* Coach Settings */}
          <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-[12px] font-black uppercase text-muted-foreground flex items-center gap-3 tracking-widest">
                <MessageSquare className="w-4 h-4" />
                Coach Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-black uppercase tracking-tight text-foreground">Auto-Brief</p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-relaxed">
                    Start coaching session automatically when you open the Coach tab
                  </p>
                </div>
                <Switch
                  checked={prefs.autoChatEnabled ?? true}
                  onCheckedChange={(checked) => setPrefs({ ...prefs, autoChatEnabled: checked })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Internal Audit / Database Reference Section */}
          <Card className="border-none shadow-lg bg-white/70 backdrop-blur-sm ring-1 ring-primary/5 border-dashed border-2">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-[12px] font-black uppercase text-muted-foreground flex items-center gap-3 tracking-widest">
                <Fingerprint className="w-4 h-4" />
                Database Ref (Internal Audit)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-black text-muted-foreground tracking-widest px-1">Portfolio UID</Label>
                <div className="p-3 bg-muted/30 rounded-lg font-mono text-[10px] text-muted-foreground break-all border border-dashed select-all cursor-copy">
                  {user?.uid || "UNAUTHORIZED_ACCESS"}
                </div>
                <p className="text-[9px] text-muted-foreground italic px-1 mt-2">Use this ID to locate your document in the Firebase Console under /users/.</p>
              </div>
            </CardContent>
          </Card>

          <Button className="w-full gap-3 rounded-2xl h-14 shadow-xl text-sm font-black uppercase tracking-[0.2em] italic" onClick={() => prefs && handleSave(prefs, schedule)} disabled={isSaving}>
            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : savedRecently ? <Check className="w-5 h-5" /> : <Save className="w-5 h-5" />}
            {isSaving ? "Saving..." : savedRecently ? "Saved" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
