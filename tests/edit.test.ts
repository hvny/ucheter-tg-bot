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
  let calls = 0;
  const context = (input: string): Context =>
    ({
      from: { id: 42 },
      callbackQuery: input.startsWith('text:')
        ? undefined
        : { data: input, message: { chat: { id: 42 }, message_id: 9 } },
      message: input.startsWith('text:') ? { text: input.slice(5) } : undefined,
      api: {
        editMessageText: async (_chat: number, _id: number, text: string) => {
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
    external: async () => {
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
  return { conversation, ctx: context('edit:1'), screens, calls: () => calls };
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
  const f = fixture(['ef:currency', 'currency:USD', 'cancel'], [item, { name: 'Еда' }]);
  await assert.rejects(editOperation(f.conversation, f.ctx), /cancelled/);
  assert.equal(f.calls(), 2);
  assert.equal(f.screens.at(-1), 'Отменено.');
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
