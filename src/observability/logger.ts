/**
 * Logger estructurado (JSON de una linea) con correlacion de trazas y saneo de PII.
 *
 * Por que:
 * - En Vercel, los console.* se capturan y pueden enviarse a Grafana Loki via Vercel Drains.
 *   Un JSON de una sola linea es consultable y correlacionable; texto libre no.
 * - Inyecta trace_id / span_id de la traza activa (si OTel esta encendido) para saltar
 *   desde una traza en Tempo a sus logs en Loki y viceversa.
 *
 * REGLA DE ORO ANTI-PII (sistema de votaciones):
 * - Nunca registrar el voto emitido, tokens de voto, token_hash, id_tokens de Microsoft,
 *   correos completos ni carnet. El saneo redacta automaticamente claves sensibles.
 */

import { trace } from '@opentelemetry/api';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogFields = Record<string, unknown>;

// Claves cuyo valor se redacta siempre (defensa en profundidad contra fugas de PII/secretos).
const SENSITIVE_KEY = /(token|secret|password|authorization|auth|cookie|jwt|carnet|email|correo|token_hash|id_token|access_token|apikey|api_key|body|payload|details|stack)/i;

const MAX_DEPTH = 4;

const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;
const LONG_SECRET_VALUE = /\b(?:[a-f0-9]{32,}|[A-Za-z0-9_-]{40,})\b/gi;
const CARNET_VALUE = /\b\d{8,12}\b/g;

export function sanitizeUrlPath(value: string): string {
  return value.split(/[?#]/, 1)[0] || '/';
}

function redactString(value: string): string {
  return value
    .replace(EMAIL_VALUE, '[REDACTED_EMAIL]')
    .replace(JWT_VALUE, '[REDACTED_TOKEN]')
    .replace(BEARER_VALUE, 'Bearer [REDACTED]')
    .replace(LONG_SECRET_VALUE, '[REDACTED_SECRET]')
    .replace(CARNET_VALUE, '[REDACTED_CARNET]');
}

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return '[TRUNCATED]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactLogValue(val, depth + 1);
  }
  return out;
}

function activeTraceIds(): { trace_id?: string; span_id?: string } {
  const span = trace.getActiveSpan();
  if (!span) {
    return {};
  }
  const ctx = span.spanContext();
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    msg: redactString(msg),
    ...activeTraceIds(),
    ...(fields ? (redactLogValue(fields) as LogFields) : {}),
  };
  const line = JSON.stringify(record);
  // eslint-disable-next-line no-console
  if (level === 'error') console.error(line);
  // eslint-disable-next-line no-console
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
};
