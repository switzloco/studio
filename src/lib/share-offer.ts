/**
 * @fileOverview Shared contract for the chat "share this meal" offer.
 *
 * Safe to import from both server (chat API route, AI flow) and client (chat
 * UI). Contains no Node-only APIs — the AsyncLocalStorage machinery lives in
 * src/ai/flows/share-offer-context.ts.
 */

/**
 * Delimiter appended to the END of a chat stream to carry a structured share
 * offer after the model's free text. Built from NUL bytes so it can never
 * collide with real markdown content. The client splits on this and strips it
 * before rendering.
 */
export const SHARE_OFFER_SENTINEL = `${String.fromCharCode(0)}CFO_SHARE_OFFER${String.fromCharCode(0)}`;

/** A surfaced offer to share a just-logged meal, decided by the agent. */
export interface ChatShareOffer {
  /** food_log entry IDs logged this turn that make up the shareable meal. */
  foodLogIds: string[];
  /** Short, on-brand label for the chip, e.g. "Blue-chip protein play — share it?". */
  label: string;
}
