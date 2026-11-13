/**
 * Enrolls one or more email addresses into Free 3x/Day CFO Email Briefings.
 *
 * Usage:
 *   npx tsx scripts/enroll-outreach.ts nicholas.switzer@gmail.com srswitzer@gmail.com
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { getAdminAuth, getAdminFirestore } from '../src/firebase/admin';
import { adminHealthService } from '../src/lib/health-service-admin';
import {
  buildLiveUserOutreach,
  dispatchOutreachForUser,
  saveUserOutreachSettings,
} from '../src/lib/outreach-service';
import { resolveLocalClock } from '../src/lib/outreach-auth';
import type { OutreachWindow } from '../src/lib/health-service';

function windowForHour(hour: number): OutreachWindow {
  if (hour < 11) return 'morning';
  if (hour < 17) return 'midday';
  return 'night';
}

async function enrollEmail(rawEmail: string, timezone = 'America/Los_Angeles') {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Invalid email: ${rawEmail}`);
  }

  const db = getAdminFirestore();
  const auth = getAdminAuth();

  let uid: string | null = null;
  let source = '';

  // 1. Check Firebase Auth first so real accounts are always linked directly
  const authUser = await auth.getUserByEmail(email).catch(() => null);
  if (authUser?.uid) {
    uid = authUser.uid;
    source = 'existing_firebase_auth';
  } else {
    // 2. Check existing outreachEmail index
    const snap = await db.collection('users').where('outreachEmail', '==', email).limit(1).get();
    if (!snap.empty) {
      uid = snap.docs[0].id;
      source = 'existing_outreach_doc';
    } else {
      // 3. Pre-create verified Firebase Auth account so future Google Sign-In auto-merges into the same UID
      const created = await auth.createUser({
        email,
        emailVerified: true,
      });
      uid = created.uid;
      source = 'created_firebase_auth';
    }
  }

  // Ensure root health summary doc exists without overwriting existing users
  const existingHealth = await adminHealthService.getHealthSummary(db, uid);
  const saved = await saveUserOutreachSettings({
    uid,
    outreach: {
      enabled: true,
      channel: 'email',
      cadence: '3x',
      email,
      timezone,
      morningHour: 7,
      middayHour: 12,
      nightHour: 19,
    },
  });

  const clock = resolveLocalClock(new Date(), saved.timezone);
  const currentWin = windowForHour(clock.hour);
  const { composed } = await buildLiveUserOutreach({ uid, window: currentWin });

  let liveEmailSent = false;
  let sendNote =
    'GMAIL_APP_PASSWORD / RESEND_API_KEY not in local shell env (will send once configured)';
  if (process.env.GMAIL_APP_PASSWORD || process.env.RESEND_API_KEY) {
    const dispatched = await dispatchOutreachForUser({
      uid,
      window: currentWin,
      force: true,
      isWelcome: true,
    });
    liveEmailSent = dispatched.status === 'sent';
    sendNote = dispatched.status === 'sent' ? 'Sent live welcome briefing email!' : (dispatched.reason || 'Failed');
  }

  return {
    email,
    uid,
    source,
    connectedDevice: existingHealth?.connectedDevice ?? 'none',
    weightKg: existingHealth?.weightKg ?? null,
    timezone: saved.timezone,
    cadence: saved.cadence,
    schedule: `${saved.morningHour}:00, ${saved.middayHour}:00, ${saved.nightHour}:00`,
    previewHeadline: composed.headline,
    previewMetrics: composed.metricsLine,
    liveEmailSent,
    sendNote,
  };
}

async function main() {
  const emails = process.argv.slice(2);
  if (emails.length === 0) {
    console.error('Usage: npx tsx scripts/enroll-outreach.ts <email1> [email2 ...]');
    process.exit(1);
  }

  for (const email of emails) {
    const res = await enrollEmail(email);
    console.log('\n------------------------------------------------------------');
    console.log(`Enrolled:   ${res.email}`);
    console.log(`UID:        ${res.uid} (${res.source})`);
    console.log(`Wearable:   ${res.connectedDevice} | Weight: ${res.weightKg ? `${Math.round(res.weightKg * 2.20462)} lbs` : 'default'}`);
    console.log(`Schedule:   ${res.cadence} (${res.schedule} ${res.timezone})`);
    console.log(`Live Clock: ${res.previewHeadline}`);
    console.log(`Metrics:    ${res.previewMetrics}`);
    console.log(`Delivery:   ${res.sendNote}`);
  }
  console.log('------------------------------------------------------------\n');
}

main().catch((err) => {
  console.error('Enrollment failed:', err);
  process.exit(1);
});
