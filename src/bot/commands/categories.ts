import type { Conversation } from '@grammyjs/conversations';
import { InlineKeyboard, type Context } from 'grammy';
import type { OperationType } from '../../db/schema.js';
import {
  MAX_CATEGORY_NAME_LENGTH,
  OPERATION_TYPE_EMOJI,
  OPERATION_TYPE_LABELS,
} from '../../lib/constants/index.js';
import { archiveCategory, createCategory, getActiveCategories } from '../../lib/services/categories.js';
import { registerUser } from '../../lib/services/users.js';
import {
  cancelKeyboard,
  editPrompt,
  promptMessage,
  typeKeyboard,
  waitCallback,
  waitText,
} from '../helpers.js';

export const ADD_CATEGORY_CALLBACK = 'categories:add';
export const ARCHIVE_MENU_CALLBACK = 'categories:archive_menu';
export const BACK_TO_CATEGORIES_CALLBACK = 'categories:back';
export const ARCHIVE_TYPE_PATTERN = /^catarch:type:(expense|income)$/;
export const ARCHIVE_ID_PATTERN = /^catarch:id:(\d+)$/;

/** Текст и клавиатура для экрана «Категории». */
export async function renderCategories(
  userId: string,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const list = await getActiveCategories(userId);
  const byType = (type: OperationType) =>
    list
      .filter((c) => c.type === type)
      .map((c) => `• ${c.name}`)
      .join('\n') || '— пока пусто —';

  const text = [
    '🗂 Твои категории',
    '',
    `${OPERATION_TYPE_EMOJI.expense} Расходы:`,
    byType('expense'),
    '',
    `${OPERATION_TYPE_EMOJI.income} Доходы:`,
    byType('income'),
  ].join('\n');

  const keyboard = new InlineKeyboard()
    .text('➕ Добавить категорию', ADD_CATEGORY_CALLBACK)
    .row()
    .text('🗄 Архивировать категорию', ARCHIVE_MENU_CALLBACK);
  return { text, keyboard };
}

/** Экран выбора типа для архивирования. */
export function renderArchiveTypePicker(): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard()
    .text(`${OPERATION_TYPE_EMOJI.expense} Расходы`, 'catarch:type:expense')
    .text(`${OPERATION_TYPE_EMOJI.income} Доходы`, 'catarch:type:income')
    .row()
    .text('◀️ Назад', BACK_TO_CATEGORIES_CALLBACK);
  return { text: 'Какую категорию архивировать? Сначала выбери тип:', keyboard };
}

/** Список категорий выбранного типа для архивирования. */
export async function renderArchiveCategoryPicker(
  userId: string,
  type: OperationType,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const list = await getActiveCategories(userId, type);

  const keyboard = new InlineKeyboard();
  list.forEach((category, i) => {
    keyboard.text(category.name, `catarch:id:${category.id}`);
    if (i % 2 === 1) keyboard.row();
  });
  if (list.length % 2 === 1) keyboard.row();
  keyboard.text('◀️ Назад', ARCHIVE_MENU_CALLBACK);

  const text =
    list.length > 0
      ? `Выбери категорию (${OPERATION_TYPE_LABELS[type].toLowerCase()}) для архивирования:`
      : `Нет активных категорий типа «${OPERATION_TYPE_LABELS[type].toLowerCase()}».`;
  return { text, keyboard };
}

/** Архивирует категорию и возвращает текст+клавиатуру для показа результата. */
export async function handleArchive(
  userId: string,
  categoryId: number,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const archived = await archiveCategory(userId, categoryId);
  const base = await renderCategories(userId);
  if (!archived) return base;
  return { text: `✅ Категория «${archived.name}» архивирована.\n\n${base.text}`, keyboard: base.keyboard };
}

/** Диалог добавления категории: тип → название → создание. */
export async function addCategory(conversation: Conversation, ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const userId = String(from.id);

  await conversation.external(() => registerUser(userId, from.username));

  const ref = await promptMessage(ctx, 'Категория для чего?', typeKeyboard());
  const typeResult = await waitCallback(conversation, ref, /^type:(expense|income)$/);
  const type = typeResult.data.split(':')[1] as OperationType;

  await editPrompt(typeResult.ctx, ref, 'Введи название новой категории:', cancelKeyboard());
  for (;;) {
    const { text, ctx: nameCtx } = await waitText(conversation, ref);
    const name = text.slice(0, MAX_CATEGORY_NAME_LENGTH);
    if (!name) {
      await editPrompt(
        nameCtx,
        ref,
        'Название не может быть пустым. Введи название категории:',
        cancelKeyboard(),
      );
      continue;
    }
    const category = await conversation.external(() => createCategory(userId, name, type));
    await editPrompt(
      nameCtx,
      ref,
      `✅ Категория «${category.name}» (${OPERATION_TYPE_LABELS[type].toLowerCase()}) добавлена.\n\nСписок категорий: /categories`,
    );
    return;
  }
}
