'use server';

import { getAdminAuth, getAdminFirestore, verifyIdTokenString } from '@/firebase/admin';

/**
 * Permanently deletes the signed-in user's Firestore ledger (root user doc +
 * all nested subcollections: food_log, exercise_log, chat_sessions, preferences, etc.)
 * and removes their Firebase Auth record.
 *
 * Required by Apple App Store Guideline 5.1.1(v) and Google Play Data Safety
 * Account Deletion policy.
 */
export async function deleteMyAccountAction(
  idToken: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await verifyIdTokenString(idToken);
    if (!auth) {
      return { success: false, error: 'Unauthorized: please sign in again before deleting your account.' };
    }

    const db = getAdminFirestore();
    const userRef = db.doc(`users/${auth.uid}`);

    // Recursively delete user document and all subcollections
    await db.recursiveDelete(userRef);

    // Delete Firebase Auth user record (best-effort if already removed)
    try {
      await getAdminAuth().deleteUser(auth.uid);
    } catch (authErr: any) {
      if (authErr?.code !== 'auth/user-not-found') {
        console.warn('[deleteMyAccountAction] Auth delete warning:', authErr?.message ?? authErr);
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error('[deleteMyAccountAction] Error:', err?.message ?? err);
    return {
      success: false,
      error: err?.message ?? 'Failed to delete account data.',
    };
  }
}
