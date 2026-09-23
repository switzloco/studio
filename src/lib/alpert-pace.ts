/**
 * @fileOverview Alpert pace warning — is today's deficit running past the most
 * fat the body can supply in a day (the Alpert ceiling)? Past it, the rest of
 * the deficit comes from glycogen and lean tissue.
 *
 * Deliberately runs on the device burn (after the 0.90 discount) rather than the
 * score's 50%-credited burn: for a muscle-loss warning, the higher burn estimate
 * is the cautious one.
 */

export interface AlpertPaceInput {
  caloriesIn: number;      // logged so far today
  caloriesOut: number;     // device burn so far today
  alpertNumber: number;    // kcal/day fat-oxidation ceiling
  hoursElapsed: number;    // local hours since midnight
}

export interface AlpertPace {
  currentHourlyRate: number;
  hourlyBudget: number;
  projectedDaily: number;
  /** Projected deficit past the ceiling — the part that can't come from fat. */
  projectedBeyondAlpert: number;
  /** No food logged today — a fast, or food not logged yet. */
  fasted: boolean;
}

/**
 * Returns the warning, or null while the pace is sustainable. Fires when:
 *   1. the deficit so far is already ≥ 90% of the whole day's ceiling, or
 *   2. after 17:00, the projected day is ≥ 130% of the ceiling with ≥ 75% already spent.
 * A day with nothing logged still counts — a fast is exactly when this matters.
 *
 * Note: rule 2 can't fire on its own. At ≥ 17h, projecting ≥ 130% of the ceiling
 * needs a deficit ≥ 1.3 × 17/24 ≈ 92% of it, so rule 1 has already fired. Kept
 * as-is to preserve the dashboard's existing behavior.
 */
export function computeAlpertPace(input: AlpertPaceInput): AlpertPace | null {
  const { caloriesIn, caloriesOut, alpertNumber, hoursElapsed } = input;
  if (caloriesOut <= 0 || alpertNumber <= 0 || hoursElapsed <= 0) return null;

  const deficit = caloriesOut - Math.max(0, caloriesIn);
  if (deficit <= 0) return null;

  const currentHourlyRate = deficit / hoursElapsed;
  const projectedDaily = Math.round(currentHourlyRate * 24);
  const isCriticalDeficit = deficit >= alpertNumber * 0.9;
  const isLateDayBreach = hoursElapsed >= 17
    && projectedDaily >= alpertNumber * 1.3
    && deficit >= alpertNumber * 0.75;
  if (!isCriticalDeficit && !isLateDayBreach) return null;

  return {
    currentHourlyRate: Math.round(currentHourlyRate),
    hourlyBudget: Math.round(alpertNumber / 24),
    projectedDaily,
    projectedBeyondAlpert: Math.max(0, projectedDaily - alpertNumber),
    fasted: caloriesIn <= 0,
  };
}
