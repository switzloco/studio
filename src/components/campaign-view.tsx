'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc } from 'firebase/firestore';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { healthService, HealthData, CampaignBriefDoc } from '@/lib/health-service';
import { getDailyCampaignBrief } from '@/app/actions/campaign';
import { defaultCharacterSheet, CharacterSheet } from '@/lib/campaign/types';
import { LEVELS, getLevelDef } from '@/lib/campaign/roadmap';
import { getItemDef } from '@/lib/campaign/items';
import { REALM_LORE } from '@/lib/campaign/lore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Crown,
  Scroll,
  Shield,
  Sparkles,
  Swords,
  Flame,
  Loader2,
  Gem,
  BookOpen,
  Trophy,
  Volume2,
  Pause,
} from 'lucide-react';
import { getCampaignBriefAudio } from '@/app/actions/campaign-tts';

const RELIC_GATES = Array.from(
  new Map(LEVELS.filter((l) => l.relic_gate).map((l) => [l.relic_gate!.relic_id, l.relic_gate!])).values(),
);

function CampaignSkeleton() {
  return (
    <div className="p-6 sm:p-10 space-y-6 animate-pulse bg-gradient-to-b from-[#160f28] to-[#0a0714] min-h-full">
      <div className="h-8 w-56 bg-white/10 rounded-lg" />
      <div className="h-56 bg-white/5 rounded-2xl" />
      <div className="h-40 bg-white/5 rounded-2xl" />
    </div>
  );
}

const CHRONICLE_ICON: Record<string, React.ReactNode> = {
  level_up: <Swords className="w-3.5 h-3.5" />,
  relic: <Gem className="w-3.5 h-3.5" />,
  item_grant: <Sparkles className="w-3.5 h-3.5" />,
  item_effect: <Flame className="w-3.5 h-3.5" />,
  legend_ascend: <Crown className="w-3.5 h-3.5" />,
  reign_event: <Shield className="w-3.5 h-3.5" />,
  achievement: <Trophy className="w-3.5 h-3.5" />,
  catchup: <BookOpen className="w-3.5 h-3.5" />,
};

export function CampaignView() {
  const { user } = useUser();
  const db = useFirestore();

  const campaignDocRef = useMemoFirebase(() => (user ? doc(db, 'users', user.uid, 'campaign', 'state') : null), [db, user]);
  const { data: sheetData, isLoading: isSheetLoading } = useDoc<CharacterSheet>(campaignDocRef);

  const userDocRef = useMemoFirebase(() => (user ? doc(db, 'users', user.uid) : null), [db, user]);
  const { data: healthData } = useDoc<HealthData>(userDocRef);

  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [recentBriefs, setRecentBriefs] = useState<CampaignBriefDoc[]>([]);

  const localDate = useMemo(() => new Date().toLocaleDateString('en-CA'), []);
  const sheet: CharacterSheet | null = sheetData ?? (isSheetLoading ? null : defaultCharacterSheet(localDate));

  useEffect(() => {
    if (!user || !sheet) return;
    let cancelled = false;
    setBriefLoading(true);
    setBriefError(null);
    getDailyCampaignBrief(user.uid, user.displayName ?? undefined, localDate)
      .then((res) => {
        if (cancelled) return;
        if (res.success) setBrief(res.brief);
        else setBriefError(res.error);
      })
      .finally(() => {
        if (!cancelled) setBriefLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, localDate, sheet?.last_brief_iso]);

  useEffect(() => {
    if (!user) return;
    healthService.getRecentCampaignBriefs(db, user.uid, 10).then(setRecentBriefs).catch(() => {});
  }, [user, db]);

  // Narration: synthesized on click, cached per isoDate for the session so
  // replaying (or reopening the card) doesn't re-bill Cloud Text-to-Speech.
  const audioCacheRef = useRef<Record<string, string>>({});
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const handleToggleListen = async () => {
    if (!user) return;
    const audioEl = audioElRef.current;
    if (audioEl && isPlaying) {
      audioEl.pause();
      setIsPlaying(false);
      return;
    }
    if (audioEl && audioCacheRef.current[localDate]) {
      audioEl.play();
      setIsPlaying(true);
      return;
    }

    setAudioError(null);
    setIsSynthesizing(true);
    try {
      const res = await getCampaignBriefAudio(user.uid, localDate);
      if (!res.success) {
        setAudioError(res.error);
        return;
      }
      audioCacheRef.current[localDate] = res.audioBase64;
      const audio = new Audio(`data:audio/mp3;base64,${res.audioBase64}`);
      audio.onended = () => setIsPlaying(false);
      audioElRef.current = audio;
      await audio.play();
      setIsPlaying(true);
    } finally {
      setIsSynthesizing(false);
    }
  };

  if (!sheet) return <CampaignSkeleton />;

  const level = sheet.status === 'Leveling' ? getLevelDef(sheet.current_level) : null;
  const progressPct = level ? Math.min(100, Math.round((sheet.current_level_points / level.points_to_advance) * 100)) : 100;
  const daysPct = level ? Math.min(100, Math.round((sheet.days_in_current_level / level.min_days) * 100)) : 100;

  const weightLbs = healthData?.weightKg != null ? healthData.weightKg * 2.20462 : undefined;
  const bodyFatPct = healthData?.bodyFatPct;

  return (
    <div className="min-h-full bg-gradient-to-b from-[#180f2e] via-[#130b24] to-[#0a0714] text-amber-50">
      <div className="p-6 sm:p-10 space-y-8 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between px-1">
          <div className="space-y-1">
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-amber-400/70">The Campaign</p>
            <h2 className="text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
              {sheet.status === 'Legend' ? 'The Long Reign' : sheet.active_story_arc.title}
            </h2>
          </div>
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl">
            {sheet.status === 'Legend' ? <Crown className="w-6 h-6 text-amber-400" /> : <Scroll className="w-6 h-6 text-amber-400" />}
          </div>
        </div>

        {/* Realm Lore primer — static prologue, collapsed by default */}
        <Card className="border border-amber-500/20 bg-black/30 backdrop-blur-sm">
          <Accordion type="single" collapsible>
            <AccordionItem value="lore" className="border-none">
              <AccordionTrigger className="px-6 py-4 text-[11px] font-black uppercase text-amber-400/70 tracking-widest hover:no-underline">
                <span className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  {REALM_LORE.title}
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6 space-y-4">
                {REALM_LORE.sections.map((section) => (
                  <div key={section.heading}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-400/50 mb-1">{section.heading}</p>
                    <p className="text-[13px] leading-relaxed text-amber-50/80" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                      {section.body}
                    </p>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>

        {/* Hero card: level / reign status */}
        <Card className="border border-amber-500/30 bg-black/40 backdrop-blur-sm shadow-[0_0_40px_-12px_rgba(217,160,60,0.35)] overflow-hidden">
          <CardContent className="p-6 space-y-5">
            {sheet.status === 'Leveling' && level ? (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-400/60">{level.tier}</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-5xl font-black italic text-amber-200">L{level.level}</span>
                      <span className="text-sm font-bold text-amber-100/50 uppercase tracking-widest">/ 20</span>
                    </div>
                  </div>
                  <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30 uppercase tracking-widest text-[10px] font-black">
                    {sheet.active_story_arc.tension}
                  </Badge>
                </div>
                <p className="text-sm text-amber-100/80 italic leading-relaxed">{level.stakes}</p>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-amber-400/50">
                    <span>Campaign Points</span>
                    <span>{Math.round(sheet.current_level_points).toLocaleString()} / {level.points_to_advance.toLocaleString()}</span>
                  </div>
                  <Progress value={progressPct} className="h-2 bg-amber-950/60 [&>div]:bg-gradient-to-r [&>div]:from-amber-500 [&>div]:to-amber-300" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-amber-400/50">
                    <span>Time in Chapter</span>
                    <span>Day {sheet.days_in_current_level} / {level.min_days}</span>
                  </div>
                  <Progress value={daysPct} className="h-1.5 bg-amber-950/60 [&>div]:bg-gradient-to-r [&>div]:from-indigo-500 [&>div]:to-indigo-300" />
                </div>

                {level.relic_gate && !sheet.relics_earned.includes(level.relic_gate.relic_id) && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-400/20">
                    <Gem className="w-4 h-4 text-indigo-300 shrink-0" />
                    <p className="text-[11px] text-indigo-200/90">
                      <span className="font-black">{level.relic_gate.title}</span> awaits — needs {level.relic_gate.metric === 'weightLbs' ? 'weight' : 'body fat'} ≤ {level.relic_gate.threshold}{level.relic_gate.metric === 'weightLbs' ? ' lbs' : '%'} to clear this chapter.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-400/60">Legend Status</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-4xl font-black italic text-amber-200">Reign Day {sheet.legend?.reign_day ?? 0}</span>
                    </div>
                  </div>
                  <Crown className="w-8 h-8 text-amber-400" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-amber-400/50">
                    <span>Realm Stability</span>
                    <span>{sheet.legend?.realm_stability ?? 100} / 100</span>
                  </div>
                  <Progress
                    value={sheet.legend?.realm_stability ?? 100}
                    className="h-2 bg-amber-950/60 [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-amber-300"
                  />
                </div>
                <p className="text-[10px] font-bold text-amber-100/50 uppercase tracking-widest">
                  Lifetime {Math.round(sheet.lifetime_points).toLocaleString()} pts
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Daily Brief */}
        <Card className="border border-amber-500/20 bg-black/30 backdrop-blur-sm">
          <CardHeader className="p-6 pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-[11px] font-black uppercase text-amber-400/70 flex items-center gap-2 tracking-widest">
              <Scroll className="w-4 h-4" />
              Today&apos;s Chronicle Entry
            </CardTitle>
            {!briefLoading && !briefError && brief && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleListen}
                disabled={isSynthesizing}
                className="h-7 px-2.5 text-amber-300 hover:text-amber-100 hover:bg-amber-500/10 gap-1.5"
              >
                {isSynthesizing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
                <span className="text-[9px] font-black uppercase tracking-widest">
                  {isSynthesizing ? 'Narrating...' : isPlaying ? 'Pause' : 'Listen'}
                </span>
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {briefLoading ? (
              <div className="flex items-center gap-2 text-amber-200/60 text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                The Chronicler is writing today&apos;s page...
              </div>
            ) : briefError ? (
              <p className="text-sm text-red-300/80">{briefError}</p>
            ) : (
              <>
                <p className="text-[15px] leading-relaxed text-amber-50/90 whitespace-pre-wrap" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                  {brief}
                </p>
                {audioError && <p className="text-[11px] text-red-300/70 mt-3">{audioError}</p>}
              </>
            )}
          </CardContent>
        </Card>

        {/* Relic tracker */}
        <Card className="border border-amber-500/20 bg-black/30 backdrop-blur-sm">
          <CardHeader className="p-6 pb-3">
            <CardTitle className="text-[11px] font-black uppercase text-amber-400/70 flex items-center gap-2 tracking-widest">
              <Gem className="w-4 h-4" />
              Legendary Relics
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {RELIC_GATES.map((gate) => {
              const earned = sheet.relics_earned.includes(gate.relic_id);
              const current = gate.metric === 'weightLbs' ? weightLbs : bodyFatPct;
              return (
                <div
                  key={gate.relic_id}
                  className={`p-3 rounded-xl border ${earned ? 'border-amber-400/50 bg-amber-500/10' : 'border-white/10 bg-white/[0.02]'}`}
                >
                  <div className="flex items-center gap-2">
                    <Gem className={`w-4 h-4 ${earned ? 'text-amber-300' : 'text-white/30'}`} />
                    <p className={`text-xs font-black uppercase tracking-wide ${earned ? 'text-amber-200' : 'text-white/50'}`}>{gate.title}</p>
                  </div>
                  <p className="text-[10px] text-amber-100/40 mt-1">
                    {earned
                      ? 'Claimed.'
                      : `Needs ${gate.metric === 'weightLbs' ? 'weight' : 'body fat'} ≤ ${gate.threshold}${gate.metric === 'weightLbs' ? ' lbs' : '%'}${current != null ? ` (currently ${Math.round(current)}${gate.metric === 'weightLbs' ? '' : '%'})` : ''}.`}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Inventory */}
        <Card className="border border-amber-500/20 bg-black/30 backdrop-blur-sm">
          <CardHeader className="p-6 pb-3">
            <CardTitle className="text-[11px] font-black uppercase text-amber-400/70 flex items-center gap-2 tracking-widest">
              <Sparkles className="w-4 h-4" />
              Inventory
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {sheet.inventory.length === 0 ? (
              <p className="text-xs text-amber-100/40 italic">No items yet — the first will come with the next chapter cleared.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {sheet.inventory.map((inv) => {
                  const def = getItemDef(inv.item_id);
                  if (!def) return null;
                  return (
                    <div key={inv.item_id} className="p-3 rounded-xl border border-white/10 bg-white/[0.03]" title={def.flavor}>
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-black text-amber-200 uppercase tracking-wide">{def.name}</p>
                        {inv.quantity > 1 && <Badge className="bg-white/10 text-amber-100 text-[9px]">×{inv.quantity}</Badge>}
                      </div>
                      <p className="text-[9px] text-amber-100/40 uppercase tracking-widest mt-1">
                        Tier {def.tier} · {def.kind}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chronicle timeline */}
        <Card className="border border-amber-500/20 bg-black/30 backdrop-blur-sm">
          <CardHeader className="p-6 pb-3">
            <CardTitle className="text-[11px] font-black uppercase text-amber-400/70 flex items-center gap-2 tracking-widest">
              <BookOpen className="w-4 h-4" />
              The Chronicle
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0 space-y-3">
            {[...sheet.chronicle].reverse().slice(0, 20).map((entry, i) => (
              <div key={`${entry.iso}-${i}`}>
                {i > 0 && <Separator className="bg-white/5 mb-3" />}
                <div className="flex items-start gap-3">
                  <div className="p-1.5 rounded-full bg-amber-500/10 text-amber-400 mt-0.5 shrink-0">{CHRONICLE_ICON[entry.kind]}</div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-400/40">{entry.iso} · Level {entry.level}</p>
                    <p className="text-xs text-amber-50/80 mt-0.5">{entry.summary}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Scrollback of past briefs */}
        {recentBriefs.length > 0 && (
          <Card className="border border-amber-500/20 bg-black/30 backdrop-blur-sm">
            <CardHeader className="p-6 pb-3">
              <CardTitle className="text-[11px] font-black uppercase text-amber-400/70 flex items-center gap-2 tracking-widest">
                <Scroll className="w-4 h-4" />
                The Story So Far
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-4 max-h-96 overflow-y-auto">
              {recentBriefs
                .filter((b) => b.isoDate !== localDate)
                .map((b) => (
                  <div key={b.isoDate}>
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-400/40 mb-1">{b.isoDate}</p>
                    <p className="text-xs text-amber-50/70 leading-relaxed" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{b.text}</p>
                    <Separator className="bg-white/5 mt-4" />
                  </div>
                ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
