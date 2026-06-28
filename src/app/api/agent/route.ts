import { NextResponse } from 'next/server';
import { personalizedAICoaching } from '@/ai/flows/personalized-ai-coaching';
import { CFO_MODEL } from '@/ai/genkit';

/**
 * @fileOverview Google Cloud Agent Builder entrypoint for the CFO agent.
 *
 * This is the public, server-to-server invocation surface that Vertex AI Agent
 * Builder / Agent Engine (or any A2A-style orchestrator) registers as the
 * agent's reasoning backend. It wraps the same Genkit reasoning loop the app
 * uses — Gemini 3 Flash + the full CFO tool suite, with Arize Phoenix tracing
 * when enabled — behind a stable JSON contract.
 *
 *   GET  /api/agent   → the agent card (capabilities/skills) for discovery.
 *   POST /api/agent   → invoke the agent.
 *
 * Auth: server-to-server callers send `Authorization: Bearer <AGENT_API_KEY>`.
 * See docs/AGENT_BUILDER.md for registration + deploy steps.
 */

interface AgentInvokeBody {
  /** The end-user's message / instruction for the agent. */
  message?: string;
  /** Stable identifier for the user whose ledger the agent acts on. */
  userId?: string;
  /** Optional display name. */
  userName?: string;
  /** Optional conversation id (carried back in the response). */
  sessionId?: string;
  /** Optional prior turns so the agent keeps context across calls. */
  chatHistory?: { role: 'user' | 'model'; content: string }[];
  /** Optional client UTC offset in minutes (e.g. -480 for PST) for date math. */
  timezoneOffsetMinutes?: number;
}

function agentCard() {
  return {
    name: 'CFO Fitness Agent',
    description:
      'A health-and-fitness coaching agent ("the CFO") that plans and executes ' +
      'multi-step coaching tasks: logging nutrition and workouts, scoring a ' +
      "daily visceral-fat metric, and auditing its own reasoning. Built with " +
      'Gemini 3 and instrumented with Arize Phoenix for trace-level oversight.',
    version: '1.0.0',
    model: CFO_MODEL,
    capabilities: { streaming: false, toolUse: true, stateful: true },
    skills: [
      { id: 'log_nutrition', name: 'Log nutrition', description: 'Parse a meal and log macros to the user ledger.' },
      { id: 'log_exercise', name: 'Log exercise', description: 'Log a workout with wearable-accuracy adjustment.' },
      { id: 'score_daily_vf', name: 'Score the day', description: 'Run the metabolic engine to produce the daily VF score.' },
      { id: 'inspect_reasoning_trace', name: 'Audit reasoning', description: 'Pull recorded Phoenix traces and explain how a score was produced.' },
    ],
    endpoints: { invoke: '/api/agent' },
  };
}

export async function GET() {
  return NextResponse.json(agentCard());
}

export async function POST(req: Request) {
  try {
    const expectedKey = process.env.AGENT_API_KEY;
    if (!expectedKey) {
      return NextResponse.json(
        { error: 'Agent endpoint is not configured (AGENT_API_KEY unset).' },
        { status: 503 },
      );
    }
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as AgentInvokeBody;
    if (!body.message || typeof body.message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }
    if (!body.userId || typeof body.userId !== 'string') {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Resolve the client's local date/time from the supplied UTC offset so the
    // agent's day-boundary logic is correct regardless of where it's invoked.
    const offsetMin = typeof body.timezoneOffsetMinutes === 'number' ? body.timezoneOffsetMinutes : 0;
    const localNow = new Date(Date.now() - offsetMin * 60_000);
    const localDate = localNow.toISOString().slice(0, 10);
    const currentDay = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(localNow);
    const localTime = localNow.toISOString().slice(11, 16);

    const result = await personalizedAICoaching({
      userId: body.userId,
      userName: body.userName,
      message: body.message,
      currentDay,
      localDate,
      localTime,
      chatHistory: body.chatHistory,
    });

    return NextResponse.json({
      response: result.response,
      sessionId: body.sessionId ?? null,
    });
  } catch (error: any) {
    console.error('[AgentRoute] Error:', error?.message ?? String(error));
    return NextResponse.json({ error: error?.message ?? String(error) }, { status: 500 });
  }
}
