import { describe, it, expect, vi, beforeEach } from 'vitest';

const commit = vi.fn().mockResolvedValue(undefined);
const set = vi.fn();
vi.mock('@/firebase/admin', () => {
  const doc = (path: string) => ({ path, collection: () => ({ doc: (id: string) => ({ path: `${path}/${id}` }) }) });
  return { getAdminFirestore: () => ({ doc, batch: () => ({ set, commit }) }) };
});
vi.mock('@/ai/genkit', () => ({ CFO_MODEL: 'vertexai/gemini-3.5-flash' }));

import { estimateCostUsd, trackAiUsage } from '../ai-usage';

describe('estimateCostUsd', () => {
  it('prices flash with thinking at the output rate', () => {
    // 20k in, 1k out, 1k thinking → 20k*0.50 + 2k*3.00 per 1M = 0.01 + 0.006
    const c = estimateCostUsd('vertexai/gemini-3.5-flash', { inputTokens: 20_000, cachedTokens: 0, outputTokens: 1_000, thoughtsTokens: 1_000 });
    expect(c).toBeCloseTo(0.016, 6);
  });

  it('matches flash-lite before flash and discounts cached tokens', () => {
    const c = estimateCostUsd('vertexai/gemini-3.1-flash-lite', { inputTokens: 10_000, cachedTokens: 4_000, outputTokens: 500, thoughtsTokens: 0 });
    // 6k*0.10 + 4k*0.025 + 500*0.40 per 1M
    expect(c).toBeCloseTo((600 + 100 + 200) / 1_000_000, 9);
  });
});

describe('trackAiUsage middleware', () => {
  beforeEach(() => {
    commit.mockClear();
    set.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('records usage and returns the response untouched', async () => {
    const res = { usage: { inputTokens: 1000, outputTokens: 100 } } as any;
    const mw = trackAiUsage({ uid: 'u1', feature: 'chat' });
    const out = await mw({} as any, undefined, async () => res);
    expect(out).toBe(res);
    expect(set).toHaveBeenCalledTimes(4);
    expect(commit).toHaveBeenCalledOnce();
  });

  it('never throws when Firestore fails', async () => {
    commit.mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = { usage: { inputTokens: 10, outputTokens: 1 } } as any;
    const out = await trackAiUsage({ uid: 'u1', feature: 'chat' })({} as any, undefined, async () => res);
    expect(out).toBe(res);
  });
});
