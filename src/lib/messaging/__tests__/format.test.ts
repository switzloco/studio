import { describe, expect, it } from 'vitest';
import {
  estimateTimezoneOffsetMinutes,
  generateLinkCode,
  localNowParts,
  parseChannelCommand,
  splitMessage,
  toWhatsAppFormatting,
} from '../format';

describe('parseChannelCommand', () => {
  it('recognizes LINK with a code, case-insensitively', () => {
    expect(parseChannelCommand('LINK AB2C3D')).toEqual({ kind: 'link', code: 'AB2C3D' });
    expect(parseChannelCommand('  link ab2c3d  ')).toEqual({ kind: 'link', code: 'AB2C3D' });
    expect(parseChannelCommand('Link: XY99ZZ')).toEqual({ kind: 'link', code: 'XY99ZZ' });
  });

  it('recognizes UNLINK', () => {
    expect(parseChannelCommand('unlink')).toEqual({ kind: 'unlink' });
    expect(parseChannelCommand(' UNLINK ')).toEqual({ kind: 'unlink' });
  });

  it('treats everything else as chat', () => {
    expect(parseChannelCommand('logged 3 eggs and toast')).toEqual({ kind: 'chat' });
    expect(parseChannelCommand('link me up with a workout plan')).toEqual({ kind: 'chat' });
    expect(parseChannelCommand('unlink my fitbit please')).toEqual({ kind: 'chat' });
  });
});

describe('splitMessage', () => {
  it('returns short messages untouched', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello']);
    expect(splitMessage('   ', 100)).toEqual([]);
  });

  it('splits on paragraph boundaries and respects the cap', () => {
    const paragraphs = ['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)];
    const chunks = splitMessage(paragraphs.join('\n\n'), 130);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`${paragraphs[0]}\n\n${paragraphs[1]}`);
    expect(chunks[1]).toBe(paragraphs[2]);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(130);
  });

  it('hard-splits a single overlong line without dropping content', () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
    const chunks = splitMessage(words, 40);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(40);
    expect(chunks.join(' ')).toBe(words);
  });
});

describe('toWhatsAppFormatting', () => {
  it('converts double-asterisk bold and markdown headers', () => {
    expect(toWhatsAppFormatting('**The Toxic Debt**: beer')).toBe('*The Toxic Debt*: beer');
    expect(toWhatsAppFormatting('## Morning Audit\nok')).toBe('*Morning Audit*\nok');
  });
});

describe('estimateTimezoneOffsetMinutes', () => {
  const nowMs = Date.UTC(2026, 6, 1, 20, 0, 0); // 2026-07-01T20:00Z

  it('derives a negative offset for US-style local times', () => {
    // 1:00 PM local while it's 20:00 UTC → UTC-7
    expect(estimateTimezoneOffsetMinutes('2026-07-01', '1:00:05 PM', nowMs)).toBe(-420);
  });

  it('derives a positive offset for 24h local times', () => {
    // 22:00 local while it's 20:00 UTC → UTC+2
    expect(estimateTimezoneOffsetMinutes('2026-07-01', '22:00', nowMs)).toBe(120);
  });

  it('handles local dates across the UTC midnight boundary', () => {
    // 05:30 next day local while it's 20:00 UTC → UTC+9.5
    expect(estimateTimezoneOffsetMinutes('2026-07-02', '5:30 AM', nowMs)).toBe(570);
  });

  it('returns undefined for garbage input', () => {
    expect(estimateTimezoneOffsetMinutes('yesterday', 'noon', nowMs)).toBeUndefined();
    expect(estimateTimezoneOffsetMinutes('2026-07-01', '99:99', nowMs)).toBeUndefined();
  });
});

describe('localNowParts', () => {
  it('produces the flow-shaped local date/time/day from an offset', () => {
    const nowMs = Date.UTC(2026, 6, 1, 20, 0, 0); // Wednesday 20:00 UTC
    expect(localNowParts(-420, nowMs)).toEqual({
      localDate: '2026-07-01',
      localTime: '13:00',
      currentDay: 'Wednesday',
    });
    // +9h rolls into Thursday local time
    expect(localNowParts(540, nowMs)).toEqual({
      localDate: '2026-07-02',
      localTime: '05:00',
      currentDay: 'Thursday',
    });
  });
});

describe('generateLinkCode', () => {
  it('emits 6 chars from the unambiguous alphabet', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateLinkCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });
});
