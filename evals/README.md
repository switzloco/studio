# Evals — CFO Fitness × Arize Phoenix

Reproducible accuracy evals for the CFO agent. Each run records per-case spans
to **Arize Phoenix** (when enabled) so the eval is visible right next to the
live agent traces — the "enterprise guardrails" proof for the hackathon.

## Nutrition Accuracy

Measures how accurately the agent estimates **calories + macros** for a meal
against a curated ground-truth dataset (`evals/nutrition-accuracy.eval.ts`).
Calories and protein are the headline metrics; each case passes if both land
within ±30% of the reference. The dataset is a plain array at the top of the
file — edit/extend it freely.

### Run it

```bash
PHOENIX_ENABLED=true \
PHOENIX_COLLECTOR_ENDPOINT=https://app.phoenix.arize.com/s/nicholas-switzer \
PHOENIX_API_KEY=<your phoenix key> \
PHOENIX_PROJECT_NAME=cfo-fitness-evals \
GOOGLE_GENAI_API_KEY=<your gemini key> \
npx tsx evals/nutrition-accuracy.eval.ts
```

- Runs fine **without** Phoenix too — it just prints the local report.
- Point `PHOENIX_PROJECT_NAME` at a **separate** project (e.g.
  `cfo-fitness-evals`) so eval runs don't mix with live user traces.

### What you get

- A console table with ✅/❌ per meal and the % error for calories + protein.
- A summary: overall pass rate + mean absolute error for calories and protein.
- In Phoenix: an `eval.nutrition_accuracy.suite` span containing one
  `eval.nutrition_accuracy` span per meal, each carrying `input.expected`,
  `output.predicted`, `output.passed`, and the error percentages.

### Demo line for judges

> "We don't just ship the agent — we measure it. Here's our nutrition-accuracy
> eval running through Arize Phoenix: X% calorie accuracy across the suite, and
> every case is a span you can open to see exactly where the model was off."
