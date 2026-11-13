'use client';

import type { FirebaseApp } from 'firebase/app';
import {
  getAI,
  GoogleAIBackend,
  AgentPlatformBackend,
  type AI,
} from 'firebase/ai';

let googleAiInstance: AI | null = null;
let agentPlatformAiInstance: AI | null = null;

/**
 * Initializes the primary Firebase AI Logic SDK service with `GoogleAIBackend`.
 *
 * SDK RULE: Only `getAI(...)` is initialized here. `getGenerativeModel(ai, ...)`
 * MUST only be called on or after an end-user interaction (click/submit) inside
 * `src/lib/hybrid-ai.ts` so Chrome's Prompt API user-activation requirement is satisfied.
 */
export function getFirebaseAI(firebaseApp: FirebaseApp): AI {
  if (!googleAiInstance) {
    const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
    googleAiInstance = ai;
  }
  return googleAiInstance;
}

/**
 * Secondary Firebase AI Logic backend (`AgentPlatformBackend` on GCP Blaze) used
 * automatically when AI Studio free/prepay quota returns HTTP 429 on `GoogleAIBackend`.
 */
export function getFirebaseAgentPlatformAI(firebaseApp: FirebaseApp): AI {
  if (!agentPlatformAiInstance) {
    agentPlatformAiInstance = getAI(firebaseApp, {
      backend: new AgentPlatformBackend('global'),
    });
  }
  return agentPlatformAiInstance;
}
