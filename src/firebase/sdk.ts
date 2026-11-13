import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

/**
 * @fileOverview Core Firebase SDK initialization for both server and client environments.
 * Safe for import in Server Actions and Genkit flows while enabling IndexedDB
 * persistent multi-tab local cache on browser clients for 100% offline Ledger/Metrics operation.
 */

let clientFirestoreInstance: Firestore | null = null;

function getOrInitFirestore(firebaseApp: FirebaseApp): Firestore {
  if (typeof window === 'undefined') {
    return getFirestore(firebaseApp);
  }

  if (clientFirestoreInstance) {
    return clientFirestoreInstance;
  }

  try {
    clientFirestoreInstance = initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    // Fallback if Firestore was already initialized during HMR or in restricted WebViews
    clientFirestoreInstance = getFirestore(firebaseApp);
  }

  return clientFirestoreInstance;
}

export function initializeFirebase() {
  if (!getApps().length) {
    let firebaseApp: FirebaseApp;
    try {
      // On Firebase App Hosting without explicit args, initializeApp() reads FIREBASE_WEBAPP_CONFIG
      firebaseApp = initializeApp();
    } catch {
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
    firestore: getOrInitFirestore(firebaseApp),
  };
}
