# CFO Fitness

> **Google Cloud Rapid Agent Hackathon · Arize Track**

---

## Inspiration

People don't fail at health because they lack information — they fail because
turning "I ate a chicken bowl and played basketball" into *accurate, trustworthy,
acted-upon* data is tedious and error-prone. Every fitness app asks you to do the
bookkeeping. None of them hire you an accountant.

We asked: what if your health had a CFO? An agent that doesn't just answer
questions — it *does the work*, *proves it did it right*, and *opens the books*
when you ask.

## What it does

CFO Fitness is an AI agent — the "Chief Fitness Officer" — that runs your health
like a financial portfolio. Not a chatbot that suggests — an agent that *acts*:

- **Writes your data.** Say "5 oz chicken and 2 slices sourdough" and the agent
  looks up macros, then *writes the meal directly to Firestore* — calories,
  protein, fat, carbs, timestamp, all persisted. No confirmation dialogs, no
  manual entry.
- **Reads your history.** Every turn retrieves your existing meals, exercises,
  fasts, and scores from Firestore to build full-day context. The agent doesn't
  guess what you've eaten — it *knows*, because it reads the ledger it wrote.
- **Scores your day** with a metabolic engine using financial metaphors: protein
  is assets, alcohol is toxic debt, fasting is compound interest. The score is
  computed from real persisted state, not a single-turn estimate.
- **Audits itself on demand.** Tap "Explain this" and the agent pulls its *own*
  reasoning trace back through Arize Phoenix MCP and narrates exactly how it
  reached a number. Glass box, not black box.

A single turn can chain 4–5 tool calls: retrieve today's ledger from Firestore →
look up macros → write the meal → recompute daily totals → run the scoring
engine → forecast the rest of your day. Multi-step, stateful, read-write.

## How we built it

**Three pillars:**

**Gemini 3 Flash** powers the reasoning loop via Genkit, planning across a
13-tool suite — log food, log exercise, track fasts, score the day, look up
nutrition, hand off to a data-analyst sub-agent, and inspect its own traces.
Multimodal: it reads meal photos to estimate portions.

**Firestore is the agent's memory.** This isn't prompt-stuffing — it's a full
RAG and write-back loop. The agent *retrieves* the user's meals, exercises,
fasts, and score history from Firestore at the start of every turn to build
grounded context, then *writes back* new entries and updated scores as it acts.
The model reasons over real persisted state, not a sliding context window. That
means turn 50 is as accurate as turn 1.

**Arize Phoenix** is the glass box. Every turn exports spans (prompt I/O, tool
calls, sub-flows) to Phoenix over OTLP. The deterministic scoring math lives in
its own `vf_scoring` span so the exact inputs sit right next to the model's
reasoning. The **Phoenix MCP server** (`@arizeai/phoenix-mcp`) backs the agent's
self-audit tool — it doesn't just *report* what it did, it *retrieves and
replays* its own trace. We also built reproducible evals that run through Phoenix:
nutrition accuracy (10 cases, calorie + macro tolerance) and a multimodal
guardrail (scores real food, refuses to invent calories for a shoe).

**Google Cloud Agent Builder** exposes the reasoning loop as a server-to-server
endpoint (`/api/agent`) with an A2A discovery card at
`/.well-known/agent.json` — ready for Vertex AI Agent Engine to register as the
reasoning backend.

## Challenges we ran into

- **Calorie hallucination is real.** Early prompts had the model inventing 200
  calories for black coffee. We built evals that catch this — zero-calorie items
  are now explicit test cases, and the model must refuse to score non-food images
  (yes, we fed it a shoe).
- **Tracing deterministic math alongside stochastic reasoning.** The VF scoring
  engine is pure math, but it lives inside an agent turn. Wrapping it in its own
  Phoenix span so you can see *both* the model's choices and the exact arithmetic
  took real plumbing.
- **Making self-audit feel like a feature, not a debug tool.** Wiring Phoenix MCP
  into the chat UI so a user can tap "Explain this" and get a *narrated* trace —
  not a raw JSON dump — required treating observability as UX.

## Accomplishments that we're proud of

- **A real read-write agent, not a chatbot wrapper.** The agent retrieves state
  from Firestore, reasons over it, takes action, and writes results back —
  autonomously, in a single turn. It manages persistent data on the user's
  behalf. That's the line between "agent" and "LLM with a UI."
- **10/10 nutrition accuracy eval** — every test case passes within tolerance,
  including near-zero gotchas the model used to inflate.
- **Multimodal guardrail eval** — the agent correctly scores real food photos and
  *refuses to invent calories* for non-food. Measured, not vibes.
- **Self-auditing agent** — "Explain this" isn't a prompt hack. The agent
  retrieves its own trace via MCP and walks you through its reasoning. For a
  health app, that's not a nice-to-have — it's trust.
- **Full glass-box tracing** — every turn, every tool call, every scoring
  breakdown lands in Phoenix. When the agent mishears "2 oz milk" as "20 oz," you
  see exactly where and why.

---

## Links

- **Repo:** github.com/switzloco/studio · **License:** MIT
- **Hosted app:** (Firebase App Hosting URL)
- **Blog:** [nickswitzer1.substack.com](https://nickswitzer1.substack.com/) — building the app in public + fitness journey
- **Phoenix project:** `cfo-fitness`
- **Eval code:** `evals/` (`npx tsx evals/nutrition-accuracy.eval.ts`,
  `evals/multimodal-food.eval.ts`)
- **Agent Builder:** `docs/AGENT_BUILDER.md`
