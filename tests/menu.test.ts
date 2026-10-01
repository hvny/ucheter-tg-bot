import { InlineKeyboard } from 'grammy';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from 'grammy';
import {
  MENU_TEXT,
  returnToMenu,
  cameFromMenu,
  sectionKeyboard,
} from '../src/bot/commands/menu.js';

for (const media of [false, true]) {
  test(`return from ${media ? 'photo statistics' : 'text section'} to menu`, async () => {
    const calls: string[] = [];
    const ctx = {
      callbackQuery: { message: media ? { photo: [{}] } : { text: 'История' } },
      editMessageText: async (text: string) => {
        assert.equal(text, MENU_TEXT);
        calls.push('edit');
      },
      deleteMessage: async () => {
        calls.push('delete');
      },
      reply: async (text: string) => {
        assert.equal(text, MENU_TEXT);
        calls.push('reply');
      },
    } as unknown as Context;
    await returnToMenu(ctx);
    assert.deepEqual(calls, media ? ['delete', 'reply'] : ['edit']);
  });
}

test('command origin omits menu navigation and survives subsequent callbacks', () => {
  const keyboard = new InlineKeyboard()
    .text('Фильтр', 'filter')
    .row()
    .text('Назад в меню', 'menu:back')
    .row()
    .text('Закрыть', 'section:close');
  const command = { message: { text: '/history' } } as unknown as Context;
  assert.equal(cameFromMenu(command), false);
  const filtered = sectionKeyboard(keyboard, cameFromMenu(command));
  assert.deepEqual(
    filtered.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : '')),
    ['filter', 'section:close'],
  );
  const callback = {
    callbackQuery: { data: 'filter', message: { reply_markup: filtered } },
  } as unknown as Context;
  assert.equal(cameFromMenu(callback), false);
});

test('menu origin keeps menu navigation through filters', () => {
  const entry = { callbackQuery: { data: 'menu:stats' } } as unknown as Context;
  assert.equal(cameFromMenu(entry), true);
  const keyboard = sectionKeyboard(
    new InlineKeyboard().text('Фильтр', 'filter').row().text('Назад в меню', 'menu:back'),
    cameFromMenu(entry),
  );
  const callback = {
    callbackQuery: { data: 'filter', message: { reply_markup: keyboard } },
  } as unknown as Context;
  assert.equal(cameFromMenu(callback), true);
});
