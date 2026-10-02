import { InlineKeyboard } from 'grammy';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Conversation } from '@grammyjs/conversations';
import type { Context } from 'grammy';
import { editOperation } from '../src/bot/commands/edit.js';

const item = {
  id: 1,
  userId: '42',
  type: 'expense',
  categoryId: 2,
  amount: '10.00',
  currency: 'RUB',
  comment: 'old',
  createdAt: new Date(),
};

function fixture(inputs: string[], externalResults: unknown[]) {
  const screens: string[] = [];
  const keyboards: InlineKeyboard[] = [];
  const externalCalls: string[] = [];
  let calls = 0;
  const context = (input: string): Context =>
    ({
      from: { id: 42 },
      callbackQuery: input.startsWith('text:')
        ? undefined
        : { data: input, message: { chat: { id: 42 }, message_id: 9 } },
      message: input.startsWith('text:') ? { text: input.slice(5) } : undefined,
      api: {
        editMessageText: async (
          _chat: number,
          _id: number,
          text: string,
          options: { reply_markup: InlineKeyboard },
        ) => {
          keyboards.push(options.reply_markup);
          screens.push(text);
        },
      },
      editMessageText: async (text: string) => {
        screens.push(text);
      },
      answerCallbackQuery: async () => {},
      deleteMessage: async () => {},
      reply: async (text: string) => {
        screens.push(text);
      },
    }) as unknown as Context;
  const conversation = {
    external: async (fn: () => unknown) => {
      externalCalls.push(fn.toString());
      assert.ok(calls < externalResults.length, 'Unexpected database write/read');
      return externalResults[calls++];
    },
    wait: async () => {
      assert.ok(inputs.length, 'Unexpected wait');
      return context(inputs.shift()!);
    },
    halt: async () => {
      throw new Error('cancelled');
    },
  } as unknown as Conversation;
  return {
    conversation,
    ctx: context('edit:1'),
    screens,
    keyboards,
    externalCalls,
    calls: () => calls,
  };
}

test('edit validates amount, changes currency, clears comment, and saves explicitly', async () => {
  const f = fixture(
    [
      'ef:amount',
      'text:-1',
      'text:99,90',
      'ef:currency',
      'currency:EUR',
      'ef:comment',
      'ef:clear',
      'ef:save',
    ],
    [item, { name: 'Еда' }, item],
  );
  await editOperation(f.conversation, f.ctx);
  assert.ok(f.screens.some((s) => s.includes('положительное число')));
  assert.ok(f.screens.some((s) => s.includes('99,9 EUR') && s.includes('Комментарий: —')));
  assert.ok(f.screens.at(-1)?.includes('Операция обновлена'));
  assert.equal(f.calls(), 3);
});

test('cancel after changes does not write the transaction', async () => {
  const f = fixture(
    ['ef:currency', 'currency:USD', 'cancel'],
    [item, { name: 'Еда' }, { text: '📜 Все операции', keyboard: new InlineKeyboard() }],
  );
  await assert.rejects(editOperation(f.conversation, f.ctx), /cancelled/);
  assert.equal(f.calls(), 3);
  assert.equal(f.screens.at(-1), '📜 Все операции');
  assert.ok(
    !f.externalCalls.some(
      (fn) => fn.includes('updateTransaction') || fn.includes('deleteTransaction'),
    ),
  );
});

test('missing or foreign transaction cannot enter editing', async () => {
  const f = fixture([], [undefined]);
  await editOperation(f.conversation, f.ctx);
  assert.equal(f.calls(), 1);
  assert.ok(f.screens.at(-1)?.includes('Операция не найдена'));
});

test('changing type requires a matching category before save', async () => {
  const f = fixture(
    ['ef:type', 'type:income', 'ec:999', 'ec:3', 'ef:save'],
    [item, { name: 'Еда' }, [{ id: 3, name: 'Зарплата', type: 'income' }], item],
  );
  await editOperation(f.conversation, f.ctx);
  assert.ok(f.screens.at(-1)?.includes('Доход · 10 RUB · Зарплата'));
});

test('stale back to menu button also returns to history while editing', async () => {
  const f = fixture(
    ['ef:amount', 'text:250', 'menu:back'],
    [item, { name: 'Еда' }, { text: '📜 Все операции', keyboard: new InlineKeyboard() }],
  );
  await assert.rejects(editOperation(f.conversation, f.ctx), /cancelled/);
  assert.equal(f.calls(), 3);
  assert.equal(f.screens.at(-1), '📜 Все операции');
});

test('editing hides back to menu at every step', async () => {
  const f = fixture(['ef:amount', 'text:250', 'ef:save'], [item, { name: 'Еда' }, item]);
  await editOperation(f.conversation, f.ctx);
  for (const keyboard of f.keyboards)
    assert.ok(
      !keyboard.inline_keyboard
        .flat()
        .some((b) => 'callback_data' in b && b.callback_data === 'menu:back'),
    );
});

test('cancel during text input returns to all operations without saving', async () => {
  const f = fixture(
    ['ef:amount', 'text:/cancel'],
    [item, { name: 'Еда' }, { text: '📜 Все операции', keyboard: new InlineKeyboard() }],
  );
  await assert.rejects(editOperation(f.conversation, f.ctx), /cancelled/);
  assert.equal(f.screens.at(-1), '📜 Все операции');
  assert.ok(
    !f.externalCalls.some(
      (fn) => fn.includes('updateTransaction') || fn.includes('deleteTransaction'),
    ),
  );
});

test('delete requires confirmation and returns to refreshed history', async () => {
  const f = fixture(
    ['ef:delete', 'ef:confirm_delete'],
    [item, { name: 'Еда' }, true, { text: '📜 Все операции', keyboard: new InlineKeyboard() }],
  );
  await editOperation(f.conversation, f.ctx);
  assert.ok(f.screens.some((s) => s.includes('Удалить операцию?')));
  assert.equal(f.externalCalls.filter((fn) => fn.includes('deleteTransaction')).length, 1);
  assert.ok(f.screens.at(-1)?.includes('Операция удалена.'));
  assert.ok(f.screens.at(-1)?.includes('Все операции'));
});

test('declining deletion keeps editing and cancellation never deletes', async () => {
  const f = fixture(
    ['ef:delete', 'ef:keep', 'cancel'],
    [item, { name: 'Еда' }, { text: '📜 Все операции', keyboard: new InlineKeyboard() }],
  );
  await assert.rejects(editOperation(f.conversation, f.ctx), /cancelled/);
  assert.ok(!f.externalCalls.some((fn) => fn.includes('deleteTransaction')));
});

test('already deleted operation returns to history without success notice', async () => {
  const f = fixture(
    ['ef:delete', 'ef:confirm_delete'],
    [item, { name: 'Еда' }, false, { text: '📜 Все операции', keyboard: new InlineKeyboard() }],
  );
  await editOperation(f.conversation, f.ctx);
  assert.ok(f.screens.at(-1)?.includes('уже удалена или недоступна'));
});
