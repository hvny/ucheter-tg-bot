import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { categories, type Category } from '../src/db/schema.js';
import { DEFAULT_CATEGORIES } from '../src/lib/constants/index.js';
import { withLanguage } from '../src/lib/i18n/index.js';
import { identifyDefaultCategories } from '../src/lib/services/default-categories.js';
import {
  getActiveCategories,
  getCategoryById,
  createCategory,
} from '../src/lib/services/categories.js';
import {
  listTransactions,
  listAllTransactions,
  getCategoryBreakdown,
  getConvertedStats,
} from '../src/lib/services/transactions.js';

function defaults(language: 'ru' | 'en'): Category[] {
  let id = 100;
  return withLanguage(language, () =>
    (['expense', 'income'] as const).flatMap((type) =>
      DEFAULT_CATEGORIES[type].map((name) => ({
        id: ++id,
        userId: '42',
        type,
        name,
        isArchived: false,
      })),
    ),
  );
}
test('initial seed identity survives archiving and recognizes both languages, excluding custom lookalikes', () => {
  for (const language of ['ru', 'en'] as const) {
    const seed = defaults(language);
    seed[0]!.isArchived = true;
    assert.equal(identifyDefaultCategories(seed).size, 12);
    const extra = { ...seed[0]!, id: 999 };
    assert.equal(identifyDefaultCategories(seed).has(extra.id), false);
    assert.equal(identifyDefaultCategories(seed.slice(0, 11)).size, 0);
    seed[0]!.name = 'My groceries';
    assert.equal(identifyDefaultCategories(seed).size, 0);
  }
});

test('category selectors, history, export and stats translate seeded categories without altering stored names', async (t) => {
  const seed = defaults('ru');
  const custom = { ...seed[0]!, id: 999, name: 'Продукты' };
  const stored = [...seed, custom];
  const dialect = new PgDialect();
  t.mock.method(db, 'select', (fields?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      let rows: unknown[] =
        table === categories
          ? stored
          : fields && 'count' in fields && !('rates' in fields)
            ? [{ count: 2 }]
            : [
                {
                  id: 1,
                  userId: '42',
                  categoryId: 101,
                  categoryName: 'Продукты',
                  type: 'expense',
                  currency: 'RUB',
                  amount: '10',
                  total: 10,
                  count: 1,
                  rates: null,
                  rateEstimated: false,
                },
                {
                  id: 2,
                  userId: '42',
                  categoryId: 999,
                  categoryName: 'Продукты',
                  type: 'expense',
                  currency: 'RUB',
                  amount: '20',
                  total: 20,
                  count: 1,
                  rates: null,
                  rateEstimated: false,
                },
              ];
      const query = {
        leftJoin: () => query,
        where: (condition: SQL) => {
          const params = dialect.sqlToQuery(condition).params;
          assert.ok(params.includes('42'));
          if (table === categories && params[0] === 101) rows = [seed[0]!];
          return query;
        },
        orderBy: () => query,
        groupBy: () => query,
        limit: (limit: number) => {
          rows = rows.slice(0, limit);
          return query;
        },
        offset: () => query,
        then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return query;
    },
  }));
  await withLanguage('en', async () => {
    const active = await getActiveCategories('42');
    assert.equal(active[0]?.name, 'Groceries');
    assert.equal(active.at(-1)?.name, 'Продукты');
    assert.equal((await getCategoryById('42', 101))?.name, 'Groceries');
    assert.equal((await createCategory('42', 'Groceries', 'expense')).id, 101);
    const history = await listTransactions('42', {}, { limit: 5, offset: 0 });
    assert.deepEqual(
      history.items.map((item) => item.categoryName),
      ['Groceries', 'Продукты'],
    );
    assert.deepEqual(
      (await listAllTransactions('42', {})).map((item) => item.categoryName),
      ['Groceries', 'Продукты'],
    );
    assert.deepEqual(
      (await getCategoryBreakdown('42', 'expense')).map((item) => item.categoryName),
      ['Groceries', 'Продукты'],
    );
    assert.deepEqual(
      (await getConvertedStats('42', 'expense', 'RUB')).breakdown.map((item) => item.categoryName),
      ['Продукты', 'Groceries'],
    );
  });
  assert.equal(stored[0]?.name, 'Продукты');
  const english = defaults('en');
  await withLanguage('ru', () => {
    const keys = identifyDefaultCategories(english);
    assert.equal(keys.get(101), 'index-message-1');
  });
});
