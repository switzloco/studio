import { getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

/**
 * @fileOverview Firebase Admin SDK initialization for server-side use.
 * Uses Application Default Credentials (ADC) automatically provided by
 * Firebase App Hosting — no explicit service account key needed.
 * Admin SDK bypasses Firestore security rules, so only use in trusted
 * server contexts (Server Actions, Genkit flows).
 */

function getAdminApp() {
  if (!getApps().length) {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'studio-4236902803-1eba2';
    initializeApp({ projectId });
  }
  return getApp();
}

export function getAdminFirestore() {
  return getFirestore(getAdminApp());
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export interface VerifiedAuthToken {
  uid: string;
  email?: string;
  isAnonymous?: boolean;
}

/**
 * Verifies a raw Firebase ID token string and returns the decoded identity.
 */
export async function verifyIdTokenString(token: string): Promise<VerifiedAuthToken | null> {
  if (!token) return null;
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      isAnonymous: decoded.firebase?.sign_in_provider === 'anonymous',
    };
  } catch {
    return null;
  }
}

/**
 * Verifies the Firebase ID token from an Authorization: Bearer <token> header
 * and returns the full decoded identity (uid, email, isAnonymous).
 */
export async function verifyAuthHeaderDetails(req: Request): Promise<VerifiedAuthToken | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return verifyIdTokenString(token);
}

/**
 * Verifies the Firebase ID token from an Authorization: Bearer <token> header.
 * Returns the verified uid, or null if missing/invalid.
 */
export async function verifyAuthHeader(req: Request): Promise<string | null> {
  const details = await verifyAuthHeaderDetails(req);
  return details?.uid ?? null;
}
