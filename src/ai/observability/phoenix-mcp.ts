/**
 * @fileOverview Arize Phoenix MCP client — gives the CFO agent the ability to
 * introspect its OWN reasoning traces.
 *
 * HACKATHON requirement: a meaningful integration with a partner's MCP server.
 * Phoenix is the trace/observability backend; its MCP server (@arizeai/phoenix-mcp)
 * exposes list-traces / get-trace / get-spans as tools. We connect to it as a
 * Genkit MCP client and surface those tools to the agent through a single
 * `inspect_reasoning_trace` tool (defined in personalized-ai-coaching.ts).
 *
 * Flow: the CFO logs every scoring/tool span to Phoenix (see phoenix.ts). When a
 * client asks "why did I get that score?" / "show me your reasoning", the agent
 * calls inspect_reasoning_trace, which pulls the most recent spans for this
 * project back through the Phoenix MCP server and lets the model explain (or
 * catch) exactly where the math came from.
 *
 * Entirely gated on PHOENIX_ENABLED — returns a friendly no-op when disabled.
 */
import type { Genkit, ToolAction } from 'genkit';

let clientPromise: Promise<ToolAction[]> | null = null;

function phoenixEnabled(): boolean {
  return process.env.PHOENIX_ENABLED === 'true' && !!process.env.PHOENIX_API_KEY;
}

/**
 * Lazily connect to the Phoenix MCP server (stdio via npx) and return its tools
 * as Genkit ToolActions. Cached for the life of the process.
 */
async function getPhoenixTools(ai: Genkit): Promise<ToolAction[]> {
  if (!phoenixEnabled()) return [];
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createMcpClient } = await import('@genkit-ai/mcp');
      const baseUrl = process.env.PHOENIX_COLLECTOR_ENDPOINT ?? 'https://app.phoenix.arize.com';
      const client = createMcpClient({
        name: 'phoenix',
        mcpServer: {
          command: 'npx',
          args: [
            '-y', '@arizeai/phoenix-mcp@latest',
            '--baseUrl', baseUrl,
            '--apiKey', process.env.PHOENIX_API_KEY as string,
          ],
        },
      });
      return client.getActiveTools(ai);
    })().catch((err) => {
      // Reset so a transient failure can be retried on the next request.
      clientPromise = null;
      // eslint-disable-next-line no-console
      console.error('[phoenix-mcp] failed to connect to Phoenix MCP server:', err);
      return [] as ToolAction[];
    });
  }
  return clientPromise;
}

const TRACE_LIST_HINTS = ['list-traces', 'list_traces', 'get-spans', 'get_spans', 'list-spans'];

/**
 * Pull recent reasoning spans for this project back through the Phoenix MCP
 * server. Returns a structured object the model can summarize, or a clear
 * status string when Phoenix is off / unreachable.
 */
export async function inspectReasoningTraceViaMcp(ai: Genkit, query: string): Promise<unknown> {
  if (!phoenixEnabled()) {
    return {
      status: 'phoenix_disabled',
      message:
        'Reasoning-trace inspection is offline right now (Phoenix tracing is not enabled in this environment).',
    };
  }

  const tools = await getPhoenixTools(ai);
  if (tools.length === 0) {
    return { status: 'mcp_unavailable', message: 'Could not reach the Phoenix MCP server.' };
  }

  // Find the Phoenix tool that lists/fetches traces. Tool names are namespaced
  // by the client (e.g. "phoenix/list-traces"), so match on the suffix.
  const traceTool = tools.find((t) =>
    TRACE_LIST_HINTS.some((h) => t.__action.name.toLowerCase().includes(h)),
  );
  if (!traceTool) {
    return {
      status: 'no_trace_tool',
      availableTools: tools.map((t) => t.__action.name),
      message: 'Connected to Phoenix MCP but found no trace-listing tool.',
    };
  }

  const projectName = process.env.PHOENIX_PROJECT_NAME ?? 'cfo-fitness';
  try {
    // Phoenix trace tools accept a project identifier; pass both common shapes
    // and a small limit. The model only needs the most recent spans.
    const result = await (traceTool as unknown as (input: unknown) => Promise<unknown>)({
      project_name: projectName,
      projectName,
      limit: 5,
    });
    return { status: 'ok', query, projectName, tool: traceTool.__action.name, trace: result };
  } catch (err: unknown) {
    return {
      status: 'query_failed',
      tool: traceTool.__action.name,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
