export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyDqnzXqOR6Hgy-89JrHXvN5WW_2Cg6b9Ho',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'studio-4236902803-1eba2.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'studio-4236902803-1eba2',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:473903412658:web:eef5c9dedfc81194f020ab',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '473903412658',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? '',
};
