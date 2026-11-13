import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  addIsoDays,
  diffIsoDays,
  resolveLocalClock,
  signOutreachToken,
  verifyOutreachToken,
} from '../outreach-auth';
import {
  composeOutreachDispatch,
  evaluateAutoSunset,
} from '../outreach-composer';
import {
  renderOutreachEmailHtml,
  renderOutreachWelcomeEmailHtml,
  resolveGmailOutreachConfig,
} from '../outreach-email';
import {
  extractEmailReplyPartsFromRawMime,
  extractPlainTextFromRawMime,
} from '../outreach-gmail-inbound';
import {
  buildDiscordOutreachPayload,
  verifyDiscordSignature,
} from '../outreach-discord';
import {
  extractCleanReplyText,
  isExplicitStopKeyword,
} from '@/ai/flows/outreach-meal-parser';
import type { HealthData, UserPreferences } from '../health-service';
import type { FoodLogEntry } from '../food-exercise-types';

const basePrefs: UserPreferences = {
  weeklySchedule: '{}',
  equipment: [],
  targets: { proteinGoal: 150, fatPointsGoal: 3000 },
  profile: { weightKg: 80, heightCm: 180, age: 35 },
};

function makeFood(overrides: Partial<FoodLogEntry>): FoodLogEntry {
  return {
    name: 'Test Meal',
    portionG: 300,
    calories: 500,
    proteinG: 45,
    carbsG: 40,
    fatG: 15,
    fiberG: 5,
    source: 'user_estimate',
    meal: 'lunch',
    date: '2026-11-11',
    consumedAt: '12:00',
    timestamp: new Date() as any,
    ...overrides,
  };
}

describe('outreach-auth: HMAC tokens & timezone helpers', () => {
  it('signs and verifies valid tokens and rejects tampered or expired tokens', () => {
    const nowSec = 1_800_000_000;
    const token = signOutreachToken({
      uid: 'user_123',
      action: 'protein_40',
      date: '2026-11-11',
      window: 'midday',
      exp: nowSec + 3600,
    });

    const verified = verifyOutreachToken(token, nowSec);
    expect(verified).toEqual({
      uid: 'user_123',
      action: 'protein_40',
      date: '2026-11-11',
      window: 'midday',
      exp: nowSec + 3600,
    });

    // Expired
    expect(verifyOutreachToken(token, nowSec + 3601)).toBeNull();

    // Tampered payload
    const [body, sig] = token.split('.');
    const tampered = `${body.slice(0, -2)}ab.${sig}`;
    expect(verifyOutreachToken(tampered, nowSec)).toBeNull();
  });

  it('resolves local timezone clock and falls back safely on invalid timezone', () => {
    // 2026-11-11T15:30:00Z -> 07:30 in America/Los_Angeles (PST, UTC-8)
    const dt = new Date('2026-11-11T15:30:00Z');
    const clock = resolveLocalClock(dt, 'America/Los_Angeles');
    expect(clock.localDate).toBe('2026-11-11');
    expect(clock.hour).toBe(7);
    expect(clock.minute).toBe(30);
    expect(clock.hoursElapsed).toBe(7.5);

    const fallback = resolveLocalClock(dt, 'Invalid/Not_A_Zone');
    expect(fallback.timezone).toBe('America/Los_Angeles');
    expect(fallback.hour).toBe(7);
  });

  it('adds and diffs ISO dates accurately across month boundaries', () => {
    expect(addIsoDays('2026-11-28', 5)).toBe('2026-12-03');
    expect(diffIsoDays('2026-11-01', '2026-11-11')).toBe(10);
  });
});

describe('outreach-composer: Morning, Midday & Night Zero-AI messages', () => {
  it('Morning: reassures "good from yesterday" with an Eat-By clock after a refeed/surplus day', () => {
    const health = {
      weightKg: 82,
      heightCm: 180,
      bodyFatPct: 24,
      history: [
        {
          date: 'Nov 10',
          isoDate: '2026-11-10',
          gain: -15,
          status: 'Correction',
          detail: 'Surplus day',
          equity: 500,
          breakdown: {
            caloriesIn: 2700,
            caloriesOut: 2300,
            scoredCaloriesOut: 2250,
            deficit: -450,
            proteinG: 165,
            proteinGoal: 150,
            fastingHours: 12,
            alcoholDrinks: 0,
            sleepHours: 8,
            seedOilMeals: 0,
          },
        },
      ],
    } as unknown as HealthData;

    const msg = composeOutreachDispatch({
      window: 'morning',
      localDate: '2026-11-11',
      hoursElapsed: 7.5,
      health,
      prefs: basePrefs,
      todayFoods: [],
      yesterdayFoods: [],
    });

    expect(msg.goodFromYesterday).toBe(true);
    expect(msg.subject).toMatch(/^Morning Check-In: Fueled until/i);
    expect(msg.headline).toContain("Last night's fuel holds");
    expect(msg.headline).toMatch(/eat by/i);
  });

  it('Morning: gives a crisp early Eat-By / Eat Now prompt after a deep deficit yesterday', () => {
    const health = {
      weightKg: 75,
      heightCm: 178,
      bodyFatPct: 16,
      history: [
        {
          date: 'Nov 10',
          isoDate: '2026-11-10',
          gain: 110,
          status: 'Bullish',
          detail: 'Deep cut',
          equity: 610,
          breakdown: {
            caloriesIn: 1100,
            caloriesOut: 2500,
            scoredCaloriesOut: 2200,
            deficit: 1100,
            proteinG: 140,
            proteinGoal: 150,
            fastingHours: 18,
            alcoholDrinks: 0,
            sleepHours: 7,
            seedOilMeals: 0,
          },
        },
      ],
    } as unknown as HealthData;

    const msg = composeOutreachDispatch({
      window: 'morning',
      localDate: '2026-11-11',
      hoursElapsed: 7.5,
      health,
      prefs: basePrefs,
      todayFoods: [],
    });

    expect(msg.goodFromYesterday).toBe(false);
    expect(msg.headline).toMatch(/(by|eat ~40g protein now)/i);
  });

  it('Midday: recognizes recent lunch and tells user when to eat next', () => {
    const msg = composeOutreachDispatch({
      window: 'midday',
      localDate: '2026-11-11',
      hoursElapsed: 12.5,
      prefs: basePrefs,
      todayFoods: [
        makeFood({
          name: 'Chicken & Rice Bowl',
          calories: 650,
          proteinG: 55,
          carbsG: 70,
          fatG: 14,
          meal: 'lunch',
          consumedAt: '12:00',
        }),
      ],
    });

    expect(msg.subject).toMatch(/^Midday Check-In: Fueled until/i);
    expect(msg.headline).toContain('Last meal is still working');
    expect(msg.headline).toMatch(/eat next by/i);
  });

  it('Night: confirms "fueled through 8:00 AM tomorrow" when energy & protein targets are met', () => {
    const msg = composeOutreachDispatch({
      window: 'night',
      localDate: '2026-11-11',
      hoursElapsed: 19.5,
      prefs: basePrefs,
      todayFoods: [
        makeFood({ meal: 'breakfast', consumedAt: '09:00', calories: 450, proteinG: 45, carbsG: 30, fatG: 15 }),
        makeFood({ meal: 'lunch', consumedAt: '13:00', calories: 600, proteinG: 55, carbsG: 45, fatG: 18 }),
        makeFood({ meal: 'dinner', consumedAt: '18:30', calories: 650, proteinG: 55, carbsG: 45, fatG: 20 }),
      ],
    });

    expect(msg.safeThroughTomorrowMorning).toBe(true);
    expect(msg.headline).toContain('Fueled through 8:00 AM tomorrow');
  });

  it('evaluates quiet-user auto-sunset thresholds at 5 and 10 days', () => {
    expect(
      evaluateAutoSunset({
        localDate: '2026-11-11',
        lastInteractionDate: '2026-11-09',
        currentCadence: '3x',
      }).decision,
    ).toBe('active');

    expect(
      evaluateAutoSunset({
        localDate: '2026-11-11',
        lastInteractionDate: '2026-11-06',
        currentCadence: '3x',
      }).decision,
    ).toBe('downshift_to_morning');

    expect(
      evaluateAutoSunset({
        localDate: '2026-11-11',
        lastInteractionDate: '2026-11-01',
        currentCadence: 'morning_only',
      }).decision,
    ).toBe('auto_pause');
  });
});

describe('Email, Discord & Inbound Reply utilities', () => {
  it('renders Email HTML with direct Last-On-Record prompt, photo reply support, and 1-Click Cancel', () => {
    const composed = composeOutreachDispatch({
      window: 'midday',
      localDate: '2026-11-11',
      hoursElapsed: 13.5,
      prefs: basePrefs,
      todayFoods: [
        makeFood({
          id: 'meal_1',
          name: 'Chicken & Rice Bowl',
          calories: 650,
          proteinG: 55,
          carbsG: 70,
          fatG: 14,
          consumedAt: '12:00',
        }),
      ],
    });
    expect(composed.lastFoodLine).toBe(
      'Last on record: Chicken & Rice Bowl today at 12:00 PM (650 kcal, 55g protein).',
    );

    const rendered = renderOutreachEmailHtml({
      uid: 'user_abc',
      cadence: '3x',
      composed,
    });

    expect(rendered.unsubscribeUrl).toContain('/api/outreach/action?token=');
    expect(rendered.html).toContain('1-Click Cancel');
    expect(rendered.html).toContain('Switch to Morning-Only');
    expect(rendered.html).toContain('Chicken &amp; Rice Bowl today at 12:00 PM');
    expect(rendered.html).toContain('What else did you have?');
    expect(rendered.html).toContain('attach a meal or label photo');
    expect(rendered.html).not.toContain('Fitbit');

    const welcome = renderOutreachWelcomeEmailHtml({
      uid: 'user_abc',
      cadence: '3x',
      timezone: 'America/Los_Angeles',
      composed,
    });
    expect(welcome.subject).toContain('Welcome to the CFO Briefing');
    expect(welcome.html).toContain('Last on record:');
    expect(welcome.html).toContain('What else did you have?');
    expect(welcome.html).toContain('attach a meal or nutrition-label photo');
    expect(welcome.html).not.toContain('Fitbit');
    expect(welcome.html).toContain('/briefings');
  });

  it('verifies valid Ed25519 Discord signatures and rejects forged payloads', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
    // Last 32 bytes of Ed25519 SPKI DER are the raw 32-byte public key
    const publicKeyHex = spkiDer.subarray(spkiDer.length - 32).toString('hex');

    const timestamp = '1762890000';
    const rawBody = JSON.stringify({ type: 1 });
    const sigHex = crypto
      .sign(null, Buffer.from(timestamp + rawBody, 'utf8'), privateKey)
      .toString('hex');

    expect(
      verifyDiscordSignature({
        publicKeyHex,
        signatureHex: sigHex,
        timestamp,
        rawBody,
      }),
    ).toBe(true);

    expect(
      verifyDiscordSignature({
        publicKeyHex,
        signatureHex: sigHex,
        timestamp,
        rawBody: JSON.stringify({ type: 2 }),
      }),
    ).toBe(false);

    const composed = composeOutreachDispatch({
      window: 'midday',
      localDate: '2026-11-11',
      hoursElapsed: 12.5,
      prefs: basePrefs,
    });
    const payload = buildDiscordOutreachPayload({ cadence: '3x', composed });
    expect(payload.embeds[0].title).toBe(composed.headline);
    expect(payload.components).toHaveLength(2);
  });

  it('strips quoted email threads (including Gmail 2-line wrapped attributions) and detects explicit STOP replies without LLM calls', () => {
    const rawEmail = [
      '3 eggs and sourdough toast',
      '',
      'On Wed, Nov 11, 2026 at 7:31 AM the CFO <reports@updates.thecfo.app> wrote:',
      '> Eat by 11:00 AM',
    ].join('\n');

    expect(extractCleanReplyText(rawEmail)).toBe('3 eggs and sourdough toast');

    const wrappedGmailReply = [
      'I had 1/4 costco hot dog, 3 oz costco pepperoni pizza, 1 nurri shake',
      '',
      'On Thu, Nov 12, 2026 at 7:12\u202fPM the CFO <nicholas.switzer@gmail.com>',
      'wrote:',
      '',
      '> WELCOME TO THE CFO DAILY BRIEFING ($0)',
    ].join('\r\n');

    expect(extractCleanReplyText(wrappedGmailReply)).toBe(
      'I had 1/4 costco hot dog, 3 oz costco pepperoni pizza, 1 nurri shake',
    );
    expect(isExplicitStopKeyword('STOP')).toBe(true);
    expect(isExplicitStopKeyword('unsubscribe!')).toBe(true);
    expect(isExplicitStopKeyword('3 eggs')).toBe(false);
  });

  it('normalizes Google 4x4 App Passwords and extracts plain text from multipart MIME replies', () => {
    const prevPass = process.env.GMAIL_APP_PASSWORD;
    const prevUser = process.env.GMAIL_USER;
    try {
      process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop';
      process.env.GMAIL_USER = 'nicholas.switzer@gmail.com';
      const cfg = resolveGmailOutreachConfig();
      expect(cfg).toEqual({
        user: 'nicholas.switzer@gmail.com',
        appPassword: 'abcdefghijklmnop',
        plusReplyTo: 'nicholas.switzer+cfo@gmail.com',
      });
    } finally {
      if (prevPass === undefined) delete process.env.GMAIL_APP_PASSWORD;
      else process.env.GMAIL_APP_PASSWORD = prevPass;
      if (prevUser === undefined) delete process.env.GMAIL_USER;
      else process.env.GMAIL_USER = prevUser;
    }

    const mime = Buffer.from(
      [
        'From: srswitzer@gmail.com',
        'To: nicholas.switzer+cfo@gmail.com',
        'Content-Type: multipart/alternative; boundary="b123"',
        '',
        '--b123',
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        '40g whey shake and an apple',
        '--b123',
        'Content-Type: text/html; charset="UTF-8"',
        '',
        '<div>40g whey shake and an apple</div>',
        '--b123--',
      ].join('\r\n'),
      'utf8',
    );

    expect(extractPlainTextFromRawMime(mime)).toBe('40g whey shake and an apple');

    const fakeJpegBase64 = Buffer.alloc(1500, 0xab).toString('base64');
    const tinyPixelBase64 = Buffer.alloc(40, 0x01).toString('base64');
    const mixedMime = Buffer.from(
      [
        'From: nicholas.switzer@gmail.com',
        'To: nicholas.switzer+cfo@gmail.com',
        'Content-Type: multipart/mixed; boundary="mix99"',
        '',
        '--mix99',
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        'Had half of this plate',
        '--mix99',
        'Content-Type: image/gif; name="pixel.gif"',
        'Content-Transfer-Encoding: base64',
        '',
        tinyPixelBase64,
        '--mix99',
        'Content-Type: image/jpeg; name="dinner.jpg"',
        'Content-Disposition: attachment; filename="dinner.jpg"',
        'Content-Transfer-Encoding: base64',
        '',
        fakeJpegBase64,
        '--mix99--',
      ].join('\r\n'),
      'utf8',
    );

    const parts = extractEmailReplyPartsFromRawMime(mixedMime);
    expect(parts.text).toBe('Had half of this plate');
    expect(parts.images).toHaveLength(1);
    expect(parts.images[0].contentType).toBe('image/jpeg');
    expect(parts.images[0].dataUri).toBe(`data:image/jpeg;base64,${fakeJpegBase64}`);
  });
});
