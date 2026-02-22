import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/**
 * @fileOverview Core Firebase SDK initialization for both server and client environments.
 * This file is designed to be safe for import in Server Actions and Genkit flows
 * as it contains no React hooks or browser-only UI logic.
 */

export function initializeFirebase() {
  if (!getApps().length) {
    let firebaseApp;
    try {
      // In some environments, initializeApp() without arguments works
      firebaseApp = initializeApp();
    } catch (e) {
      // Fallback to the explicit config object
      firebaseApp = initializeApp(firebaseConfig);
    }
    return getSdks(firebaseApp);
  }
  return getSdks(getApp());
}

export function getSdks(firebaseApp: FirebaseApp) {
  return {
    firebaseApp,
    auth: getAuth(firebaseApp),
    firestore: getFirestore(firebaseApp)
  };
}
