import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { deleteTransaction } from '../src/lib/services/transactions.js';

for (const found of [true, false]) {
  test(`deletion checks both user and operation id (${found ? 'found' : 'missing'})`, async () => {
    const original = db.delete;
    db.delete = (() => ({
      where: (condition: SQL) => {
        const query = new PgDialect().sqlToQuery(condition);
        assert.deepEqual(query.params, ['42', 7]);
        assert.ok(query.sql.includes('"user_id"'));
        assert.ok(query.sql.includes('"id"'));
        return { returning: async () => (found ? [{ id: 7 }] : []) };
      },
    })) as unknown as typeof db.delete;
    try {
      assert.equal(await deleteTransaction('42', 7), found);
    } finally {
      db.delete = original;
    }
  });
}
