/**
 * @fileOverview Arize Phoenix tracing wiring for the CFO reasoning loop.
 *
 * HACKATHON / TEMPORARY: this entire module is a no-op unless PHOENIX_ENABLED
 * is set to "true", so it can be cleanly disabled (or removed) after the
 * Google Cloud Rapid Agent Hackathon. When enabled, it registers a global
 * OpenTelemetry tracer provider that ships Genkit's spans (prompt I/O, every
 * tool call, sub-flows, and our custom VF-scoring spans) to Phoenix over OTLP.
 *
 * Genkit emits spans through the global @opentelemetry/api provider, so as long
 * as this provider is registered BEFORE Genkit initializes (it is imported at
 * the top of src/ai/genkit.ts and from Next.js instrumentation.ts), Phoenix
 * receives the full reasoning trace — the "missing logic monitor" view that
 * lets judges see exactly where the model's math came from.
 *
 * Phoenix Cloud config (env):
 *   PHOENIX_ENABLED=true
 *   PHOENIX_COLLECTOR_ENDPOINT=https://app.phoenix.arize.com   (no trailing /v1/traces)
 *   PHOENIX_API_KEY=<your phoenix cloud api key>
 *   PHOENIX_PROJECT_NAME=cfo-fitness                            (optional)
 */

// Guard against double-registration: Next.js + the Genkit import path can both
// pull this module in. We only want one tracer provider.
const GLOBAL_FLAG = '__cfo_phoenix_registered__';

// Kept so short-lived processes can force-flush spans before exiting.
let activeProvider: { forceFlush?: () => Promise<void> } | null = null;

function setupPhoenix(): void {
  if (process.env.PHOENIX_ENABLED !== 'true') return;

  const g = globalThis as unknown as Record<string, boolean>;
  if (g[GLOBAL_FLAG]) return;
  g[GLOBAL_FLAG] = true;

  try {
    // Lazy requires so nothing is pulled into the bundle when Phoenix is off.
    const { NodeTracerProvider, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
    const { resourceFromAttributes } = require('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
    const { SEMRESATTRS_PROJECT_NAME } = require('@arizeai/openinference-semantic-conventions');

    const rawEndpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT ?? 'https://app.phoenix.arize.com';
    const base = rawEndpoint.replace(/\/+$/, '');
    const url = base.endsWith('/v1/traces') ? base : `${base}/v1/traces`;
    const projectName = process.env.PHOENIX_PROJECT_NAME ?? 'cfo-fitness';

    // Phoenix auth differs by deployment: hosted Cloud spaces expect
    // `authorization: Bearer <key>`, self-hosted/older builds use `api_key`.
    // Send both — servers ignore the header they don't check. PHOENIX_CLIENT_HEADERS
    // can still override/extend if a space needs something bespoke.
    const headers: Record<string, string> = {};
    if (process.env.PHOENIX_API_KEY) {
      headers['api_key'] = process.env.PHOENIX_API_KEY;
      headers['authorization'] = `Bearer ${process.env.PHOENIX_API_KEY}`;
    }
    if (process.env.PHOENIX_CLIENT_HEADERS) {
      for (const pair of process.env.PHOENIX_CLIENT_HEADERS.split(',')) {
        const idx = pair.indexOf('=');
        if (idx > 0) headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      }
    }

    const exporter = new OTLPTraceExporter({ url, headers });
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: projectName,
        [SEMRESATTRS_PROJECT_NAME]: projectName,
      }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });
    provider.register();
    activeProvider = provider;

    // eslint-disable-next-line no-console
    console.log(`[phoenix] tracing enabled → ${url} (project: ${projectName})`);
  } catch (err) {
    // Never let observability wiring break the app.
    g[GLOBAL_FLAG] = false;
    // eslint-disable-next-line no-console
    console.error('[phoenix] failed to initialize tracing — continuing without it:', err);
  }
}

/**
 * Force-export any buffered spans. Useful for short-lived processes (e.g. the
 * eval harness) that would otherwise exit before the BatchSpanProcessor flushes.
 */
export async function flushPhoenixTraces(): Promise<void> {
  if (activeProvider && typeof activeProvider.forceFlush === 'function') {
    try {
      await activeProvider.forceFlush();
    } catch {
      /* best-effort */
    }
  }
}

setupPhoenix();

export {};
