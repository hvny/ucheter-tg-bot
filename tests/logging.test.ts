import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from 'grammy';
import { createLogger, safeError } from '../src/lib/logging/logger.js';
import { updateKind } from '../src/bot/logging.js';
import { fetchRateSnapshot } from '../src/lib/utils/exchange.js';

function capture() {
  let output = '';
  const log = createLogger({
    write: (chunk: string) => {
      output += chunk;
    },
  });
  return { log, output: () => output };
}

test('structured logs have timestamp, level, event and update id', () => {
  const { log, output } = capture();
  log.info(
    { event: 'bot.update.completed', updateId: 123, durationMs: 10 },
    'Обновление обработано',
  );
  const entry = JSON.parse(output());
  assert.equal(entry.level, 'info');
  assert.equal(entry.event, 'bot.update.completed');
  assert.equal(entry.updateId, 123);
  assert.equal(entry.durationMs, 10);
  assert.ok(Number.isFinite(Date.parse(entry.time)));
});

test('error serializer and redaction omit credentials and financial data', () => {
  const { log, output } = capture();
  const err = Object.assign(new Error('token-secret amount-secret comment-secret'), {
    code: '23505',
    detail: 'comment-secret',
    query: 'amount-secret',
    parameters: ['token-secret'],
  });
  log.error(
    {
      event: 'database.failed',
      err,
      token: 'token-secret',
      amount: 'amount-secret',
      comment: 'comment-secret',
    },
    'Сбой БД',
  );
  for (const secret of ['token-secret', 'amount-secret', 'comment-secret'])
    assert.ok(!output().includes(secret));
  assert.deepEqual(JSON.parse(output()).err, { kind: 'database', code: '23505' });
});

test('Telegram errors are classified without logging descriptions or request payloads', () => {
  assert.deepEqual(
    safeError({
      error_code: 400,
      description: 'Bad Request: message is not modified: secret',
      payload: { text: 'secret' },
    }),
    { kind: 'telegram', code: 'not-modified', status: 400 },
  );
  assert.deepEqual(safeError({ cause: { code: 'ECONNREFUSED', message: 'secret' } }), {
    kind: 'network',
    code: 'ECONNREFUSED',
  });
});

test('API key errors and quota failures have distinct safe codes', async () => {
  for (const code of ['invalid-key', 'quota-reached', 'inactive-account']) {
    await assert.rejects(
      fetchRateSnapshot(
        'secret',
        async () => new Response(JSON.stringify({ result: 'error', 'error-type': code })),
      ),
      (error) => {
        assert.deepEqual(safeError(error), { kind: 'exchange', code });
        return true;
      },
    );
  }
});

test('update metadata never includes messages, arguments or callback payloads', () => {
  for (const [ctx, action] of [
    [{ message: { text: '/add confidential-comment' } }, 'command.add'],
    [{ message: { text: '99000 secret' } }, 'message'],
    [{ callbackQuery: { data: 'secret' } }, 'callback'],
  ] as const)
    assert.equal(updateKind(ctx as unknown as Context), action);
});

test('nested database and AggregateError connection failures retain safe codes', () => {
  const databaseError = Object.assign(new Error('secret database query'), { code: '42703' });
  assert.deepEqual(
    safeError(new Error('secret', { cause: new Error('secret', { cause: databaseError }) })),
    { kind: 'database', code: '42703' },
  );
  const networkError = Object.assign(new Error('secret host'), { code: 'ECONNREFUSED' });
  const aggregate = new AggregateError([networkError], 'secret address');
  const wrapped = new Error('secret SQL', { cause: aggregate });
  assert.deepEqual(safeError(wrapped), { kind: 'network', code: 'ECONNREFUSED' });
  const { log, output } = capture();
  log.error({ event: 'test.failure', err: wrapped }, 'Failure');
  assert.ok(!output().includes('secret'));
  assert.equal(JSON.parse(output()).err.code, 'ECONNREFUSED');
  const cyclic: { cause?: unknown } = {};
  cyclic.cause = cyclic;
  assert.deepEqual(safeError(cyclic), { kind: 'unknown', code: 'unknown' });
  assert.deepEqual(safeError(new TypeError('secret')), { kind: 'unknown', code: 'type-error' });
});
