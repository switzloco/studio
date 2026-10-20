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

  it('computes calories and time until Alpert breach plus EOD floor', () => {
    // At 2:00 PM (14h), burned 1,200 kcal, eaten 200 kcal, Alpert limit 1,200 kcal
    // Current deficit = 1,000 kcal -> 200 kcal until Alpert breach
    const runway = computeEatRunway({
      caloriesIn: 200,
      scoredCaloriesOut: 1200,
      alpertNumber: 1200,
      hoursElapsed: 14,
      proteinG: 40,
      proteinGoal: 150,
      bmrKcal: 1800,
    });
    expect(runway.currentDeficitKcal).toBe(1000);
    expect(runway.kcalUntilAlpertBreach).toBe(200);
    expect(runway.hoursUntilAlpertBreach).toBeGreaterThan(2);
    expect(runway.alpertBreachTimeLabel).toBe('4:20 PM');
    expect(runway.expectedBreachTimeLabel).toBe('Today 4:20 PM');
    expect(runway.status).toBe('eat_soon');
    expect(runway.proteinToGoG).toBe(110);
  });

  it('keeps a 100-pt bedtime day at 10:00 PM safe through 8:00 AM wake-up and continuous on morning refresh', () => {
    // At 10:00 PM (22.0h) with a 100-pt day (1,212 kcal deficit against 1,732 Alpert cap, 1,767 BMR)
    const bedtime100PtRunway = computeEatRunway({
      caloriesIn: 1000,
      scoredCaloriesOut: 2212,
      alpertNumber: 1732,
      hoursElapsed: 22.0,
      proteinG: 155,
      proteinGoal: 150,
      bmrKcal: 1767,
    });
    expect(bedtime100PtRunway.fatFaucetPerMinKcal).toBe(1.2);
    expect(bedtime100PtRunway.overnightNetDrainHourlyKcal).toBe(15);
    expect(bedtime100PtRunway.safeThrough8amTomorrow).toBe(true);
    expect(bedtime100PtRunway.kcalBufferAt8amTomorrow).toBeGreaterThan(200);
    expect(bedtime100PtRunway.expectedBreachTimeLabel).toContain('Tomorrow 10:');

    // Tomorrow at 8:00 AM wake-up (8.0h): fasted (0 kcal in), 589 kcal sleep burn, carrying over tonight's midnight deficit
    const wakeRunway = computeEatRunway({
      caloriesIn: 0,
      scoredCaloriesOut: 589,
      alpertNumber: 1732,
      hoursElapsed: 8.0,
      proteinG: 0,
      proteinGoal: 150,
      bmrKcal: 1767,
      prevDayDeficitKcal: bedtime100PtRunway.projectedMidnightDeficitKcal,
    });
    expect(wakeRunway.kcalUntilAlpertBreach).toBe(bedtime100PtRunway.kcalBufferAt8amTomorrow);
    expect(wakeRunway.expectedBreachTimeLabel).toContain('Today 10:');
  });

  it('warns when safe through midnight but extreme deficit breaches overnight before 8:00 AM wake-up', () => {
    // 10:00 PM (22.0h) with only 250 kcal buffer: clears midnight (~75 kcal left), but ~15 kcal/hr net sleep drain breaches ~5:05 AM
    const runway = computeEatRunway({
      caloriesIn: 730,
      scoredCaloriesOut: 2212,
      alpertNumber: 1732,
      hoursElapsed: 22.0,
      proteinG: 150,
      proteinGoal: 150,
      bmrKcal: 1767,
    });
    expect(runway.kcalUntilAlpertBreach).toBe(250);
    expect(runway.alpertBreachTimeLabel).toBeNull();
    expect(runway.safeThrough8amTomorrow).toBe(false);
    expect(runway.kcalNeededFor8amTomorrow).toBeGreaterThan(30);
    expect(runway.expectedBreachTimeLabel).toContain('Tomorrow 5:');
    expect(runway.headline).toContain('Safe Through Midnight · Est. Breach Tomorrow');
  });

  it('flags immediate Alpert breach when current deficit exceeds alpertNumber', () => {
    const runway = computeEatRunway({
      caloriesIn: 0,
      scoredCaloriesOut: 1400,
      alpertNumber: 1150,
      hoursElapsed: 14.5,
      proteinG: 0,
      proteinGoal: 150,
    });
    expect(runway.kcalUntilAlpertBreach).toBe(-250);
    expect(runway.hoursUntilAlpertBreach).toBe(0);
    expect(runway.alpertBreachTimeLabel).toBe('Now');
    expect(runway.expectedBreachTimeLabel).toBe('Now');
    expect(runway.status).toBe('eat_now');
    expect(runway.headline).toContain('250');
  });

  it('computes EOD Alpert floor and 100-pt target intake accurately at end of day', () => {
    const runway = computeEatRunway({
      caloriesIn: 600,
      scoredCaloriesOut: 2500,
      alpertNumber: 1500,
      hoursElapsed: 24,
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
      caloriesIn: 1200,
      scoredCaloriesOut: 2000,
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
