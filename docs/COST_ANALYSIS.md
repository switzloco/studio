# Cost Analysis — CFO Fitness

**Date:** 2026-07-26
**Scope:** Per-user run cost of the AI stack + Firebase App Hosting.
**Reproduce the numbers:** `node scripts/cost-model.mjs` (reads the live prompt
and tool definitions out of `src/`, so it stays honest as the code changes).

---

## TL;DR

At one active user sending ~20 messages/day, the app bills roughly **$23/month**,
split:

| Line item | $/mo | Notes |
|---|---:|---|
| Cloud Run `minInstances: 1` idle | **9.72** | Billed 24/7 even at zero traffic |
| Gemini 2.5 Flash | **13.48** | Dominated by the agentic tool loop |
| Cloud TTS, Firestore, USDA | ~0 | Inside free tiers at this volume |

Two structural facts drive almost all of it:

1. **~42% of spend is a fixed idle charge** that exists whether or not anyone
   opens the app. At one user that is the single worst line item.
2. **Token cost grows quadratically per message**, not linearly. A 14,199-token
   static preamble is resent on *every* turn of a tool loop capped at 15 turns.

Fixing the top four items below takes the monthly bill from **~$23 to ~$6**
(-73%) with no change to what the coach can do.

---

## Measured baseline

### Static overhead billed on every single model call

```
CFO system prompt        10,242 tok
Tool JSON-Schemas (16)    3,957 tok
------------------------------------
Static preamble          14,199 tok   = $0.0043 per model call
```

This is paid *per model call*, and one user message is many model calls.

### Cost of one chat message

`cfoChatPrompt` runs with `maxTurns: 15`. Genkit resends the whole conversation
on every tool round trip, so input tokens accumulate as a running sum:

| Scenario | Input tok | Output tok | Cost |
|---|---:|---:|---:|
| Simple reply (0 tool calls) | 16,059 | 1,000 | $0.0073 |
| Text meal log (3 tool calls) | 74,316 | 2,440 | $0.0284 |
| Photo meal log (4 tool calls) | 112,095 | 2,920 | $0.0409 |
| **Worst case (`maxTurns: 15`)** | **506,544** | **8,200** | **$0.1725** |

One message can legitimately bill half a million input tokens.

---

## Findings, ranked by savings

### 1. `minInstances: 1` — $9.72/mo for an idle container

`apphosting.yaml` keeps one 1-vCPU / 512 MiB instance warm permanently. At
one user that is ~42% of total spend, and it is spent while you are asleep.

**Fix:** `minInstances: 0`.
**Trade-off:** cold starts of a few seconds on the first request after idle.
For a personal app that is the right trade; revisit when real users arrive.

Also worth tightening: `maxInstances: 10` × `concurrency: 80` provisions for 800
concurrent requests. Dropping `maxInstances` to 2–3 caps the blast radius of a
runaway loop or an abusive caller without affecting normal use.

**Saving: $9.72/mo (100% of this line).**

### 2. `maxTurns: 15` on a 14k-token preamble

The ceiling permits 16 model calls for one user message, each resending the full
static preamble plus every prior tool result. Real conversations resolve in 3–5
tool calls; the extra headroom is pure tail risk — $0.17 for a single message.

**Fix:** lower to `maxTurns: 8` in `personalizedAICoaching`. It preserves every
realistic flow and halves the worst case.

### 3. No thinking budget — thinking tokens bill at the output rate

There is no `thinkingConfig` anywhere in `src/`. Gemini 2.5 Flash therefore runs
**dynamic thinking by default**, and thinking tokens bill at **$2.50/M** — 8×
the input rate. The model thinks before *every* tool call, so a 5-call message
pays for five rounds of reasoning to emit what is mostly structured tool JSON.

**Fix:** set an explicit budget on `cfoChatPrompt.config`, e.g.
`thinkingConfig: { thinkingBudget: 512 }`, or `0` to disable. Tool-selection and
meal logging are not reasoning-hard tasks.

**Saving: ~16% of Gemini spend**, more on tool-heavy turns.

### 4. No explicit context caching

The 14,199-token preamble is byte-identical across requests — a textbook prefix
cache. Implicit caching on 2.5 models *may* discount it 75%, but only on a hit,
and its TTL is short enough that a single user chatting sporadically will miss
often.

**Fix:** register the system prompt + tool declarations as an explicit cached
context.

**Saving: ~38% of Gemini spend.** Combined with #3: **~54%.**

### 5. The 41 KB system prompt

`personalized-ai-coaching.ts` carries a 40,967-character system prompt —
10,242 tokens on every call, the largest single component. Much of it is voice
guidance and situational rules (release-codename lore, the anaerobic-imbalance
nudge, fasting-analysis policy) that apply to a small fraction of messages.

**Fix:** split into a lean always-on core plus sections injected conditionally.
Halving it saves ~5k tokens × every model call × every turn.

### 6. All 16 tool schemas attached to every request

3,957 tokens per call, regardless of context. `inspect_reasoning_trace` (191
tok) is a debugging affordance; `use_campaign_item`, `recall_food_nickname`, and
`set_temporary_context` are situational.

**Fix:** gate the situational tools behind context (campaign mode active,
Phoenix enabled) rather than attaching them unconditionally.

### 7. Photos are uploaded at full camera resolution

`chat-interface.tsx:96` does `reader.readAsDataURL(file)` on the raw file — no
downscale. A modern phone photo is 3–12 MP, and the image is re-sent on *every*
turn of the tool loop, so the cost multiplies by turn count.

The pattern already exists in the codebase: `src/lib/google-photos-picker.ts:178`
requests `=w1600` precisely because it "gives a good balance of quality vs
payload size for AI analysis." The direct-upload path just doesn't use it.

**Fix:** canvas-downscale to ~1600px on the longest edge before encoding.
Cuts image tokens and payload, with no loss for food recognition.

### 8. Phoenix tracing is on in production

`PHOENIX_ENABLED=true` in `apphosting.yaml` exports OTLP spans containing full
prompt I/O on every request, from a 512 MiB instance. That is egress, latency,
and Phoenix quota on every call.

Separately, `phoenix-mcp.ts` spawns `npx -y @arizeai/phoenix-mcp@latest` *inside
the Cloud Run container* on first use — a runtime package download on a
memory-constrained instance, pinned to `@latest` (also a supply-chain concern).

**Fix:** treat Phoenix as a debugging flag, not a production default. Turn it on
when investigating; leave it off otherwise. If it must stay on, sample rather
than exporting 100%.

---

## Cost-risk items (not current spend, but uncapped)

### `sendChatMessage` is an unauthenticated, unmetered path to Gemini

`src/app/actions/chat.ts` is a `'use server'` action, which Next.js exposes as a
callable POST endpoint. It:

- does **not** call `verifyAuthHeader` — it trusts a client-supplied `userId`
- does **not** call `checkRateLimit`
- passes `chatHistory` through **untrimmed**, unlike `/api/chat` which caps at
  `MAX_SENT_HISTORY = 12`

Every other LLM entry point (`/api/chat`, `/api/ledger-chat`, `/api/transcribe`,
`/api/ingest-share`) is behind both auth and a rate-limit bucket. This one is
not, and `chat-interface.tsx` no longer even calls it — line 12 imports it, but
the component posts to `/api/chat`. Its only live caller is
`src/lib/internal-audit.ts`.

**Fix:** delete the dead import, then either add `verifyAuthHeader` +
`checkRateLimit` to the action or remove it and point `internal-audit.ts` at the
API route. This is the highest-leverage change on the list — it is the
difference between a bounded bill and an open one.

### Rate limits permit $600/mo per user

`chat` allows 500 requests/day. At the measured $0.04 for a photo meal log, a
single user at the cap bills ~$20/day. The limits are a safety valve against
runaway loops, not a budget. Consider a daily *spend* ceiling alongside the
request ceiling, and a Google Cloud billing alert as the real backstop.

---

## Recommended order of work

| # | Change | Effort | Saving |
|---|---|---|---:|
| 1 | `minInstances: 1` → `0` | 1 line | $9.72/mo |
| 2 | Secure or remove `sendChatMessage` | small | caps tail risk |
| 3 | `thinkingConfig: { thinkingBudget: 512 }` | 1 line | ~16% of LLM |
| 4 | `maxTurns: 15` → `8` | 1 line | tail risk |
| 5 | Explicit prefix cache | medium | ~38% of LLM |
| 6 | Downscale photos client-side | small | image tokens × turns |
| 7 | `PHOENIX_ENABLED` → off by default | 1 line | egress + latency |
| 8 | Trim system prompt / gate tools | larger | ~5k tok/call |

Items 1, 3, 4, and 5 together: **~$23/mo → ~$6/mo (-73%)**.

---

## Caveats

- Token counts use a 4-chars-per-token approximation, not the Gemini tokenizer.
  Expect ±10% on the input figures.
- Prices are Gemini 2.5 Flash and us-central1 Cloud Run list rates as modeled in
  `scripts/cost-model.mjs`. Verify against current published pricing before
  relying on them to the cent.
- Message mix (40% simple / 40% text log / 20% photo log) is an assumption.
  Adjust with `--msgs-per-day`, or edit the mix in the script.
- **These are modeled numbers, not billed numbers.** The authoritative source is
  the Google Cloud billing console, broken down by SKU. Phoenix already records
  real token counts per call — if it stays enabled, that is the fastest route to
  replacing these estimates with measurements.
