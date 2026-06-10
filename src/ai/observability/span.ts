/**
 * @fileOverview Helper to record a custom reasoning span around deterministic
 * logic (e.g. the VF scoring engine) so it shows up in the Phoenix trace right
 * next to the model's tool calls.
 *
 * Uses only the @opentelemetry/api surface, which resolves to a no-op tracer
 * when no provider is registered (Phoenix disabled) — so this is always safe to
 * call and adds no overhead when tracing is off.
 */
import { trace, SpanStatusCode, type Attributes } from '@opentelemetry/api';

const tracer = trace.getTracer('cfo-fitness');

/** Coerce arbitrary values into OTEL-attribute-safe primitives. */
function toAttrs(prefix: string, obj: Record<string, unknown>): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === 'object') out[`${prefix}.${k}`] = JSON.stringify(v);
    else out[`${prefix}.${k}`] = v as string | number | boolean;
  }
  return out;
}

/**
 * Run `fn` inside a span named `name`, attaching `input` attributes up front and
 * the resolved value as an `output` attribute. Errors are recorded on the span.
 */
export async function recordReasoningSpan<T>(
  name: string,
  input: Record<string, unknown>,
  fn: () => Promise<T> | T,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      span.setAttributes(toAttrs('input', input));
      const result = await fn();
      span.setAttributes(toAttrs('output', { value: result }));
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
