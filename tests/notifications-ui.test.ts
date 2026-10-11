import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { createBot } from '../src/bot/bot.js';
import type { Update } from 'grammy/types';
import { TIME_ZONES } from '../src/lib/utils/time-zone.js';

test('notification UI selects timezone, enables, disables from a photo and rejects group settings', async (t) => {
  const user = {
    id: '42',
    username: 'tester',
    language: 'en',
    timeZone: null as string | null,
    dailyNotifications: false,
    notificationTime: 1200,
  };
  t.mock.method(db, 'select', () => ({
    from: () => ({
      where: () =>
        Object.assign(Promise.resolve([user]), {
          limit: async () => [user],
        }),
    }),
  }));
  t.mock.method(db, 'update', () => ({
    set: (values: unknown) => ({
      where: (condition: SQL) => {
        assert.deepEqual(new PgDialect().sqlToQuery(condition).params, ['42']);
        Object.assign(user, values);
        return Promise.resolve();
      },
    }),
  }));
  const bot = createBot('test-token');
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Test',
    username: 'testbot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  const calls: { method: string; payload: Record<string, any> }[] = [];
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload });
    return {
      ok: true,
      result:
        method === 'answerCallbackQuery'
          ? true
          : {
              message_id: 1,
              date: 0,
              chat: { id: 42, type: 'private' },
              text: 'text' in payload ? payload.text : '',
            },
    } as never;
  });
  // Conversations create their own Api instance using the outer client's options.
  Object.defineProperty(bot, 'clientConfig', {
    value: {
      fetch: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 2,
              date: 0,
              chat: { id: 42, type: 'private' },
              text: 'Choose type',
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    },
  });
  const from = { id: 42, is_bot: false, first_name: 'Tester', username: 'tester' };
  let id = 0;
  async function callback(data: string, photo = false, group = false) {
    await bot.handleUpdate({
      update_id: ++id,
      callback_query: {
        id: String(id),
        from,
        chat_instance: 'chat',
        data,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: group ? -100 : 42, type: group ? 'group' : 'private' },
          ...(photo
            ? { photo: [{ file_id: 'file', file_unique_id: 'file', width: 10, height: 10 }] }
            : { text: 'Settings' }),
        },
      },
    } as Update);
  }
  await callback('menu:notifications');
  assert.ok(calls.at(-1)?.payload.text.includes('off'));
  await callback('daily:on');
  assert.ok(calls.at(-1)?.payload.text.includes('Choose your time zone'));
  assert.equal(user.dailyNotifications, false);
  const keyboard = calls.at(-1)?.payload.reply_markup;
  assert.ok(
    keyboard.inline_keyboard
      .flat()
      .some((b: any) => b.callback_data === 'notifications:zone:Europe/Belgrade'),
  );
  await callback('notifications:zones:1');
  assert.ok(calls.at(-1)?.payload.text.includes('2/'));
  await callback('notifications:zone:Europe/Belgrade');
  assert.equal(user.timeZone, 'Europe/Belgrade');
  assert.equal(user.dailyNotifications, true);
  assert.ok(calls.at(-1)?.payload.text.includes('20:00'));
  await callback('notifications:time');
  assert.ok(calls.at(-1)?.payload.text.includes('delivery hour'));
  assert.equal(user.notificationTime, 1200);
  await callback('notifications:minutes:22:1');
  assert.ok(
    calls
      .at(-1)
      ?.payload.reply_markup.inline_keyboard.flat()
      .some((b: any) => b.callback_data === 'notifications:time:22:35'),
  );
  await callback('notifications:settings');
  assert.equal(user.notificationTime, 1200); // Back does not save an incomplete selection.
  await callback('notifications:time:22:35');
  assert.equal(user.notificationTime, 1355);
  assert.ok(calls.at(-1)?.payload.text.includes('22:35'));
  await callback('notifications:time:24:00');
  assert.equal(user.notificationTime, 1355);
  await callback('daily:off', true);
  assert.equal(user.dailyNotifications, false);
  assert.equal(calls.at(-1)?.method, 'sendMessage');
  assert.ok(calls.at(-1)?.payload.text.includes('off'));
  await callback('notifications:time:07:05');
  assert.equal(user.notificationTime, 425);
  assert.equal(user.dailyNotifications, false);
  await callback('daily:on');
  assert.equal(user.dailyNotifications, true);
  await callback('notifications:zone:Invalid/Zone');
  assert.equal(user.timeZone, 'Europe/Belgrade');
  assert.ok(calls.at(-1)?.payload.text.includes('outdated'));
  await bot.handleUpdate({
    update_id: ++id,
    message: {
      message_id: id,
      date: 0,
      from,
      chat: { id: 42, type: 'private' },
      text: '/add',
      entities: [{ type: 'bot_command', offset: 0, length: 4 }],
    },
  });
  await callback('daily:off', true);
  assert.equal(user.dailyNotifications, false);
  await callback('daily:on');
  assert.equal(user.dailyNotifications, true);
  await callback('daily:off', false, true);
  assert.equal(user.dailyNotifications, true);
  assert.ok(calls.at(-1)?.payload.text.includes('private chat'));
});

test('timezone callback data fits Telegram 64-byte limit', () => {
  for (const zone of TIME_ZONES)
    assert.ok(Buffer.byteLength(`notifications:zone:${zone}`) <= 64, zone);
});
