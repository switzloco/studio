/**
 * @fileOverview Campaign Mode — the Daily Brief narrator flow.
 *
 * This is a deliberately separate, scoped-down agentic call from the CFO
 * coach: no tools, no Firestore access, no memory of the coaching
 * conversation. It receives only a BriefContext (built by the deterministic
 * Campaign Engine) and narrates the events already decided by the app. It
 * never computes a number, grants an item, or decides a level-up itself.
 */

import { ai, SAFETY_SETTINGS } from '@/ai/genkit';
import { z } from 'genkit';
import type { BriefContext } from '@/lib/campaign/engine';
import type { CharacterSheet } from '@/lib/campaign/types';

const CampaignBriefInputSchema = z.object({
  userName: z.string().optional(),
  briefContext: z.any(), // BriefContext (see src/lib/campaign/engine.ts)
});
export type CampaignBriefInput = z.infer<typeof CampaignBriefInputSchema>;

const SYSTEM_PROMPT = `You are the Chronicler of the Realm — narrator of a long, righteous heroic campaign in the tradition of a structured saga (think Frosthaven): cohesive, earnest, epic. This is a multi-year journey to secure a realm — NOT chaotic, random, or anarchist.

ABSOLUTE BOUNDARY — YOU ARE A NARRATOR, NOT AN ENGINE:
- You NEVER invent, change, or compute points, levels, days, item effects, or outcomes.
- Every mechanical fact is given to you in CHARACTER_SHEET (JSON) and the ACTIVE_LEVEL / THE REALM block below. Treat them as ground truth. If a number isn't there, do not state a number.
- You NEVER decide a level-up, item grant, relic claim, or achievement — the app already decided what happened this turn. You only render the "TODAY'S APP-COMPUTED EVENTS" list into prose. Nothing more, nothing invented.

VOICE — EPIC BACKBONE, FUNNY FLOURISHES:
- The overall saga (arc, stakes, tension) stays a cohesive, earnest, Frosthaven-style epic. Do not undercut the main narrative's stakes with jokes.
- BUT: achievement unlocks, item invocations, and level-up moments get a distinct, benevolent, funny "announcer" voice layered on top — a warm, deadpan game-show-host-meets-dungeon-crawl-system-voice. Never mean, never at the hero's expense. A quick funny aside on these specific beats is expected.
- Stay tightly inside the ACTIVE_LEVEL's arc and stakes. Do not foreshadow far-future levels except as distant, reverent hints ("the realm beyond the mountains waits").
- Use CHARACTER_SHEET.chronicle for true continuity — reference real past events only, never invented ones.
- Escalate tone with active_story_arc.tension: rising = steady resolve; climax = urgency; resolved = earned triumph.
- If a CATCH-UP note is present, open with a short, warm acknowledgment of the days away before continuing — never scold, never guilt-trip. The hero doesn't always report in same-day, and that's fine.
- Address the hero directly, by name if given. Keep the brief to about 120-200 words. End with a single grounded call to the day ahead — never a fabricated reward.

TIER REGISTER:
- Local Hero (L1-5): intimate, hearth-and-village scale.
- Regional Commander (L6-15): campaigns, banners, provinces.
- Realm Sovereign (L16-20) / Legend: crowns, borders, the whole realm.`;

function buildLevelingPrompt(ctx: BriefContext, userName?: string): string {
  const sheet: CharacterSheet = JSON.parse(ctx.characterSheetJson);
  const level = ctx.level!;
  const arc = sheet.active_story_arc;
  const lines: string[] = [
    'CAMPAIGN_STATUS: Leveling',
    '',
    'CHARACTER_SHEET:',
    '```json',
    ctx.characterSheetJson,
    '```',
    '',
    'ACTIVE_LEVEL:',
    `- Level ${level.level} / 20 · Tier: ${level.tier}`,
    `- Arc: "${level.arc_title}" — ${level.stakes}`,
    `- Chapter ${arc.chapter}, tension: ${arc.tension}`,
    `- Progress: ${Math.round(sheet.current_level_points)} / ${level.points_to_advance} points · day ${sheet.days_in_current_level} of ~${level.min_days}`,
  ];
  if (level.relic_gate && !sheet.relics_earned.includes(level.relic_gate.relic_id)) {
    lines.push(`- Relic in reach: "${level.relic_gate.title}" (needs ${level.relic_gate.metric} ≤ ${level.relic_gate.threshold})`);
  }
  lines.push('', "TODAY'S APP-COMPUTED EVENTS (narrate these, invent nothing else):");
  if (ctx.todaysEvents.length === 0) {
    lines.push('- No major events today — steady, ordinary progress.');
  } else {
    for (const e of ctx.todaysEvents) lines.push(`- ${e}`);
  }
  lines.push(`- Yesterday's contribution to the campaign: ${Math.round(ctx.lastDayDelta)} points.`);
  if (ctx.catchupDates.length > 0) {
    lines.push(`- CATCH-UP: the hero is only now reporting back after ${ctx.catchupDates.length} day(s) away (${ctx.catchupDates.join(', ')}).`);
  }
  lines.push('', `Write today's Campaign Brief for ${userName || 'the hero'}. Narration only.`);
  return lines.join('\n');
}

function buildLegendPrompt(ctx: BriefContext, userName?: string): string {
  const legend = ctx.legendSummary!;
  const sheet: CharacterSheet = JSON.parse(ctx.characterSheetJson);
  const lines: string[] = [
    `CAMPAIGN_STATUS: Legend — Reign Day ${legend.reignDay}`,
    '',
    'CHARACTER_SHEET:',
    '```json',
    ctx.characterSheetJson,
    '```',
    '',
    'THE REALM:',
    `- Realm Stability: ${legend.stability}/100 (${legend.stabilityBand})`,
    `- Today's reign event (app-selected, narrate it): ${legend.reignEventText}`,
    `- Lifetime points: ${Math.round(sheet.lifetime_points)} — a legend's ledger.`,
  ];
  for (const e of ctx.todaysEvents) lines.push(`- ${e}`);
  if (ctx.catchupDates.length > 0) {
    lines.push(`- CATCH-UP: the hero is only now reporting back after ${ctx.catchupDates.length} day(s) away (${ctx.catchupDates.join(', ')}).`);
  }
  lines.push(
    '',
    `You have secured the realm; there is no next level. Narrate a single day of ${userName || 'the hero'}'s reign — tending, defending, and honoring what was won. If stability is slipping, let the day carry quiet warning; if thriving, let it carry earned peace. ~120-180 words.`,
  );
  return lines.join('\n');
}

export const campaignBriefFlow = ai.defineFlow(
  {
    name: 'campaignBriefFlow',
    inputSchema: CampaignBriefInputSchema,
    outputSchema: z.string(),
  },
  async (input) => {
    const ctx = input.briefContext as BriefContext;
    const prompt = ctx.status === 'Legend' ? buildLegendPrompt(ctx, input.userName) : buildLevelingPrompt(ctx, input.userName);
    const generateConfig = {
      system: SYSTEM_PROMPT,
      prompt,
      config: { safetySettings: SAFETY_SETTINGS, temperature: 0.9 },
    };
    try {
      const result = await ai.generate(generateConfig);
      return result.text;
    } catch (err) {
      console.warn('[campaignBriefFlow] Primary model failed, trying fallback model (gemini-2.0-flash):', (err as Error)?.message ?? String(err));
      const result = await ai.generate({ model: 'googleai/gemini-2.0-flash', ...generateConfig });
      return result.text;
    }
  },
);

export async function generateCampaignBrief(input: CampaignBriefInput): Promise<string> {
  return campaignBriefFlow(input);
}
