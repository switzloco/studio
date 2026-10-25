import { describe, it, expect } from 'vitest';
import {
  isFounderIdentity,
  resolveClientEntitlement,
  FREE_AI_AUDITS_LIMIT,
} from '../entitlements';

describe('Founder Immunity & Entitlements', () => {
  it('grants unconditional Founder Immunity to Nick Switzer emails (case-insensitive)', () => {
    expect(isFounderIdentity({ email: 'nicholas.switzer@gmail.com', uid: 'any-uid' })).toBe(true);
    expect(isFounderIdentity({ email: 'NICHOLAS.SWITZER@GMAIL.COM', uid: 'any-uid' })).toBe(true);
    expect(isFounderIdentity({ email: 'nickswitzer1@gmail.com', uid: 'any-uid' })).toBe(true);
    expect(isFounderIdentity({ email: 'nick@cfofitness.app', uid: 'any-uid' })).toBe(true);
  });

  it('does not grant Founder Immunity to random users', () => {
    expect(isFounderIdentity({ email: 'random.user@example.com', uid: 'user-123' })).toBe(false);
    expect(isFounderIdentity({ email: null, uid: 'anon-123' })).toBe(false);
  });

  it('resolves Founder tier with unlimited AI audits and exempt status even if aiAuditsUsed > limit', () => {
    const status = resolveClientEntitlement(
      { email: 'nicholas.switzer@gmail.com', uid: 'nick-uid' },
      { aiAuditsUsed: 999 }
    );
    expect(status.tier).toBe('founder');
    expect(status.isExempt).toBe(true);
    expect(status.canUseAiCoach).toBe(true);
    expect(status.remainingFreeAudits).toBeNull();
  });

  it('resolves VIP tier when a Founding Partner code has been redeemed', () => {
    const status = resolveClientEntitlement(
      { email: 'friend@example.com', uid: 'friend-uid' },
      { redeemedFounderCode: 'BEERBELLYBALLERS', aiAuditsUsed: 42 }
    );
    expect(status.tier).toBe('vip');
    expect(status.isExempt).toBe(true);
    expect(status.canUseAiCoach).toBe(true);
    expect(status.remainingFreeAudits).toBeNull();
  });

  it('resolves Pro tier when Executive Retainer is active', () => {
    const status = resolveClientEntitlement(
      { email: 'subscriber@example.com', uid: 'sub-uid' },
      { entitlementTier: 'pro', aiAuditsUsed: 100 }
    );
    expect(status.tier).toBe('pro');
    expect(status.isExempt).toBe(true);
    expect(status.canUseAiCoach).toBe(true);
  });

  it('tracks remaining free AI audits for Open Terminal (free) users and gates at FREE_AI_AUDITS_LIMIT', () => {
    const freshUser = resolveClientEntitlement(
      { email: 'newbie@example.com', uid: 'u1' },
      { aiAuditsUsed: 3 }
    );
    expect(freshUser.tier).toBe('free');
    expect(freshUser.isExempt).toBe(false);
    expect(freshUser.canUseAiCoach).toBe(true);
    expect(freshUser.remainingFreeAudits).toBe(FREE_AI_AUDITS_LIMIT - 3);

    const cappedUser = resolveClientEntitlement(
      { email: 'capped@example.com', uid: 'u2' },
      { aiAuditsUsed: FREE_AI_AUDITS_LIMIT }
    );
    expect(cappedUser.tier).toBe('free');
    expect(cappedUser.isExempt).toBe(false);
    expect(cappedUser.canUseAiCoach).toBe(false);
    expect(cappedUser.remainingFreeAudits).toBe(0);
  });
});
