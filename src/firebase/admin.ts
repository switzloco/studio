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

/**
 * Verifies the Firebase ID token from an Authorization: Bearer <token> header.
 * Returns the verified uid, or null if missing/invalid.
 */
export async function verifyAuthHeader(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}
