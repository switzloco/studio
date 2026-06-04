/**
 * @fileOverview Scoring-engine release registry.
 *
 * Every notable release of the VF scoring engine gets a CODENAME: a mashup of a
 * BODY-COMPOSITION hero and a TECH / SCIENCE hero. The twist — exactly ONE of the
 * two is always fictional, the other is real.
 *
 * Sources to draw from when adding a release:
 *   • Body comp: pro sports (UFC, NFL, NBA, bodybuilding) + sports TV/film
 *     (Rocky/Creed, Friday Night Lights, Ted Lasso, Ballers, Warrior…).
 *   • Tech:      real Silicon Valley, real science history, and HBO's "Silicon Valley".
 *
 * The one-real / one-fictional invariant is enforced by a test (see
 * __tests__/scoring.test.ts). Keep this file as the single source of truth — the
 * coach prompt reads the current release from here via releaseBriefing().
 */

export interface ReleaseHero {
  name: string;
  real: boolean;
  source: string;
  /** Why this hero fits the release — body-comp discipline or tech ethos. */
  note: string;
}

export interface ScoringRelease {
  version: string;        // "2.0"
  codename: string;       // "GSP–Gilfoyle"
  bodyComp: ReleaseHero;
  tech: ReleaseHero;
  tagline: string;
  shipped: string[];      // headline changes this release introduced
}

export const SCORING_RELEASES: ScoringRelease[] = [
  {
    version: '1.0',
    codename: 'Drago–Moore',
    bodyComp: { name: 'Ivan Drago', real: false, source: 'Rocky IV', note: 'brute-force Soviet engineering of the body — "if it dies, it dies"' },
    tech:     { name: 'Gordon Moore', real: true, source: "Intel / Moore's Law", note: 'more transistors every cycle — scale by raw doubling' },
    tagline: 'Brute-force deficit scaling — more deficit, more points, no questions asked.',
    shipped: [
      'Linear deficit/10 base score',
      '+100 flat override for any 24h fast',
      'No muscle accounting — a deficit was a deficit, fat or muscle',
    ],
  },
  {
    version: '2.0',
    codename: 'GSP–Gilfoyle',
    bodyComp: { name: 'Georges St-Pierre', real: true, source: 'UFC', note: 'body-composition and longevity icon — precision, not mass for its own sake' },
    tech:     { name: 'Bertram Gilfoyle', real: false, source: "HBO's Silicon Valley", note: 'ruthless systems efficiency — the right architecture beats more horsepower' },
    tagline: 'Precision over brute force — normalize to the body, protect the lean mass.',
    shipped: [
      'Per-user Alpert normalization (100 pts = 70% of your fat-oxidation ceiling)',
      'Muscle catabolism priced into every score',
      'Limits removed — uncapped in both directions',
      'Zone 2 fat-faucet boost (1.5×, steady-state ≈ FatMax)',
      'Behavioral penalties: alcohol 3h pause, consecutive-day −25, seed oils',
      'Cardio no longer point-penalized — muscle loss shows up honestly instead',
    ],
  },
];

export const CURRENT_SCORING_RELEASE = SCORING_RELEASES[SCORING_RELEASES.length - 1];

/** True when a release honors the twist: exactly one hero is fictional. */
export function hasOneFictionalHero(r: ScoringRelease): boolean {
  return r.bodyComp.real !== r.tech.real;
}

function heroTag(h: ReleaseHero): string {
  return `${h.name} (${h.real ? 'real' : 'fictional'}, ${h.source})`;
}

/** Coach-ready briefing string, generated from the registry (kept DRY for the prompt). */
export function releaseBriefing(): string {
  const cur = CURRENT_SCORING_RELEASE;
  const prior = SCORING_RELEASES[SCORING_RELEASES.length - 2];
  const lines = [
    `CURRENT RELEASE: "${cur.codename}" (v${cur.version}) — ${heroTag(cur.bodyComp)} × ${heroTag(cur.tech)}. "${cur.tagline}" ${cur.shipped.join('; ')}.`,
  ];
  if (prior) {
    lines.push(`PRIOR RELEASE: "${prior.codename}" (v${prior.version}) — ${heroTag(prior.bodyComp)} × ${heroTag(prior.tech)}. "${prior.tagline}"`);
  }
  return lines.join('\n');
}
