import pino, { type DestinationStream } from 'pino';

export interface ErrorDetails {
  kind: 'exchange' | 'telegram' | 'network' | 'database' | 'unknown';
  code: string;
  status?: number;
}

/** Only known codes are logged; raw errors can contain tokens, SQL and financial data. */
function classifyError(error: unknown): ErrorDetails {
  if (!error || typeof error !== 'object') return { kind: 'unknown', code: 'unknown' };
  const value = error as Record<string, unknown>;
  if (value.name === 'ExchangeRateError' && typeof value.code === 'string') {
    const codes = [
      'network',
      'timeout',
      'http',
      'invalid-key',
      'inactive-account',
      'quota-reached',
      'unsupported-code',
      'malformed-request',
      'api-error',
      'invalid-response',
    ];
    if (codes.includes(value.code))
      return {
        kind: 'exchange',
        code: value.code,
        ...(typeof value.status === 'number' ? { status: value.status } : {}),
      };
  }
  if (typeof value.error_code === 'number') {
    const description = typeof value.description === 'string' ? value.description : '';
    const reason = description.includes('message is not modified')
      ? 'not-modified'
      : description.includes('message to delete not found')
        ? 'already-deleted'
        : description.includes('query is too old')
          ? 'callback-expired'
          : 'api-error';
    return { kind: 'telegram', code: reason, status: value.error_code };
  }
  const code = value.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return { kind: 'database', code };
  if (
    typeof code === 'string' &&
    ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPERM'].includes(code)
  )
    return { kind: 'network', code };
  if (value.name === 'HttpError') return { kind: 'network', code: 'telegram-network' };
  return { kind: 'unknown', code: 'unknown' };
}

/** Inspect nested causes and AggregateError members without exposing error text. */
export function safeError(error: unknown): ErrorDetails {
  const pending: { value: unknown; depth: number }[] = [{ value: error, depth: 0 }];
  const seen = new Set<object>();
  let fallback = 'unknown';
  for (let index = 0; index < pending.length && index < 32; index++) {
    const item = pending[index]!;
    if (!item.value || typeof item.value !== 'object' || seen.has(item.value)) continue;
    seen.add(item.value);
    const result = classifyError(item.value);
    if (result.kind !== 'unknown') return result;
    const value = item.value as Record<string, unknown>;
    const names: Record<string, string> = {
      TypeError: 'type-error',
      ReferenceError: 'reference-error',
      RangeError: 'range-error',
    };
    if (typeof value.name === 'string' && names[value.name] && fallback === 'unknown')
      fallback = names[value.name]!;
    if (item.depth >= 8) continue;
    if (value.cause) pending.push({ value: value.cause, depth: item.depth + 1 });
    if (Array.isArray(value.errors))
      for (const nested of value.errors.slice(0, 8))
        pending.push({ value: nested, depth: item.depth + 1 });
  }
  return { kind: 'unknown', code: fallback };
}

export function createLogger(destination?: DestinationStream) {
  const level = process.env.LOG_LEVEL ?? 'info';
  const options: pino.LoggerOptions = {
    level: ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'].includes(level)
      ? level
      : 'info',
    base: { service: 'ucheter-tg-bot' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    serializers: { err: safeError },
    redact: {
      paths: [
        'token',
        'apiKey',
        'password',
        'DATABASE_URL',
        'TG_BOT_TOKEN',
        'EXCHANGE_API_KEY',
        'amount',
        'comment',
        'text',
        'err.message',
        'err.stack',
        'err.query',
        'err.parameters',
      ],
      censor: '[REDACTED]',
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();
