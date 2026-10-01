import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from '../src/db/index.js';
import { createTransaction, updateTransaction } from '../src/lib/services/transactions.js';
import { getRatesForDate, pinPendingRates } from '../src/lib/services/exchange.js';
import { PgDialect } from 'drizzle-orm/pg-core';

const rates = { USD: 1, EUR: 0.9, RSD: 108, RUB: 90 };
function mockReads(results: unknown[][]) {
  const select = db.select;
  let calls = 0;
  const query = {
    from: () => query,
    where: () => query,
    orderBy: () => query,
    limit: async () => results[calls++] ?? [],
  };
  db.select = (() => query) as unknown as typeof db.select;
  return () => {
    db.select = select;
  };
}

test('prefers a historical snapshot and falls back to earliest known snapshot', async () => {
  const past = { rateAt: new Date('2026-10-01'), nextUpdateAt: new Date('2026-10-02'), rates };
  let restore = mockReads([[past]]);
  try {
    assert.equal(await getRatesForDate(new Date('2026-10-01T12:00:00Z')), past);
  } finally {
    restore();
  }
  restore = mockReads([[], [past]]);
  try {
    assert.equal(await getRatesForDate(new Date('2020-01-01')), past);
  } finally {
    restore();
  }
  restore = mockReads([[], []]);
  try {
    assert.equal(await getRatesForDate(new Date()), undefined);
  } finally {
    restore();
  }
});

test('creation pins snapshot and explicitly marks stale rates as approximate', async () => {
  const snapshot = { rateAt: new Date('2020-01-01'), nextUpdateAt: new Date('2020-01-02'), rates };
  const restore = mockReads([[snapshot]]);
  const original = db.insert;
  let values: Record<string, unknown> = {};
  db.insert = (() => ({
    values: (input: Record<string, unknown>) => {
      values = input;
      return { returning: async () => [input] };
    },
  })) as unknown as typeof db.insert;
  try {
    await createTransaction({
      userId: '42',
      categoryId: 1,
      type: 'expense',
      currency: 'RSD',
      amount: 1080,
    });
    assert.equal(values.rateAt, snapshot.rateAt);
    assert.equal(values.rateEstimated, true);
    assert.equal(values.amount, '1080.00');
  } finally {
    restore();
    db.insert = original;
  }
});

test('editing amount and currency preserves original pinned rate and operation date', async () => {
  const select = db.select;
  const update = db.update;
  const query = { from: () => query, where: async () => [{ id: 1 }] };
  db.select = (() => query) as unknown as typeof db.select;
  let values: Record<string, unknown> = {};
  db.update = (() => ({
    set: (input: Record<string, unknown>) => {
      values = input;
      return { where: () => ({ returning: async () => [input] }) };
    },
  })) as unknown as typeof db.update;
  try {
    await updateTransaction('42', 1, {
      categoryId: 1,
      amount: 250,
      currency: 'USD',
      type: 'expense',
    });
    assert.equal(values.currency, 'USD');
    assert.equal(values.amount, '250.00');
    for (const field of ['rateAt', 'rateEstimated', 'createdAt']) assert.ok(!(field in values));
  } finally {
    db.select = select;
    db.update = update;
  }
});

test('backfill SQL only updates unpinned operations, even if run again', async () => {
  const original = db.execute;
  db.execute = (async (query: Parameters<typeof db.execute>[0]) => {
    const sql = new PgDialect().sqlToQuery(query as import('drizzle-orm').SQL).sql;
    assert.ok(sql.includes('WHERE t.rate_at IS NULL'));
    assert.ok(sql.includes('AND t.rate_at IS NULL'));
    assert.ok(sql.includes('rate_at <= t.created_at'));
    return { rowCount: 0 };
  }) as unknown as typeof db.execute;
  try {
    await pinPendingRates();
    await pinPendingRates();
  } finally {
    db.execute = original;
  }
});
