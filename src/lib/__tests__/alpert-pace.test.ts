import { describe, it, expect } from 'vitest';
import { computeAlpertPace, computeEatRunway, slotToTimeLabel } from '../alpert-pace';
import { runMetabolicSimulation } from '../metabolic-engine';

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

describe('computeEatRunway', () => {
  it('formats 15-minute slot indices as 12-hour clock times', () => {
    expect(slotToTimeLabel(0)).toBe('6:00 AM');
    expect(slotToTimeLabel(24)).toBe('12:00 PM');
    expect(slotToTimeLabel(34)).toBe('2:30 PM');
  });

  it('computes Alpert floor and 100-pt target intake accurately', () => {
    const runway = computeEatRunway({
      caloriesIn: 600,
      scoredCaloriesOut: 2500,
      alpertNumber: 1500,
      hoursElapsed: 11,
      proteinG: 80,
      proteinGoal: 160,
    });
    expect(runway.alpertFloorIntakeKcal).toBe(1000); // 2500 - 1500
    expect(runway.kcalToAlpertFloor).toBe(400);      // 1000 - 600
    expect(runway.target100PtIntakeKcal).toBe(1450); // 2500 - 1050
    expect(runway.kcalLeftFor100Pts).toBe(850);      // 1450 - 600
    expect(runway.proteinToGoG).toBe(80);
  });

  it('flags tight protein window when too many meals remain before 8:30 PM', () => {
    const runway = computeEatRunway({
      caloriesIn: 500,
      scoredCaloriesOut: 2200,
      alpertNumber: 1500,
      hoursElapsed: 16, // 4:00 PM -> 4.5h until 8:30 PM
      proteinG: 20,
      proteinGoal: 160, // 140g to go -> 4 meals needed -> (4-1)*3 = 9h > 4.5h
    });
    expect(runway.proteinWindowTight).toBe(true);
    expect(runway.status).toBe('eat_soon');
  });

  it('detects intraday muscle burn slot from metabolic simulation on a heavy fasted burn day', () => {
    const sim = runMetabolicSimulation({
      caloriesOut: 3200,
      alpertNumber: 1400,
      caloriesIn: 0,
    });
    const runwayMorning = computeEatRunway({
      caloriesIn: 0,
      scoredCaloriesOut: 2500,
      alpertNumber: 1400,
      hoursElapsed: 9, // 9:00 AM
      proteinG: 0,
      proteinGoal: 150,
      slots: sim.slots,
    });
    expect(runwayMorning.firstMuscleBurnSlot).not.toBeNull();
    expect(runwayMorning.muscleBurnStartTimeLabel).toBeTruthy();
  });
});

