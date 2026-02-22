
'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Briefcase, Calendar, Construction, Target, Save, Plus, X } from "lucide-react";
import { useUser, useFirestore } from '@/firebase';
import { healthService, UserPreferences } from '@/lib/health-service';
import { useToast } from '@/hooks/use-toast';

export function PreferencesView() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [newAsset, setNewAsset] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user) {
      healthService.getUserPreferences(db, user.uid).then(setPrefs);
    }
  }, [user, db]);

  const handleSave = async () => {
    if (!user || !prefs) return;
    setIsSaving(true);
    try {
      await healthService.updateUserPreferences(db, user.uid, prefs);
      toast({ title: "Audit Context Updated", description: "The CFO is now aware of your new asset allocation." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update Failed", description: e.message });
    } finally {
      setIsSaving(false);
    }
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

  if (!prefs) return <div className="p-4 animate-pulse space-y-4"><div className="h-48 bg-muted rounded-xl" /></div>;

  return (
    <div className="p-4 space-y-6 pb-24 overflow-y-auto h-full">
      <div className="space-y-1">
        <h2 className="text-xl font-black tracking-tight">Portfolio Management</h2>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Fixed Assets & Audit Scheduling</p>
      </div>

      <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-2">
            <Calendar className="w-3 h-3" />
            Weekly Audit Schedule (JSON)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <Textarea 
            value={prefs.weeklySchedule}
            onChange={(e) => setPrefs({ ...prefs, weeklySchedule: e.target.value })}
            className="font-mono text-xs min-h-[150px] bg-white/50"
          />
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-2">
            <Construction className="w-3 h-3" />
            Home Equipment Assets
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            {prefs.equipment.map((asset, i) => (
              <Badge key={i} variant="secondary" className="gap-1 pr-1 py-1">
                {asset}
                <X className="w-3 h-3 cursor-pointer hover:text-destructive" onClick={() => removeAsset(i)} />
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input 
              placeholder="Add asset (e.g. 55lb KB)" 
              value={newAsset} 
              onChange={(e) => setNewAsset(e.target.value)}
              className="h-8 text-xs bg-white/50"
            />
            <Button size="icon" className="h-8 w-8 shrink-0" onClick={addAsset}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm bg-white/70 backdrop-blur-sm ring-1 ring-primary/5">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-2">
            <Target className="w-3 h-3" />
            Long-Term Portfolio Targets
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">Protein (g)</Label>
              <Input 
                type="number" 
                value={prefs.targets.proteinGoal}
                onChange={(e) => setPrefs({ ...prefs, targets: { ...prefs.targets, proteinGoal: Number(e.target.value) } })}
                className="h-8 text-xs bg-white/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">VF Points</Label>
              <Input 
                type="number" 
                value={prefs.targets.fatPointsGoal}
                onChange={(e) => setPrefs({ ...prefs, targets: { ...prefs.targets, fatPointsGoal: Number(e.target.value) } })}
                className="h-8 text-xs bg-white/50"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Button className="w-full gap-2 rounded-xl h-12 shadow-lg" onClick={handleSave} disabled={isSaving}>
        <Save className="w-4 h-4" />
        {isSaving ? "Syncing Assets..." : "Sync Portfolio Context"}
      </Button>
    </div>
  );
}
