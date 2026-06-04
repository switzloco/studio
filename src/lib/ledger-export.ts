/**
 * @fileOverview Client-side ledger export.
 *
 * Pulls the user's COMPLETE food / exercise / fast history (paging past
 * Firestore's per-query ceiling) and serializes it to CSV or JSON for download.
 * This is the reliable way to get the full dataset out — nothing is truncated
 * to the most-recent N the way the in-app ledger view is.
 */

import {
  collection, query, orderBy, limit, startAfter, getDocs, Firestore,
  QueryDocumentSnapshot, QueryConstraint, DocumentData,
} from 'firebase/firestore';
import type { FoodLogEntry, ExerciseLogEntry, FastLogEntry } from './food-exercise-types';

export interface LedgerExport {
  food: FoodLogEntry[];
  exercise: ExerciseLogEntry[];
  fasts: FastLogEntry[];
}

const PAGE = 500;

async function fetchAll<T>(db: Firestore, userId: string, name: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  const col = collection(db, 'users', userId, name);
  // Cap defensively so a runaway never hangs the tab.
  while (out.length < 20000) {
    const constraints: QueryConstraint[] = [orderBy('date', 'asc'), limit(PAGE)];
    if (cursor) constraints.push(startAfter(cursor));
    const snap = await getDocs(query(col, ...constraints));
    if (snap.empty) break;
    for (const d of snap.docs) out.push({ ...d.data(), id: d.id } as T);
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE) break;
  }
  return out.filter((e) => !(e as { ignored?: boolean }).ignored);
}

/** Fetch the user's entire ledger across all three collections. */
export async function fetchAllLedger(db: Firestore, userId: string): Promise<LedgerExport> {
  const [food, exercise, fasts] = await Promise.all([
    fetchAll<FoodLogEntry>(db, userId, 'food_log'),
    fetchAll<ExerciseLogEntry>(db, userId, 'exercise_log'),
    fetchAll<FastLogEntry>(db, userId, 'fast_log'),
  ]);
  return { food, exercise, fasts };
}

export function ledgerToJSON(data: LedgerExport): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), counts: {
        food: data.food.length, exercise: data.exercise.length, fasts: data.fasts.length,
      }, ...data },
    null, 2,
  );
}

const CSV_COLUMNS = [
  'date', 'time', 'type', 'name',
  'calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'portionG', 'meal', 'alcoholDrinks', 'hasSeedOils', 'source',
  'category', 'sets', 'reps', 'durationMin', 'weightKg', 'activityTier', 'estimatedCaloriesBurned', 'pointsDelta',
  'startedAt', 'endedAt', 'durationHours',
  'notes',
] as const;

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flat CSV with one row per entry across all types (type column distinguishes them). */
export function ledgerToCSV(data: LedgerExport): string {
  const rows: Record<string, unknown>[] = [];
  for (const f of data.food) {
    rows.push({ date: f.date, time: f.consumedAt, type: 'food', name: f.name,
      calories: f.calories, proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG, fiberG: f.fiberG,
      portionG: f.portionG, meal: f.meal, alcoholDrinks: f.alcoholDrinks, hasSeedOils: f.hasSeedOils, source: f.source });
  }
  for (const e of data.exercise) {
    rows.push({ date: e.date, time: e.performedAt, type: 'exercise', name: e.name,
      category: e.category, sets: e.sets, reps: e.reps, durationMin: e.durationMin, weightKg: e.weightKg,
      activityTier: e.activityTier, estimatedCaloriesBurned: e.estimatedCaloriesBurned, pointsDelta: e.pointsDelta, notes: e.notes });
  }
  for (const f of data.fasts) {
    rows.push({ date: f.date, time: f.startedAt, type: 'fast', name: f.endedAt ? 'Completed fast' : 'Active fast',
      startedAt: f.startedAt, endedAt: f.endedAt, durationHours: f.durationHours, notes: f.notes });
  }
  // Sort chronologically by date then time so the CSV reads top-to-bottom oldest→newest.
  rows.sort((a, b) => {
    const k = String(a.date ?? '').localeCompare(String(b.date ?? ''));
    return k !== 0 ? k : String(a.time ?? '').localeCompare(String(b.time ?? ''));
  });
  const header = CSV_COLUMNS.join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

/** Trigger a browser download of a text payload. */
export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
