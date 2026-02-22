/**
 * @fileOverview Main entry point for Firebase services.
 * Re-exports the core SDK initialization and React-specific providers/hooks.
 */

export * from './sdk';
export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';
