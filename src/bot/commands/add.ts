import { tr } from '../../lib/i18n/index.js';
import type { Conversation } from '@grammyjs/conversations';
import type { Context } from 'grammy';
import type { Currency, OperationType } from '../../db/schema.js';
import {
  CALLBACKS,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_COMMENT_LENGTH,
  OPERATION_TYPE_LABELS,
} from '../../lib/constants/index.js';
import {
  createCategory,
  getActiveCategories,
  getCategoryById,
} from '../../lib/services/categories.js';
import { createTransaction } from '../../lib/services/transactions.js';
import { registerUser } from '../../lib/services/users.js';
import { formatDate } from '../../lib/utils/date.js';
import { formatAmount, parseAmount } from '../../lib/utils/money.js';
import {
  currencyKeyboard,
  cancelKeyboard,
  categoriesKeyboard,
  editPrompt,
  promptMessage,
  skipKeyboard,
  typeKeyboard,
  waitCallback,
  waitText,
  waitTextOrCallback,
} from '../helpers.js';

/** Пошаговый диалог добавления операции: тип → категория → сумма → комментарий → сохранение. */
export async function addOperation(conversation: Conversation, ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const userId = String(from.id);

  // на случай, если /add вызван до /start
  await conversation.external(() => registerUser(userId, from.username));

  // Шаг 1: тип операции
  const ref = await promptMessage(ctx, tr('add-message-1'), typeKeyboard());
  const typeResult = await waitCallback(conversation, ref, /^type:(expense|income)$/);
  const type = typeResult.data.split(':')[1] as OperationType;
  const typeLabel = OPERATION_TYPE_LABELS[type];

  // Шаг 2: категория
  const categoryList = await conversation.external(() => getActiveCategories(userId, type));
  await editPrompt(
    typeResult.ctx,
    ref,
    tr('add-message-2', { v0: typeLabel }),
    categoriesKeyboard(categoryList),
  );

  const categoryResult = await waitCallback(conversation, ref, /^(cat:\d+|new_category)$/);
  let categoryId: number;
  let categoryName: string;

  if (categoryResult.data === CALLBACKS.newCategory) {
    await editPrompt(categoryResult.ctx, ref, tr('add-message-3'), cancelKeyboard());
    for (;;) {
      const { text, ctx: nameCtx } = await waitText(conversation, ref);
      const name = text.slice(0, MAX_CATEGORY_NAME_LENGTH);
      if (!name) {
        await editPrompt(nameCtx, ref, tr('add-message-4'), cancelKeyboard());
        continue;
      }
      const category = await conversation.external(() => createCategory(userId, name, type));
      categoryId = category.id;
      categoryName = category.name;
      break;
    }
  } else {
    categoryId = Number(categoryResult.data.split(':')[1]);
    const category = await conversation.external(() => getCategoryById(userId, categoryId));
    if (!category || category.type !== type || category.isArchived) {
      await editPrompt(categoryResult.ctx, ref, tr('add-message-5'));
      await conversation.halt();
      return;
    }
    categoryName = category.name;
  }

  await editPrompt(ctx, ref, tr('add-message-6'), currencyKeyboard());
  const currencyResult = await waitCallback(conversation, ref, /^currency:(RUB|USD|EUR|RSD)$/);
  const currency = currencyResult.data.split(':')[1] as Currency;

  // Шаг 3: сумма
  await editPrompt(
    ctx,
    ref,
    tr('add-message-7', { v0: typeLabel, v1: categoryName }),
    cancelKeyboard(),
  );
  let amount: number;
  for (;;) {
    const { text, ctx: amountCtx } = await waitText(conversation, ref);
    const parsed = parseAmount(text);
    if (parsed !== null) {
      amount = parsed;
      break;
    }
    await editPrompt(
      amountCtx,
      ref,
      tr('add-message-8', { v0: typeLabel, v1: categoryName }),
      cancelKeyboard(),
    );
  }

  // Шаг 4: комментарий (опционально)
  await editPrompt(
    ctx,
    ref,
    tr('add-message-9', {
      v0: typeLabel,
      v1: categoryName,
      v2: formatAmount(amount),
      v3: currency,
    }),
    skipKeyboard(),
  );
  const commentResult = await waitTextOrCallback(conversation, ref, /^skip$/);
  const comment =
    commentResult.kind === 'text' ? commentResult.text.slice(0, MAX_COMMENT_LENGTH) : undefined;

  // Шаг 5: сохранение и подтверждение
  const transaction = await conversation.external(() =>
    createTransaction({
      userId,
      categoryId,
      amount,
      currency,
      type,
      ...(comment ? { comment } : {}),
    }),
  );

  const lines = [
    tr('add-message-10', { v0: typeLabel }),
    '',
    `💰 ${formatAmount(amount)} ${currency} — ${categoryName}`,
    `📅 ${formatDate(transaction.createdAt)}`,
  ];
  if (!transaction.rateAt) lines.push(tr('add-message-11'));
  else if (transaction.rateEstimated) lines.push(tr('add-message-12'));
  if (comment) lines.push(`💬 ${comment}`);
  await editPrompt(commentResult.ctx, ref, lines.join('\n'));
}
