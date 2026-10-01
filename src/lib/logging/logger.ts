import pino, { type DestinationStream } from 'pino';

export interface ErrorDetails {
  kind: 'exchange' | 'telegram' | 'network' | 'database' | 'unknown';
  code: string;
  status?: number;
}

/** Only known codes are logged; raw errors can contain tokens, SQL and financial data. */
export function safeError(error: unknown): ErrorDetails {
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
  // Drizzle wraps the pg error. Only inspect the cause for a safe, known code.
  if (value.cause && value.cause !== error) {
    const cause = value.cause as Record<string, unknown>;
    if (typeof cause.code === 'string' && /^[0-9A-Z]{5}$/.test(cause.code))
      return { kind: 'database', code: cause.code };
    if (
      typeof cause.code === 'string' &&
      ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT'].includes(cause.code)
    )
      return { kind: 'network', code: cause.code };
  }
  return { kind: 'unknown', code: 'unknown' };
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
