# CFO Fitness

A Next.js 15 + Firebase + Genkit AI health-coaching agent. The coach — "the CFO"
(Chief Fitness Officer) — runs your health like a portfolio: protein is an
**asset**, visceral fat is a **liability**, a workout is an **equity injection**.
It plans and executes multi-step coaching tasks (log nutrition and workouts,
score a daily visceral-fat metric, audit its own math) while keeping you in
control.

## Stack

- **Next.js 15** (App Router, Turbopack), **React 19**, **TypeScript**
- **Firebase** — Firestore + Auth (Google OAuth + Anonymous)
- **Genkit 1.x** with **Gemini 3 Flash** for the reasoning loop
- **Arize Phoenix** for LLM-reasoning observability + MCP trace introspection
- **Shadcn/UI** + **Tailwind CSS**

## Quick start

```bash
cp .env.example .env.local   # fill in your keys
npm install
npm run dev                  # http://localhost:9002
```

See [`CLAUDE.md`](./CLAUDE.md) for full architecture notes.

---

## 🏆 Google Cloud Rapid Agent Hackathon — Arize Track

CFO Fitness is built for the **Arize partner bucket** of the *Building Agents for
Real-World Challenges* hackathon. The three required pillars:

### 1. Built with Gemini 3
The reasoning loop runs on **Gemini 3 Flash** (`googleai/gemini-3-flash-preview`,
overridable via `CFO_MODEL`). The model plans across a 13-tool suite — logging
food/exercise/fasts, running the metabolic scoring engine, looking up nutrition
data, and handing off to a data-analyst sub-agent.

### 2. Arize Phoenix — the missing logic monitor (partner MCP integration)
Firebase holds the app state, but it's blind to *how the model reasons*. Phoenix
fills that blind spot:

- **Tracing** (`src/ai/observability/phoenix.ts`) — every run exports its spans
  (prompt I/O, each Gemini tool call, sub-flows) to Phoenix over OTLP. The
  deterministic **VF-scoring math is wrapped in its own span**
  (`src/ai/observability/span.ts`), so the exact inputs and the score breakdown
  sit right next to the model's tool calls. If a score is wrong, you open
  Phoenix and see precisely where the logic went sideways — enterprise-grade
  guardrails on the agent.
- **MCP** (`src/ai/observability/phoenix-mcp.ts`) — the **Arize Phoenix MCP
  server** (`@arizeai/phoenix-mcp`) is wired in as a Genkit MCP client, backing
  the agent's `inspect_reasoning_trace` tool. Ask the CFO *"why was my score
  negative today?"* and it pulls its own recorded trace back through MCP and
  explains the math.

All Phoenix wiring is **env-gated on `PHOENIX_ENABLED=true`** and fail-safe — the
app runs unchanged when it's off.

### 3. Built for Google Cloud Agent Builder
The reasoning loop is exposed as a server-to-server agent endpoint
(`src/app/api/agent/route.ts`) with an A2A discovery card at
[`/.well-known/agent.json`](./public/.well-known/agent.json). This is the surface
Vertex AI Agent Builder / Agent Engine registers as the agent's reasoning
backend. Setup and registration steps: [`docs/AGENT_BUILDER.md`](./docs/AGENT_BUILDER.md).

### Enabling Phoenix for the demo

```bash
# .env.local
PHOENIX_ENABLED=true
PHOENIX_COLLECTOR_ENDPOINT=https://app.phoenix.arize.com
PHOENIX_API_KEY=<your phoenix cloud api key>
PHOENIX_PROJECT_NAME=cfo-fitness
```

Then run the app, send a few chat turns (log a meal, ask for your VF score), and
open your Phoenix project to watch the traces stream in.

## License

[MIT](./LICENSE)
