'use server';

import { getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * @fileOverview Firebase Admin SDK initialization for server-side use.
 * Uses Application Default Credentials (ADC) automatically provided by
 * Firebase App Hosting — no explicit service account key needed.
 * Admin SDK bypasses Firestore security rules, so only use in trusted
 * server contexts (Server Actions, Genkit flows).
 */

export function getAdminFirestore() {
  if (!getApps().length) {
    initializeApp();
  }
  return getFirestore(getApp());
}
