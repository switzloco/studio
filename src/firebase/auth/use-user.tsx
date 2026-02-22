'use client';

import { useFirebase } from '@/firebase/provider';
import { User } from 'firebase/auth';

/**
 * Hook specifically for accessing the authenticated user's state.
 */
export function useUser() {
  const { user, isUserLoading, userError } = useFirebase();
  return { user, isUserLoading, userError };
}
