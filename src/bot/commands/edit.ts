import { DEFAULT_HISTORY_STATE, encodeHistoryState } from './history.js';
import { sectionKeyboard } from './menu.js';
import type { Conversation } from '@grammyjs/conversations';
import { InlineKeyboard, type Context } from 'grammy';
import type { Currency, OperationType } from '../../db/schema.js';
import { MAX_COMMENT_LENGTH, OPERATION_TYPE_LABELS } from '../../lib/constants/index.js';
import { getActiveCategories, getCategoryById } from '../../lib/services/categories.js';
import {
  deleteTransaction,
  getTransactionById,
  updateTransaction,
} from '../../lib/services/transactions.js';
import { formatAmount, parseAmount } from '../../lib/utils/money.js';
import {
  returnToHistory,
  cancelKeyboard,
  currencyKeyboard,
  editPrompt,
  promptMessage,
  typeKeyboard,
  waitCallback,
  waitText,
  waitTextOrCallback,
} from '../helpers.js';

export const EDIT_PATTERN = /^edit:(\d+)$/;

export async function editOperation(conversation: Conversation, ctx: Context): Promise<void> {
  if (!ctx.from) return;
  const userId = String(ctx.from.id);
  const id = Number(ctx.callbackQuery?.data?.match(EDIT_PATTERN)?.[1]);
  const item = await conversation.external(() => getTransactionById(userId, id));
  if (!item) {
    await ctx.reply('Операция не найдена. Открой /history.');
    return;
  }
  let type = item.type;
  let categoryId = item.categoryId;
  let amount = Number(item.amount);
  let currency = item.currency;
  let comment = item.comment ?? '';
  let categoryName =
    (await conversation.external(() => getCategoryById(userId, categoryId)))?.name ??
    'Без категории';
  const ref = await promptMessage(
    ctx,
    'Редактирование операции',
    sectionKeyboard(cancelKeyboard(), false),
  );
  ref.editingOperation = true;
  for (;;) {
    const keyboard = new InlineKeyboard()
      .text('Сумма', 'ef:amount')
      .text('Валюта', 'ef:currency')
      .row()
      .text('Тип', 'ef:type')
      .text('Категория', 'ef:category')
      .row()
      .text('Комментарий', 'ef:comment')
      .row()
      .text('✅ Сохранить', 'ef:save')
      .text('❌ Отмена', 'cancel')
      .row()
      .text('🗑 Удалить операцию', 'ef:delete');
    await editPrompt(
      ctx,
      ref,
      `✏️ ${OPERATION_TYPE_LABELS[type]}\n${formatAmount(amount)} ${currency} · ${categoryName}\nКомментарий: ${comment || '—'}\n\nВыбери, что изменить:`,
      keyboard,
    );
    const choice = await waitCallback(
      conversation,
      ref,
      /^ef:(amount|currency|type|category|comment|save|delete)$/,
    );
    const field = choice.data.split(':')[1];
    if (field === 'delete') {
      await editPrompt(
        ctx,
        ref,
        `Удалить операцию?\n${OPERATION_TYPE_LABELS[item.type]} · ${formatAmount(item.amount)} ${item.currency}\n\nУдаление нельзя отменить.`,
        new InlineKeyboard()
          .text('🗑 Да, удалить', 'ef:confirm_delete')
          .row()
          .text('◀️ Не удалять', 'ef:keep')
          .text('❌ Отмена', 'cancel'),
      );
      const confirmation = await waitCallback(conversation, ref, /^ef:(confirm_delete|keep)$/);
      if (confirmation.data === 'ef:keep') continue;
      const deleted = await conversation.external(() => deleteTransaction(userId, id));
      await returnToHistory(
        conversation,
        confirmation.ctx,
        ref,
        deleted ? '✅ Операция удалена.' : 'Операция уже удалена или недоступна.',
      );
      return;
    }
    if (field === 'save') {
      const updated = await conversation.external(() =>
        updateTransaction(userId, id, {
          type,
          categoryId,
          amount,
          currency,
          ...(comment ? { comment } : {}),
        }),
      );
      await editPrompt(
        choice.ctx,
        ref,
        updated
          ? `✅ Операция обновлена\n${OPERATION_TYPE_LABELS[type]} · ${formatAmount(amount)} ${currency} · ${categoryName}${comment ? `\n💬 ${comment}` : ''}`
          : 'Не удалось сохранить: операция или категория не найдена. Открой /history.',
        new InlineKeyboard().text(
          '📜 Все операции',
          encodeHistoryState({ ...DEFAULT_HISTORY_STATE, period: 'all' }),
        ),
      );
      return;
    }
    if (field === 'amount') {
      await editPrompt(ctx, ref, 'Введи новую сумму:', cancelKeyboard());
      for (;;) {
        const result = await waitText(conversation, ref);
        const parsed = parseAmount(result.text);
        if (parsed !== null) {
          amount = parsed;
          break;
        }
        await editPrompt(
          result.ctx,
          ref,
          'Введи положительное число, например 250 или 99,90:',
          cancelKeyboard(),
        );
      }
    } else if (field === 'currency') {
      await editPrompt(ctx, ref, 'Выбери валюту:', currencyKeyboard());
      currency = (await waitCallback(conversation, ref, /^currency:(RUB|USD|EUR|RSD)$/)).data.split(
        ':',
      )[1] as Currency;
    } else if (field === 'comment') {
      await editPrompt(
        ctx,
        ref,
        'Введи комментарий или удали существующий:',
        new InlineKeyboard()
          .text('Удалить комментарий', 'ef:clear')
          .row()
          .text('❌ Отмена', 'cancel'),
      );
      const result = await waitTextOrCallback(conversation, ref, /^ef:clear$/);
      comment = result.kind === 'text' ? result.text.slice(0, MAX_COMMENT_LENGTH) : '';
    } else {
      let nextType = type;
      if (field === 'type') {
        await editPrompt(ctx, ref, 'Выбери тип операции:', typeKeyboard());
        nextType = (await waitCallback(conversation, ref, /^type:(expense|income)$/)).data.split(
          ':',
        )[1] as OperationType;
      }
      const list = await conversation.external(() => getActiveCategories(userId, nextType));
      if (nextType === item.type && !list.some((c) => c.id === item.categoryId)) {
        const original = await conversation.external(() =>
          getCategoryById(userId, item.categoryId),
        );
        if (original) list.push(original);
      }
      if (!list.length) {
        await editPrompt(
          ctx,
          ref,
          'Нет категорий этого типа. Создай категорию через /categories.',
          cancelKeyboard(),
        );
        await waitCallback(conversation, ref, /^cancel$/);
        return;
      }
      const categories = new InlineKeyboard();
      for (const category of list) categories.text(category.name, `ec:${category.id}`).row();
      categories.text('❌ Отмена', 'cancel');
      await editPrompt(ctx, ref, 'Выбери категорию:', categories);
      for (;;) {
        const selected = await waitCallback(conversation, ref, /^ec:\d+$/);
        const category = list.find((c) => c.id === Number(selected.data.split(':')[1]));
        if (!category) continue;
        type = nextType;
        categoryId = category.id;
        categoryName = category.name;
        break;
      }
    }
  }
}
