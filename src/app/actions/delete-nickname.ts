'use server';

import { getAdminFirestore } from '@/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Server Action to delete a saved food nickname from the user's preferences.
 */
export async function deleteNickname(userId: string, key: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!userId) throw new Error('User ID is required');
    if (!key) throw new Error('Nickname key is required');

    const db = getAdminFirestore();
    const prefRef = db.doc(`users/${userId}/preferences/settings`);

    // Use FieldValue.delete() with dotted path to atomically remove the specific nickname entry
    // Sanitizing key for dotted path safety
    const normalizedKey = key.toLowerCase().trim();
    await prefRef.update({
      [`foodNicknames.${normalizedKey}`]: FieldValue.delete(),
    });

    return { success: true };
  } catch (error: any) {
    console.error('[deleteNickname] Error:', error?.message ?? error);
    return { success: false, error: error?.message ?? 'Failed to delete nickname' };
  }
}
