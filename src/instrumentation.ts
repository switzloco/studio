/**
 * Next.js instrumentation hook — runs once at server startup, before any
 * route/server-action code. We use it to register Arize Phoenix tracing so
 * Genkit's spans are exported from the very first request.
 *
 * No-op unless PHOENIX_ENABLED=true (see src/ai/observability/phoenix.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@/ai/observability/phoenix');
  }
}
