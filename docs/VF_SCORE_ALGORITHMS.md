# VF Score Algorithms: Version Summary for Expert Review

What this file is: a self-contained description of each version of the CFO Fitness
"Visceral Fat (VF) Score", a daily points score that tries to reward fat oxidation
and penalize fat storage and muscle catabolism. It was written for review by a
metabolic physiologist, or by an AI helping one.

- Live version: **v3.2 "Taylor–Joule"** (v3.2 section below; §2–§5 describe v3.1 and earlier)
- Source of truth: `src/lib/vf-scoring.ts` (scoring), `src/lib/metabolic-engine.ts`
  (simulation and constants), `src/lib/scoring-releases.ts` (release history)
- The v2.0 and v3.0 descriptions come from the release notes. v1.0 and v3.1 were
  read from the code.

---

## 0. v3.2 "Taylor–Joule" (current): energy balance, glycogen-neutral

**Why it changed.** The v3.1 simulation starts every day at the same glycogen
level (liver 280 kcal, muscle 80%) and never carries it over. So each day's
glycogen swing is an artifact. The 30% glycogen credit then paid points for that
drawdown without ever charging for the refill. The result was a rest day at
maintenance (zero energy deficit) scoring about +18. Over a 65-day block that is
~1,100 points with no fat lost.

**The rule.** Over any run of days, glycogen returns to where it was. What's left
of the energy deficit after muscle loss is fat.

```
burn  = BMR + 0.5 × (deviceCaloriesOut − BMR)      // BMR: Mifflin-St Jeor, sex-averaged
fat   = min(Alpert, (burn − caloriesIn) − muscleLost)
score = (fat / D) × 100 − (muscleLost / 10) × 2 + alcoholPenalty − 5 × seedOilMeals
```

**Activity credit (50%).** Food intake is logged precisely. Wearable burn has
±20–30% per-person error, even though its population average is close to right.
So the score counts resting burn in full and only half of what the device adds
on top. The consequence: eating back the device's full burn on an active day
scores as a surplus of half that day's activity. This is meant to be replaced
by a per-user factor once there's a reliable weight trend.

| | v3.1 | v3.2 |
|---|---|---|
| Glycogen drawn | +30% credit | Neutral |
| Carb refeed after training | Mostly scored as fat stored (refill = 6% / 15% of gross absorption) | Carbs refill glycogen before any fat is stored; neutral at maintenance |
| Fat-storage penalty | Per-slot, capped at the faucet rate | Retired. A surplus scores negative directly |
| Net-surplus penalty | Separate term | Retired (inside the energy balance) |
| Deficit beyond Alpert | Implicitly limited by the per-slot faucet | Not credited; reported as `deficitBeyondAlpertKcal` |
| Role of the simulation | Drives the score | Decides the fat-vs-muscle split and feeds the intraday charts |

Reference results (205 lb, 25% body fat, 183 cm, age 40; BMR ≈ 1,796, D = 1,112). "Device" is the watch's full-day burn after the 0.90 discount:

| Day | v3.1 | v3.2 | Burn counted |
|---|---|---|---|
| Rest, eat = device burn | +18 | −45 | 2,298 of 2,800 |
| Rest, 400 under device | +37 | −9 | 2,298 of 2,800 |
| Run day, 400 under device | +23 | −36 | 2,598 of 3,400 |
| Basketball, eat = device burn (refeed) | +5 | −86 | 2,748 of 3,700 |
| Basketball, 1,650 eaten | 104 | 99 | 2,748 of 3,700 |
| Rest, 1,650 eaten | 80 | 58 | 2,298 of 2,800 |

The glycogen fix alone (burn counted in full) brings every maintenance day,
rest or training, to 0 instead of v3.1's +7 to +36. The negative numbers above
are the 50% activity credit at work: a day only scores positive once intake is
below the *credited* burn.

**Calorie burn input.** The burn is the device's full-day figure × 0.90, now
applied the same way on every path. The Google Health connect backfill
previously skipped it. Validation studies put Fitbit slightly *low* on average
(−7% vs doubly labeled water over 15 free-living days), so the 10% is a safety
margin, not a bias correction.

**Open questions for the reviewer.**
1. Should deficit beyond the Alpert ceiling also be *penalized* as lean loss, not just left uncredited?
2. The muscle term still comes from a same-day simulation with a fixed glycogen start. Is that the right proxy?

---

## 1. Shared definitions

| Term | Definition |
|---|---|
| Alpert number `A` | Maximum sustainable fat oxidation, kcal/day = `max(500, fatMassLbs × 31)` (Alpert 2005). Defaults: 68 kg and 25% body fat if unknown. |
| Points denominator `D` | `0.70 × A`. **100 pts = burning 70% of the user's Alpert number as fat in one day.** (v2.0+) |
| Slot | 15-minute interval. The simulation runs 06:00–24:00 (73 slots). |
| Fat faucet | Per-slot fat oxidation ceiling = `A / 96 × fatOxEfficiency × zone2Boost` |
| fatOxEfficiency | `(1 − insulin) × hrvMult × (1 + caffeineBoost) × hydrationDrag` |

---

## 2. Version comparison

| | v1.0 Drago–Moore | v2.0 GSP–Gilfoyle | v3.0 Balboa–Hopper | v3.1 Bull–Lovelace |
|---|---|---|---|---|
| Core idea | Deficit = points | Score simulated fat oxidation, normalized per body | v2 + training effort counts | v3.0 + alcohol rule rebuilt from the physiology |
| Base score | `deficit / 10` | Σ slots: fat burned − fat stored − muscle lost | + 30% glycogen-drawn credit | same as v3.0 |
| Normalization | None (1000 kcal deficit = 100 for everyone) | Per user, via `D` | via `D` | via `D` |
| Limits | Floor −200, no cap | No limits | No limits | No limits |
| Simulation drives score? | No (informational only) | Yes | Yes | Yes |
| Muscle loss | Ignored | −2 pts / 10 kcal | same | same |
| Exercise | Via deficit only | Zone 2 → faucet ×1.5; no cardio penalty | + glycogen credit | same |
| Fat storage | Via surplus only | Penalized per slot | Per-slot penalty capped at the faucet rate + net-surplus penalty | same |
| Fasting | 24h+ fast → flat +100 | Removed (counts only through the simulation) | same | same (≥16h is coaching context only) |
| Alcohol | −5 pts/drink | Positive accrual zeroed for 3h per drinking entry; −25 if drank yesterday | 3h pause kept; consecutive-day penalty proportional; late-night loophole closed | Clearance-hour debit (see §4) |
| Seed oils | −5 / meal | −5 / meal | −5 / meal | −5 / meal |
| HRV | Multiplier on positive scores | Faucet efficiency ×0.85 (<30 ms) / ×1.10 (>80 ms) | same | same |
| Why it was replaced | Fasting days went very negative; muscle loss not counted; one scale for all bodies | Training days scored ~0 (glycogen use earned nothing) | Drinking after a meal cost 0; drink count ignored; worse benders paid less | — |

---

## 3. v3.1 formula (previous)

```
score = Σ_slot [ (fatBurned / D)       × 100
               − (min(fatStored, A/96) / D) × 100
               − (muscleLost / 10)     × 2
               + (glycogenDrawn / D)   × 100 × 0.30 ]
        − (max(0, kcalIn − kcalOut) / D) × 100      // net surplus penalty
        + alcoholPenalty                             // ≤ 0, see §4
        − 5 × seedOilMeals
```

Rounded to an integer, never clamped.

### Energy-source order per slot (the key assumption to review)

Each slot's burn = BMR/slot + exercise burn/slot. It is met in this order:

1. **Gut**: calories currently being absorbed
2. **Fat**: up to the fat faucet
3. **Liver glycogen**: max 400 kcal, starts the day at 280, refills at 6% of absorption
4. **Muscle glycogen**: max `clamp(leanKg × 60, 800, 2400)`, ×1.15 with creatine; starts at 80%, refills at 15% of absorption
5. **Muscle protein**: whatever is left × `(1 − 0.5 × anabolicSignal)`

Fat stored = absorption − burn − glycogen refills (floored at 0).

### Sub-models

| Model | Rule |
|---|---|
| Food absorption | Spread over `min(24, 6 + 0.5×fiberG + 0.2×fatG)` slots (1.5–6h) |
| Insulin | Spike = `min(1, carbKcal/400 × GI/100)`; decays 0.125/slot (a full spike clears in ~2h) |
| Protein / MPS | A meal with ≥20 g protein adds `min(1, g/40)`; decays ×0.9/slot |
| anabolicSignal | `min(1, protein × (1.5 if lifting) × alcoholTax)`; alcoholTax 0.7, or 0.5 within 4h of lifting |
| Caffeine | Decays ×0.965/slot; boost `min(0.20, mg/100 × 0.05)` |
| Zone 2 | Faucet ×1.5 during steady-state cardio (≈ FatMax) |
| Exercise tier discount | walking 1.0, steady-state 0.80, anaerobic 0.65 |
| HRV | <30 → ×0.85, >80 → ×1.10 |
| Alcohol in slot | Fat efficiency ×0.95 (hydration drag); drains liver glycogen 30 kcal/drink over the clearance window |
| No per-meal logs | Daily kcal split 25/35/40% at 07:00 / 12:30 / 18:30 |

---

## 4. v3.1 alcohol model

The model: ADH oxidation creates excess NADH, and with NAD+ in short supply,
β-oxidation stalls. Elimination is zero-order, so volume sets the duration. ADH is
already saturated, so depth saturates quickly.

```
hoursPerDrink  = 1.5 × (1.79 m² / (BSA_Mosteller × ageFactor))
ageFactor      = 1 − 0.005 × max(0, age − 40)
hours          = drinks × hoursPerDrink
depth          = 0.85 × drinks / (drinks + 0.4)
alcoholPenalty = −hours × depth × 5.952          // 5.952 = 100 / (24 × 0.70)
```

- The whole session is charged to the drinking day, even if clearance runs past midnight.
- The penalty doesn't depend on timing or on how the drinks were split into log entries.
- Example for the reference body (170 cm, 68 kg, ≤40 y): 1 drink ≈ −5 pts, 3 drinks ≈ −20, 6 drinks ≈ −43.

---

## 5. Constants (JSON)

```json
{
  "version": "3.1",
  "alpert": { "kcalPerLbFatPerDay": 31, "floorKcal": 500, "defaultWeightKg": 68, "defaultBodyFatPct": 25 },
  "scoring": {
    "alpertScoreFraction": 0.70,
    "musclePenaltyPtsPer10Kcal": 2,
    "glycogenCreditFraction": 0.30,
    "seedOilPenaltyPerMeal": 5,
    "clamp": null
  },
  "simulation": {
    "slotMinutes": 15, "startHour": 6, "endHour": 24,
    "liverGlycogenMaxKcal": 400, "liverGlycogenStartKcal": 280, "liverRefillFraction": 0.06,
    "muscleGlycogenKcalPerLeanKg": 60, "muscleGlycogenMinKcal": 800, "muscleGlycogenMaxKcal": 2400,
    "muscleGlycogenCreatineMult": 1.15, "muscleGlycogenStartPct": 80, "muscleRefillFraction": 0.15,
    "insulinDecayPerSlot": 0.125, "zone2FatBoost": 1.5,
    "hrvLowThresholdMs": 30, "hrvLowMult": 0.85, "hrvHighThresholdMs": 80, "hrvHighMult": 1.10,
    "proteinMpsThresholdG": 20, "proteinDecayPerSlot": 0.9,
    "muscleSparingMax": 0.5, "liftingAnabolicBoost": 1.5,
    "alcoholAnabolicTax": 0.7, "alcoholAnabolicTaxNearLifting": 0.5,
    "caffeineDecayPerSlot": 0.965, "caffeineBoostMax": 0.20,
    "exerciseTierDiscount": { "walking": 1.0, "steadyState": 0.80, "anaerobic": 0.65 }
  },
  "alcohol": {
    "anchorHoursPerDrink": 1.5, "anchorBsaM2": 1.79,
    "suppressionDmax": 0.85, "suppressionHalfSatDrinks": 0.4,
    "hepaticAgeOnset": 40, "hepaticAgeDeclinePerYear": 0.005,
    "ptsPerSuppressedHour": 5.952,
    "hydrationDrag": 0.95, "liverGlycogenDrainKcalPerDrink": 30
  }
}
```

---

## 6. Questions for the reviewer

1. **Energy-source order.** Is fat before liver glycogen defensible at rest? During exercise?
2. **Alpert cap.** Is 31 kcal per lb of fat per day a valid per-person ceiling on fat oxidation, and is 70% of it a sensible "perfect day"?
3. **Muscle glycogen capacity.** Is 60 kcal per kg of lean mass (clamped to 800–2,400 kcal), plus 15% with creatine, reasonable?
4. **Insulin.** Is a ~2h clearance for a full spike, driven by carbs × GI, reasonable?
5. **Fixed multipliers.** Are the glycogen credit (30%), Zone 2 boost (1.5×) and muscle penalty (2 pts per 10 kcal) proportionate?
6. **Protein.** Is it right that meals ≥20 g protein spare up to 50% of muscle catabolism, with lifting boosting that?
7. **Alcohol.** Are 1.5 h per drink, 85% maximum suppression, and the saturating depth curve reasonable?
8. **What's missing.** Sleep and fasting duration currently carry no points. Should they?
