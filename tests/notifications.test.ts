import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { GrammyError, type Api } from 'grammy';
import { db } from '../src/db/index.js';
import { users, dailyDeliveries, type User } from '../src/db/schema.js';
import { dailyIsDue, localClock, localDayWindow } from '../src/lib/utils/time-zone.js';
import {
  claimDailyDelivery,
  getDailyDelivery,
  renderDailySummary,
  runDailyNotifications,
  setNotifications,
  setNotificationTime,
} from '../src/lib/services/notifications.js';
import { renderStats, DEFAULT_STATS_STATE } from '../src/bot/commands/stats.js';
import { withLanguage } from '../src/lib/i18n/index.js';

const dialect = new PgDialect();
const user: User = {
  id: '42',
  username: null,
  language: 'en',
  preferredCurrency: 'RSD',
  timeZone: 'Europe/Belgrade',
  notificationTime: 1200,
  dailyNotifications: true,
  createdAt: new Date(0),
};
function query(rows: unknown[]) {
  const result = Object.assign(Promise.resolve(rows), {
    limit: async () => rows,
    groupBy: () => result,
    orderBy: () => result,
    leftJoin: () => result,
    where: () => result,
  });
  return result;
}

test('local days and 20:00 respect DST and fractional offsets', () => {
  for (const [date, zone, start, end] of [
    ['2026-10-11', 'Europe/Belgrade', '2026-10-10T22:00:00Z', '2026-10-11T22:00:00Z'],
    ['2026-03-29', 'Europe/Belgrade', '2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z'],
    ['2026-10-25', 'Europe/Belgrade', '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z'],
    ['2026-10-11', 'Asia/Kathmandu', '2026-10-10T18:15:00Z', '2026-10-11T18:15:00Z'],
  ]) {
    const window = localDayWindow(date!, zone!);
    assert.equal(window.from.toISOString(), new Date(start!).toISOString());
    assert.equal(window.to.toISOString(), new Date(end!).toISOString());
  }
  assert.equal(dailyIsDue(new Date('2026-10-11T17:59:59Z'), user.timeZone!), false);
  assert.equal(dailyIsDue(new Date('2026-10-11T18:00:00Z'), user.timeZone!), true);
  assert.equal(dailyIsDue(new Date('2026-12-11T18:00:00Z'), user.timeZone!), false);
  assert.equal(dailyIsDue(new Date('2026-12-11T19:00:00Z'), user.timeZone!), true);
  assert.equal(localClock(new Date('2026-10-11T22:00:00Z'), user.timeZone!).date, '2026-10-12');
  assert.throws(() => localDayWindow('2026-02-30', 'UTC'));
  assert.throws(() => localDayWindow('2026-10-11', 'Invalid/Zone'));
});

test('claim uses a persistent unique day, sent guard, lease expiry and bounded attempts', async (t) => {
  const now = new Date('2026-10-11T18:00:00Z');
  t.mock.method(db, 'insert', (table: unknown) => {
    assert.equal(table, dailyDeliveries);
    return {
      values: (values: Record<string, unknown>) => {
        assert.equal(values.userId, '42');
        assert.equal(values.localDate, '2026-10-11');
        assert.deepEqual(values.windowEnd, now);
        assert.equal(values.timeZone, 'Europe/Belgrade');
        return {
          onConflictDoUpdate: (options: { setWhere: SQL; target: unknown[] }) => {
            assert.deepEqual(options.target, [dailyDeliveries.userId, dailyDeliveries.localDate]);
            const sql = dialect.sqlToQuery(options.setWhere);
            assert.match(sql.sql, /sent_at.*IS NULL/);
            assert.match(sql.sql, /lease_until.*<=/);
            assert.match(sql.sql, /attempts.*< 3/);
            return { returning: async () => [] };
          },
        };
      },
    };
  });
  assert.equal(await claimDailyDelivery('42', '2026-10-11', now, user.timeZone!), undefined);
});

test('settings require a time zone and scope updates and details to the current user', async (t) => {
  t.mock.method(db, 'select', () => ({
    from: (table: unknown) => ({
      where: (condition: SQL) => {
        const sql = dialect.sqlToQuery(condition);
        assert.equal(sql.params[0], '42');
        if (table === dailyDeliveries) {
          assert.equal(sql.params[1], 7);
          return query([]);
        }
        return query([{ ...user, timeZone: null }]);
      },
    }),
  }));
  const updates: unknown[] = [];
  t.mock.method(db, 'update', () => ({
    set: (values: unknown) => ({
      where: (condition: SQL) => {
        assert.deepEqual(dialect.sqlToQuery(condition).params, ['42']);
        updates.push(values);
        return Promise.resolve();
      },
    }),
  }));
  await assert.rejects(setNotifications('42', true), /Missing time zone/);
  await assert.rejects(setNotifications('42', true, 'Invalid/Zone'));
  await setNotifications('42', true, 'Europe/Belgrade');
  await setNotifications('42', false);
  assert.deepEqual(updates, [
    { dailyNotifications: true, timeZone: 'Europe/Belgrade' },
    { dailyNotifications: false },
  ]);
  assert.equal(await getDailyDelivery('42', 7), undefined);
});

function statsMock(t: TestContext, rows: unknown[], queries: { sql: string; params: unknown[] }[]) {
  t.mock.method(db, 'select', () => ({
    from: () => {
      const result = query(rows);
      result.where = (condition?: unknown) => {
        queries.push(dialect.sqlToQuery(condition as SQL));
        return result;
      };
      return result;
    },
  }));
}

test('summary converts pinned rates, stays short, emits PNG, and bounds queries to the local day', async (t) => {
  const queries: { sql: string; params: unknown[] }[] = [];
  statsMock(
    t,
    [
      {
        categoryId: 1,
        categoryName: 'Food',
        type: 'expense',
        currency: 'USD',
        rates: { USD: 1, RSD: 100, EUR: 1, RUB: 90 },
        rateEstimated: false,
        count: 1,
        total: 10,
      },
      {
        categoryId: 2,
        categoryName: 'Salary',
        type: 'income',
        currency: 'RSD',
        rates: null,
        rateEstimated: false,
        count: 1,
        total: 2000,
      },
    ],
    queries,
  );
  const now = new Date('2026-10-11T18:00:00Z');
  const result = await withLanguage('en', () => renderDailySummary(user, now, 9));
  assert.equal(result.caption, '📊 Today · 2026-10-11\nIncome: 2,000 RSD\nExpenses: 1,000 RSD');
  assert.equal(result.photo.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(result.keyboard.inline_keyboard[0]?.[0]?.callback_data, 'daily:details:9');
  assert.equal(result.keyboard.inline_keyboard[1]?.[0]?.callback_data, 'daily:off');
  for (const sql of queries) {
    assert.match(sql.sql, /created_at.*>=/);
    assert.match(sql.sql, /created_at.*</);
    assert.deepEqual(sql.params, ['42', '2026-10-10T22:00:00.000Z', '2026-10-11T18:00:00.000Z']);
  }
});

test('zero-operation days still have a summary and graph; daily stats filters retain the day', async (t) => {
  const queries: { sql: string; params: unknown[] }[] = [];
  statsMock(t, [], queries);
  const now = new Date('2026-10-11T18:00:00Z');
  const result = await withLanguage('en', () => renderDailySummary(user, now, 9));
  assert.ok(result.caption.includes('Income: 0 RSD\nExpenses: 0 RSD'));
  assert.ok(result.photo.length > 100);
  const stats = await renderStats('42', DEFAULT_STATS_STATE, false, {
    from: new Date('2026-10-10T22:00:00Z'),
    to: now,
    label: 'Day',
    deliveryId: 9,
  });
  const buttons = stats.keyboard.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.callback_data === 'daily:details:9:income:RUB:all'));
  assert.ok(buttons.some((b) => b.callback_data === 'daily:details:9:expense:RSD:all'));
  assert.ok(buttons.some((b) => b.callback_data === 'daily:details:9:expense:RUB:one'));
  assert.ok(buttons.some((b) => b.callback_data === 'st:w:e:RUB:all'));
});

test('scheduler sends only due subscribers, isolates failures, disables blocked users and skips claimed days', async (t) => {
  const blocked = { ...user, id: '43' };
  const later = { ...user, id: '44', timeZone: 'America/New_York' };
  const sent = new Set<string>();
  const claimed = new Set<string>();
  const people = [blocked, user, later];
  t.mock.method(db, 'select', () => ({
    from: (table: unknown) => {
      const result = query([]);
      result.where = (condition?: unknown) => {
        if (table !== users) return query([]);
        const params = dialect.sqlToQuery(condition as SQL).params;
        return query(
          params[0] === true
            ? people.filter((u) => u.dailyNotifications)
            : people.filter((u) => u.id === params[0]),
        );
      };
      return result;
    },
  }));
  t.mock.method(db, 'insert', () => ({
    values: (values: { userId: string; windowEnd: Date; timeZone: string }) => ({
      onConflictDoUpdate: () => ({
        returning: async () => {
          if (claimed.has(values.userId)) return [];
          claimed.add(values.userId);
          return [
            { id: Number(values.userId), windowEnd: values.windowEnd, timeZone: values.timeZone },
          ];
        },
      }),
    }),
  }));
  t.mock.method(db, 'update', (table: unknown) => ({
    set: (values: { dailyNotifications?: boolean; sentAt?: Date }) => ({
      where: (condition: SQL) => {
        const id = dialect.sqlToQuery(condition).params[0] as string;
        if (table === users)
          people.find((u) => u.id === id)!.dailyNotifications = values.dailyNotifications!;
        else if (values.sentAt) sent.add(id);
        return Promise.resolve();
      },
    }),
  }));
  const deliveries: string[] = [];
  const api = {
    sendPhoto: async (id: string) => {
      deliveries.push(id);
      if (id === '43')
        throw new GrammyError(
          'blocked',
          { ok: false, error_code: 403, description: 'blocked' },
          'sendPhoto',
          {},
        );
    },
  } as unknown as Api;
  await runDailyNotifications(api, new Date('2026-10-11T17:59:00Z'));
  assert.deepEqual(deliveries, []);
  await runDailyNotifications(api, new Date('2026-10-11T18:00:00Z'));
  assert.deepEqual(deliveries, ['43', '42']);
  assert.equal(blocked.dailyNotifications, false);
  assert.deepEqual([...sent], ['42']);
  await runDailyNotifications(api, new Date('2026-10-11T18:01:00Z'));
  assert.deepEqual(deliveries, ['43', '42']);
});

test('missing exchange rates show original currency amounts without an incomplete combined total', async (t) => {
  t.mock.method(db, 'select', (selection: Record<string, unknown>) => ({
    from: () => {
      const converted = 'rates' in selection;
      const result = query(
        converted
          ? [
              {
                categoryId: 1,
                categoryName: 'Food',
                type: 'expense',
                currency: 'USD',
                rates: null,
                rateEstimated: false,
                count: 1,
                total: 10,
              },
            ]
          : [],
      );
      result.where = (condition?: unknown) => {
        if (converted) return result;
        const currency = dialect.sqlToQuery(condition as SQL).params[1];
        return query(currency === 'USD' ? [{ type: 'expense', total: 10 }] : []);
      };
      return result;
    },
  }));
  const result = await withLanguage('en', () =>
    renderDailySummary(user, new Date('2026-10-11T18:00:00Z'), 9),
  );
  assert.ok(result.caption.includes('Rates unavailable'));
  assert.ok(result.caption.includes('Expenses: 10 USD'));
  assert.ok(!result.caption.includes('RSD'));
  assert.ok(result.photo.length > 100);
});

test('custom notification times are minute precise and follow DST in the selected zone', () => {
  assert.equal(
    dailyIsDue(new Date('2026-10-11T20:34:59Z'), 'Europe/Belgrade', 22 * 60 + 35),
    false,
  );
  assert.equal(dailyIsDue(new Date('2026-10-11T20:35:00Z'), 'Europe/Belgrade', 22 * 60 + 35), true);
  assert.equal(dailyIsDue(new Date('2026-12-11T21:35:00Z'), 'Europe/Belgrade', 22 * 60 + 35), true);
  assert.equal(dailyIsDue(new Date('2026-10-11T13:34:59Z'), 'Asia/Kathmandu', 19 * 60 + 20), false);
  assert.equal(dailyIsDue(new Date('2026-10-11T13:35:00Z'), 'Asia/Kathmandu', 19 * 60 + 20), true);
  assert.equal(dailyIsDue(new Date('2026-03-29T01:00:00Z'), 'Europe/Belgrade', 150), true); // Skipped 02:30 catches up at 03:00.
  assert.equal(dailyIsDue(new Date('2026-10-25T00:30:00Z'), 'Europe/Belgrade', 150), true);
  assert.equal(dailyIsDue(new Date('2026-10-25T01:30:00Z'), 'Europe/Belgrade', 150), true); // Delivery day guard handles the repeated hour.
  assert.equal(dailyIsDue(new Date('2026-10-11T22:00:00Z'), 'Europe/Belgrade', 0), true);
  assert.equal(dailyIsDue(new Date(), 'UTC', 1440), false);
});

test('saving notification time validates the range, scopes the update and preserves opt-out', async (t) => {
  const updates: unknown[] = [];
  t.mock.method(db, 'update', () => ({
    set: (values: unknown) => ({
      where: (condition: SQL) => {
        assert.deepEqual(dialect.sqlToQuery(condition).params, ['42']);
        updates.push(values);
        return Promise.resolve();
      },
    }),
  }));
  for (const time of [-1, 1440, 1200.5, NaN]) await assert.rejects(setNotificationTime('42', time));
  await setNotificationTime('42', 425);
  assert.deepEqual(updates, [{ notificationTime: 425 }]);
});
