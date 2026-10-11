import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from '../src/db/index.js';
import { createBot } from '../src/bot/bot.js';
import type { Update } from 'grammy/types';

test('deep links and manual selection persist language across updates', async () => {
  const originalSelect = db.select;
  const originalUpdate = db.update;
  let language = 'ru';
  let timeZone: string | null = null;
  let dailyNotifications = false;
  const messages: string[] = [];
  db.select = (() => {
    const result = [{ id: '42', username: 'tester', language, timeZone, dailyNotifications }];
    return {
      from: () => ({
        where: () =>
          Object.assign(Promise.resolve(result), {
            limit: async () => result,
          }),
      }),
    };
  }) as unknown as typeof db.select;
  db.update = (() => ({
    set: (values: { language?: string; timeZone?: string; dailyNotifications?: boolean }) => ({
      where: async () => {
        if (values.language) language = values.language;
        if (values.timeZone) timeZone = values.timeZone;
        if (values.dailyNotifications !== undefined) dailyNotifications = values.dailyNotifications;
      },
    }),
  })) as unknown as typeof db.update;
  try {
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
    bot.api.config.use(async (_previous, method, payload) => {
      if ('text' in payload) messages.push(String(payload.text));
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
    let updateId = 0;
    const from = {
      id: 42,
      is_bot: false,
      first_name: 'Tester',
      username: 'tester',
      language_code: 'ru',
    };
    async function command(text: string) {
      await bot.handleUpdate({
        update_id: ++updateId,
        message: {
          message_id: updateId,
          date: 0,
          chat: { id: 42, type: 'private' },
          from,
          text,
          entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }],
        },
      });
    }
    await command('/start lang_en');
    assert.equal(language, 'en');
    assert.ok(messages.at(-1)?.includes('Welcome'));
    await command('/menu');
    assert.ok(messages.at(-1)?.includes('Menu'));
    await command('/start lang_de');
    assert.equal(language, 'en');
    await bot.handleUpdate({
      update_id: ++updateId,
      callback_query: {
        id: 'callback',
        from,
        chat_instance: 'chat',
        data: 'language:ru',
        message: { message_id: 1, date: 0, chat: { id: 42, type: 'private' } },
      },
    } as Update);
    assert.equal(language, 'ru');
    assert.ok(messages.at(-1)?.includes('Меню'));
    await command('/menu');
    assert.ok(messages.at(-1)?.includes('Меню'));
    const encodedZone = Buffer.from('Europe/Belgrade').toString('base64url');
    await command(`/start lang_en_tz_${encodedZone}`);
    assert.equal(language, 'en');
    assert.equal(timeZone, null);
    assert.equal(dailyNotifications, false);
    assert.ok(messages.at(-1)?.includes('Welcome'));
    assert.ok(!messages.at(-1)?.includes('Daily summary'));
  } finally {
    db.select = originalSelect;
    db.update = originalUpdate;
  }
});
