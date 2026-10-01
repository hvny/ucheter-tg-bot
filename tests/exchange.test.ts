import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertAmount, fetchRateSnapshot, parseRateSnapshot } from '../src/lib/utils/exchange.js';
import { db } from '../src/db/index.js';
import { getConvertedStats } from '../src/lib/services/transactions.js';

const rates = { USD: 1, EUR: 0.9, RSD: 108, RUB: 90 };
const payload = {
  result: 'success',
  base_code: 'USD',
  conversion_rates: rates,
  time_last_update_unix: 1_700_000_000,
  time_next_update_unix: 1_700_086_400,
};

test('cross conversion supports every pair and leaves original amount intact', () => {
  assert.equal(convertAmount(1080, 'RSD', 'EUR', rates), 9);
  assert.equal(convertAmount(90, 'RUB', 'USD', rates), 1);
  for (const source of ['USD', 'EUR', 'RSD', 'RUB'] as const) {
    assert.equal(convertAmount(10, source, source, rates), 10);
    for (const target of ['USD', 'EUR', 'RSD', 'RUB'] as const) {
      const result = convertAmount(convertAmount(10, source, target, rates), target, source, rates);
      assert.ok(Math.abs(result - 10) < 1e-10);
    }
  }
});

test('snapshot must contain all four positive finite rates and valid dates', () => {
  assert.deepEqual(parseRateSnapshot(payload).rates, rates);
  for (const rate of [undefined, 0, -1, NaN, Infinity, '108']) {
    assert.throws(() =>
      parseRateSnapshot({ ...payload, conversion_rates: { ...rates, RSD: rate } }),
    );
  }
  assert.throws(() => parseRateSnapshot({ ...payload, result: 'error' }));
  assert.throws(() => parseRateSnapshot({ ...payload, base_code: 'EUR' }));
  assert.throws(() => parseRateSnapshot({ ...payload, time_next_update_unix: 0 }));
});

test('fetch uses authenticated endpoint and validates the response', async () => {
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://v6.exchangerate-api.com/v6/test-key/latest/USD');
    assert.ok(options?.signal);
    return new Response(JSON.stringify(payload));
  };
  assert.deepEqual((await fetchRateSnapshot('test-key', request)).rates, rates);
});

test('network and HTTP failures do not expose API key', async () => {
  await assert.rejects(
    fetchRateSnapshot('secret', async () => {
      throw new Error('url/secret');
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes('secret'));
      return true;
    },
  );
  await assert.rejects(
    fetchRateSnapshot('secret', async () => new Response('', { status: 429 })),
    /HTTP 429/,
  );
  await assert.rejects(
    fetchRateSnapshot('secret', async () => new Response('{')),
    /JSON/,
  );
});

test('converted totals combine currencies while keeping income and expense separate', async () => {
  const original = db.select;
  const rows = [
    {
      categoryId: 1,
      categoryName: 'Еда',
      type: 'expense',
      currency: 'RSD',
      total: 1080,
      rates,
      rateEstimated: false,
      count: 1,
    },
    {
      categoryId: 1,
      categoryName: 'Еда',
      type: 'expense',
      currency: 'EUR',
      total: 1,
      rates,
      rateEstimated: false,
      count: 1,
    },
    {
      categoryId: 2,
      categoryName: 'Зарплата',
      type: 'income',
      currency: 'USD',
      total: 100,
      rates,
      rateEstimated: false,
      count: 1,
    },
  ];
  const query = {
    from: () => query,
    leftJoin: () => query,
    where: () => query,
    groupBy: async () => rows,
  };
  db.select = (() => query) as unknown as typeof db.select;
  try {
    const result = await getConvertedStats('42', 'expense', 'EUR');
    assert.deepEqual(result.summary, { income: 90, expense: 10 });
    assert.deepEqual(result.breakdown, [{ categoryId: 1, categoryName: 'Еда', total: 10 }]);
  } finally {
    db.select = original;
  }
});

test('different pinned rates remain separate and future rate refresh does not change totals', async () => {
  const original = db.select;
  const oldRates = { ...rates };
  const rows = [
    {
      categoryId: 1,
      categoryName: 'Еда',
      type: 'expense',
      currency: 'RSD',
      total: 1080,
      rates: oldRates,
      rateEstimated: false,
      count: 1,
    },
    {
      categoryId: 1,
      categoryName: 'Еда',
      type: 'expense',
      currency: 'RSD',
      total: 1080,
      rates: { ...rates, EUR: 1.8 },
      rateEstimated: false,
      count: 1,
    },
  ];
  const query = {
    from: () => query,
    leftJoin: () => query,
    where: () => query,
    groupBy: async (...columns: unknown[]) => {
      assert.ok(
        columns.some((c) => c && typeof c === 'object' && 'name' in c && c.name === 'rate_at'),
      );
      return rows;
    },
  };
  db.select = (() => query) as unknown as typeof db.select;
  try {
    const before = await getConvertedStats('42', 'expense', 'EUR');
    assert.equal(before.summary.expense, 27);
    const latestRates = { ...rates, EUR: 3.6 };
    assert.equal(convertAmount(1080, 'RSD', 'EUR', latestRates), 36);
    assert.deepEqual(await getConvertedStats('42', 'expense', 'EUR'), before);
    assert.equal((await getConvertedStats('42', 'expense', 'USD')).summary.expense, 20);
  } finally {
    db.select = original;
  }
});

test('missing rates are counted and identity conversions still work', async () => {
  const original = db.select;
  const rows = [
    {
      categoryId: 1,
      categoryName: 'Еда',
      type: 'expense',
      currency: 'RSD',
      total: 100,
      rates: null,
      rateEstimated: false,
      count: 2,
    },
    {
      categoryId: 2,
      categoryName: 'Кафе',
      type: 'expense',
      currency: 'EUR',
      total: 5,
      rates: null,
      rateEstimated: false,
      count: 1,
    },
    {
      categoryId: 1,
      categoryName: 'Еда',
      type: 'expense',
      currency: 'USD',
      total: 10,
      rates,
      rateEstimated: true,
      count: 3,
    },
  ];
  const query = {
    from: () => query,
    leftJoin: () => query,
    where: () => query,
    groupBy: async () => rows,
  };
  db.select = (() => query) as unknown as typeof db.select;
  try {
    const result = await getConvertedStats('42', 'expense', 'EUR');
    assert.equal(result.missingRates, 2);
    assert.equal(result.estimatedRates, 3);
    assert.equal(result.summary.expense, 14);
  } finally {
    db.select = original;
  }
});
