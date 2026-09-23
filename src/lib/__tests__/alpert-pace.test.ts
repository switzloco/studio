import { describe, it, expect } from 'vitest';
import { computeAlpertPace } from '../alpert-pace';

const ALPERT = 1590;

describe('computeAlpertPace', () => {
  it('fires on a fasted day — nothing logged is exactly when it matters', () => {
    const pace = computeAlpertPace({ caloriesIn: 0, caloriesOut: 1500, alpertNumber: ALPERT, hoursElapsed: 14 });
    expect(pace).not.toBeNull();
    expect(pace!.fasted).toBe(true);
    expect(pace!.projectedDaily).toBe(Math.round((1500 / 14) * 24));
    expect(pace!.projectedBeyondAlpert).toBe(pace!.projectedDaily - ALPERT);
  });

  it('stays quiet on a fasted morning that has not reached the ceiling yet', () => {
    expect(computeAlpertPace({ caloriesIn: 0, caloriesOut: 700, alpertNumber: ALPERT, hoursElapsed: 9 })).toBeNull();
  });

  it('marks a fed day as not fasted', () => {
    const pace = computeAlpertPace({ caloriesIn: 400, caloriesOut: 2000, alpertNumber: ALPERT, hoursElapsed: 15 });
    expect(pace).not.toBeNull();
    expect(pace!.fasted).toBe(false);
  });

  it('fires once the deficit reaches 90% of the ceiling, not before', () => {
    expect(computeAlpertPace({ caloriesIn: 1000, caloriesOut: 2400, alpertNumber: ALPERT, hoursElapsed: 16 })).toBeNull(); // 1400 < 1431
    expect(computeAlpertPace({ caloriesIn: 1000, caloriesOut: 2450, alpertNumber: ALPERT, hoursElapsed: 16 })).not.toBeNull(); // 1450
  });

  it('never fires on a surplus or with no burn data', () => {
    expect(computeAlpertPace({ caloriesIn: 3000, caloriesOut: 2500, alpertNumber: ALPERT, hoursElapsed: 20 })).toBeNull();
    expect(computeAlpertPace({ caloriesIn: 0, caloriesOut: 0, alpertNumber: ALPERT, hoursElapsed: 20 })).toBeNull();
  });
});
