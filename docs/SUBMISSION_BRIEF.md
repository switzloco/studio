# CFO Fitness — Submission Brief

> **Google Cloud Rapid Agent Hackathon · Arize Track**
> An AI agent that runs your health like a financial portfolio — and audits its
> own reasoning through Arize Phoenix.

---

## The problem

People don't fail at health because they lack information — they fail because
turning "I ate a chicken bowl and did basketball" into *accurate, trustworthy,
acted-upon* data is tedious and error-prone. Chatbots answer questions; they
don't *do the work* or *prove they did it right*.

## What CFO Fitness does

CFO Fitness is an agent — "the CFO" (Chief Fitness Officer) — that takes real
action on a user's behalf and keeps them in control:

- **Logs nutrition & workouts** from plain language or photos ("5 oz chicken and
  2 slices sourdough" → macros on the ledger).
- **Scores the day** with a metabolic engine (visceral-fat score, protein
  targets, fasting windows) using financial metaphors (protein = assets,
  alcohol = toxic debt).
- **Explains itself on demand** — tap "Explain this" and the agent replays its
  own reasoning, pulled back from its trace.

It's multi-step and tool-driven: a single turn can look up macros, log a meal,
recompute daily totals, run the scoring engine, and forecast the rest of the day.

## How it's built (the three pillars)

### 1. Gemini 3
The reasoning loop runs on **Gemini 3 Flash** (`googleai/gemini-3.5-flash`) via
Genkit, planning across a 13-tool suite (log food/exercise/fasts, score the day,
look up nutrition, hand off to a data-analyst sub-agent, and inspect its own
traces). Multimodal: it reads meal photos to estimate portions.

### 2. Arize Phoenix — the glass box (partner MCP integration)
Firebase holds the app state but is blind to *how the model reasons*. Phoenix
closes that gap:

- **Tracing** — every turn exports its spans (prompt I/O, each Gemini tool call,
  sub-flows) to Phoenix over OTLP. The deterministic scoring math is wrapped in
  its own `vf_scoring` span, so the exact inputs and the score breakdown sit
  next to the model's tool calls.
- **MCP** — the **Arize Phoenix MCP server** (`@arizeai/phoenix-mcp`) is wired
  in as a Genkit MCP client, backing the agent's `inspect_reasoning_trace` tool.
  The "Explain this" button in the UI calls it: the agent pulls its *own* trace
  back through MCP and narrates how it reached a number — self-auditing, not just
  self-reporting.
- **Evals** — reproducible accuracy evals run *through* Phoenix:
  - **Nutrition accuracy:** 10/10 cases pass (calorie + macro estimation within
    tolerance), including near-zero "gotcha" cases (water, black coffee) the
    model must not inflate.
  - **Multimodal guardrail:** shown a photo, the agent estimates macros for real
    food but *refuses to invent calories* for non-food (a shoe, a pet) — proof
    it knows its lane. Every case is a Phoenix span with a pass/fail.

### 3. Google Cloud Agent Builder
The reasoning loop is exposed as a server-to-server agent endpoint
(`/api/agent`) with an A2A discovery card at `/.well-known/agent.json` — the
surface Vertex AI Agent Builder / Agent Engine registers as the agent's
reasoning backend (see `docs/AGENT_BUILDER.md`).

## Why Arize matters here (the honest version)

Routine outages (a bad model version, a rate-limited API) show up in plain logs.
Where Arize earns its place is **reasoning-level** debugging and trust:

- When the agent mishears "2 oz milk" as "20 oz," the trace shows *what it heard,
  which tool it called, and with what arguments* — the misfire is visible instead
  of guessed at.
- The evals turn "seems accurate" into a measured number you can defend, and
  catch regressions when the model or prompt changes.
- For a *health* app, "show me why you scored that" is real user value — the
  "Explain this" button makes the glass box a feature, not just an internal tool.

## Results to show

- **Nutrition-accuracy eval:** 10/10 pass · per-case % error visible per span.
- **Multimodal guardrail eval:** food correctly scored, non-food correctly
  refused.
- **Live traces:** real chat turns landing in the `cfo-fitness` Phoenix project.
- **Self-audit:** the "Explain this" button replaying reasoning via MCP.

## Links

- **Repo:** github.com/switzloco/studio · **License:** MIT
- **Hosted app:** (Firebase App Hosting URL)
- **Phoenix project:** `cfo-fitness`
- **Eval code:** `evals/` (`npx tsx evals/nutrition-accuracy.eval.ts`,
  `evals/multimodal-food.eval.ts`)
- **Agent Builder:** `docs/AGENT_BUILDER.md`

## 60-second demo arc

1. Log a messy day (meal + drinks + workout) → ask "what's my VF score?"
2. Open Phoenix → expand the `vf_scoring` span → "here's every input, fully
   glass-box."
3. Back in the app → tap **"Explain this"** → the agent audits itself via the
   Phoenix MCP server.
4. Run the evals → "10/10 nutrition accuracy, and it refuses to call a shoe
   food — measured in Arize."
