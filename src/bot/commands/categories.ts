import { tr } from '../../lib/i18n/index.js';
import { sectionKeyboard } from './menu.js';
import type { Conversation } from '@grammyjs/conversations';
import { InlineKeyboard, type Context } from 'grammy';
import type { OperationType } from '../../db/schema.js';
import {
  BUTTONS,
  CALLBACKS,
  MAX_CATEGORY_NAME_LENGTH,
  OPERATION_TYPE_EMOJI,
  OPERATION_TYPE_LABELS,
} from '../../lib/constants/index.js';
import {
  archiveCategory,
  createCategory,
  getActiveCategories,
} from '../../lib/services/categories.js';
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
  fromMenu = true,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const list = await getActiveCategories(userId);
  const byType = (type: OperationType) =>
    list
      .filter((c) => c.type === type)
      .map((c) => `• ${c.name}`)
      .join('\n') || tr('categories-message-1');

  const text = [
    tr('categories-message-2'),
    '',
    tr('categories-message-3', { v0: OPERATION_TYPE_EMOJI.expense }),
    byType('expense'),
    '',
    tr('categories-message-4', { v0: OPERATION_TYPE_EMOJI.income }),
    byType('income'),
  ].join('\n');

  const keyboard = new InlineKeyboard()
    .text(tr('categories-message-5'), ADD_CATEGORY_CALLBACK)
    .row()
    .text(tr('categories-message-6'), ARCHIVE_MENU_CALLBACK)
    .row()
    .text(BUTTONS.backToMenu, CALLBACKS.menuBack)
    .row()
    .text(tr('categories-message-7'), 'section:close');
  return { text, keyboard: sectionKeyboard(keyboard, fromMenu) };
}

/** Экран выбора типа для архивирования. */
export function renderArchiveTypePicker(fromMenu = true): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard()
    .text(tr('categories-message-8', { v0: OPERATION_TYPE_EMOJI.expense }), 'catarch:type:expense')
    .text(tr('categories-message-9', { v0: OPERATION_TYPE_EMOJI.income }), 'catarch:type:income')
    .row()
    .text(tr('categories-message-10'), BACK_TO_CATEGORIES_CALLBACK)
    .row()
    .text(BUTTONS.backToMenu, CALLBACKS.menuBack);
  return {
    text: tr('categories-message-11'),
    keyboard: sectionKeyboard(keyboard, fromMenu),
  };
}

/** Список категорий выбранного типа для архивирования. */
export async function renderArchiveCategoryPicker(
  userId: string,
  type: OperationType,
  fromMenu = true,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const list = await getActiveCategories(userId, type);

  const keyboard = new InlineKeyboard();
  list.forEach((category, i) => {
    keyboard.text(category.name, `catarch:id:${category.id}`);
    if (i % 2 === 1) keyboard.row();
  });
  if (list.length % 2 === 1) keyboard.row();
  keyboard
    .text(tr('categories-message-10'), ARCHIVE_MENU_CALLBACK)
    .row()
    .text(BUTTONS.backToMenu, CALLBACKS.menuBack);

  const text =
    list.length > 0
      ? tr('categories-message-12', { v0: OPERATION_TYPE_LABELS[type].toLowerCase() })
      : tr('categories-message-13', { v0: OPERATION_TYPE_LABELS[type].toLowerCase() });
  return { text, keyboard: sectionKeyboard(keyboard, fromMenu) };
}

/** Архивирует категорию и возвращает текст+клавиатуру для показа результата. */
export async function handleArchive(
  userId: string,
  categoryId: number,
  fromMenu = true,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const archived = await archiveCategory(userId, categoryId);
  const base = await renderCategories(userId, fromMenu);
  if (!archived) return base;
  return {
    text: tr('categories-message-14', { v0: archived.name, v1: base.text }),
    keyboard: base.keyboard,
  };
}

/** Диалог добавления категории: тип → название → создание. */
export async function addCategory(conversation: Conversation, ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const userId = String(from.id);

  await conversation.external(() => registerUser(userId, from.username));

  const ref = await promptMessage(ctx, tr('categories-message-15'), typeKeyboard());
  const typeResult = await waitCallback(conversation, ref, /^type:(expense|income)$/);
  const type = typeResult.data.split(':')[1] as OperationType;

  await editPrompt(typeResult.ctx, ref, tr('add-message-3'), cancelKeyboard());
  for (;;) {
    const { text, ctx: nameCtx } = await waitText(conversation, ref);
    const name = text.slice(0, MAX_CATEGORY_NAME_LENGTH);
    if (!name) {
      await editPrompt(nameCtx, ref, tr('add-message-4'), cancelKeyboard());
      continue;
    }
    const category = await conversation.external(() => createCategory(userId, name, type));
    await editPrompt(
      nameCtx,
      ref,
      tr('categories-message-16', {
        v0: category.name,
        v1: OPERATION_TYPE_LABELS[type].toLowerCase(),
      }),
    );
    return;
  }
}
