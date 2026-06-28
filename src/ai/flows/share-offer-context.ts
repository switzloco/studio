/**
 * @fileOverview Per-request context for chat meal-share offers (server-only).
 *
 * The chat response is streamed as plain text, so there's no structured channel
 * to return "the agent decided this meal is worth sharing." We bridge that with
 * an AsyncLocalStorage store, scoped to a single chat turn:
 *
 *   - log_food pushes each newly created entry ID via recordLoggedFood()
 *   - the offer_meal_share tool (called only when the agent judges a meal a
 *     "win") calls setShareOffer(), which snapshots those IDs into an offer
 *   - the chat route reads getShareOffer() after the stream completes and
 *     appends it as a trailing sentinel
 *
 * AsyncLocalStorage (not a module global) keeps this correct under Cloud Run's
 * concurrency — each request gets its own isolated store.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChatShareOffer } from '@/lib/share-offer';

interface ShareOfferStore {
  loggedFoodIds: string[];
  loggedNames: string[];
  offer?: ChatShareOffer;
}

const storage = new AsyncLocalStorage<ShareOfferStore>();

/** Runs `fn` inside a fresh share-offer scope for one chat turn. */
export function runWithShareOffer<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ loggedFoodIds: [], loggedNames: [] }, fn);
}

/** Records a food_log entry created this turn (called by log_food). No-op outside a scope. */
export function recordLoggedFood(foodLogId: string, name: string): void {
  const store = storage.getStore();
  if (!store) return;
  store.loggedFoodIds.push(foodLogId);
  store.loggedNames.push(name);
}

/**
 * Surfaces a share offer for the meal(s) logged this turn. Returns false (and
 * does nothing) when no food was logged in this turn — the agent can't share a
 * meal that doesn't exist yet.
 */
export function setShareOffer(label: string): boolean {
  const store = storage.getStore();
  if (!store || store.loggedFoodIds.length === 0) return false;
  store.offer = { foodLogIds: [...store.loggedFoodIds], label };
  return true;
}

/** Reads the offer surfaced this turn, if any (called by the chat route after streaming). */
export function getShareOffer(): ChatShareOffer | undefined {
  return storage.getStore()?.offer;
}
