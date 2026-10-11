import { tr } from '../../lib/i18n/index.js';
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
    await ctx.reply(tr('edit-message-1'));
    return;
  }
  let type = item.type;
  let categoryId = item.categoryId;
  let amount = Number(item.amount);
  let currency = item.currency;
  let comment = item.comment ?? '';
  let categoryName =
    (await conversation.external(() => getCategoryById(userId, categoryId)))?.name ??
    tr('edit-message-2');
  const ref = await promptMessage(
    ctx,
    tr('edit-message-3'),
    sectionKeyboard(cancelKeyboard(), false),
  );
  ref.editingOperation = true;
  for (;;) {
    const keyboard = new InlineKeyboard()
      .text(tr('edit-message-4'), 'ef:amount')
      .text(tr('edit-message-5'), 'ef:currency')
      .row()
      .text(tr('edit-message-6'), 'ef:type')
      .text(tr('edit-message-7'), 'ef:category')
      .row()
      .text(tr('edit-message-8'), 'ef:comment')
      .row()
      .text(tr('edit-message-9'), 'ef:save')
      .text(tr('edit-message-10'), 'cancel')
      .row()
      .text(tr('edit-message-11'), 'ef:delete');
    await editPrompt(
      ctx,
      ref,
      tr('edit-message-12', {
        v0: OPERATION_TYPE_LABELS[type],
        v1: formatAmount(amount),
        v2: currency,
        v3: categoryName,
        v4: comment || '—',
      }),
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
        tr('edit-message-13', {
          v0: OPERATION_TYPE_LABELS[item.type],
          v1: formatAmount(item.amount),
          v2: item.currency,
        }),
        new InlineKeyboard()
          .text(tr('edit-message-14'), 'ef:confirm_delete')
          .row()
          .text(tr('edit-message-15'), 'ef:keep')
          .text(tr('edit-message-10'), 'cancel'),
      );
      const confirmation = await waitCallback(conversation, ref, /^ef:(confirm_delete|keep)$/);
      if (confirmation.data === 'ef:keep') continue;
      const deleted = await conversation.external(() => deleteTransaction(userId, id));
      await returnToHistory(
        conversation,
        confirmation.ctx,
        ref,
        deleted ? tr('edit-message-16') : tr('edit-message-17'),
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
          ? tr('edit-message-18', {
              v0: OPERATION_TYPE_LABELS[type],
              v1: formatAmount(amount),
              v2: currency,
              v3: categoryName,
              v4: comment ? `\n💬 ${comment}` : '',
            })
          : tr('edit-message-19'),
        new InlineKeyboard().text(
          tr('edit-message-20'),
          encodeHistoryState({ ...DEFAULT_HISTORY_STATE, period: 'all' }),
        ),
      );
      return;
    }
    if (field === 'amount') {
      await editPrompt(ctx, ref, tr('edit-message-21'), cancelKeyboard());
      for (;;) {
        const result = await waitText(conversation, ref);
        const parsed = parseAmount(result.text);
        if (parsed !== null) {
          amount = parsed;
          break;
        }
        await editPrompt(result.ctx, ref, tr('edit-message-22'), cancelKeyboard());
      }
    } else if (field === 'currency') {
      await editPrompt(ctx, ref, tr('edit-message-23'), currencyKeyboard());
      currency = (await waitCallback(conversation, ref, /^currency:(RUB|USD|EUR|RSD)$/)).data.split(
        ':',
      )[1] as Currency;
    } else if (field === 'comment') {
      await editPrompt(
        ctx,
        ref,
        tr('edit-message-24'),
        new InlineKeyboard()
          .text(tr('edit-message-25'), 'ef:clear')
          .row()
          .text(tr('edit-message-10'), 'cancel'),
      );
      const result = await waitTextOrCallback(conversation, ref, /^ef:clear$/);
      comment = result.kind === 'text' ? result.text.slice(0, MAX_COMMENT_LENGTH) : '';
    } else {
      let nextType = type;
      if (field === 'type') {
        await editPrompt(ctx, ref, tr('edit-message-26'), typeKeyboard());
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
        await editPrompt(ctx, ref, tr('edit-message-27'), cancelKeyboard());
        await waitCallback(conversation, ref, /^cancel$/);
        return;
      }
      const categories = new InlineKeyboard();
      for (const category of list) categories.text(category.name, `ec:${category.id}`).row();
      categories.text(tr('edit-message-10'), 'cancel');
      await editPrompt(ctx, ref, tr('edit-message-28'), categories);
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
