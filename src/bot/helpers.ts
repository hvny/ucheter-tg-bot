import { logTelegramFailure } from './logging.js';
import {
  MENU_TEXT,
  menuKeyboard,
  backToMenuKeyboard,
  cameFromMenu,
  sectionKeyboard,
} from './commands/menu.js';
import type { Conversation } from '@grammyjs/conversations';
import { InlineKeyboard, type Context } from 'grammy';
import { currencyType, type Category } from '../db/schema.js';
import { BUTTONS, CALLBACKS } from '../lib/constants/index.js';

/** Ссылка на "экран" диалога — единственное сообщение бота, которое редактируется на каждом шаге. */
export interface PromptRef {
  chatId: number;
  messageId: number;
  fromMenu?: boolean;
}

export function typeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(BUTTONS.expense, 'type:expense')
    .text(BUTTONS.income, 'type:income')
    .row()
    .text(BUTTONS.cancel, CALLBACKS.cancel)
    .row()
    .text(BUTTONS.backToMenu, CALLBACKS.menuBack);
}

export function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(BUTTONS.cancel, CALLBACKS.cancel)
    .row()
    .text(BUTTONS.backToMenu, CALLBACKS.menuBack);
}

export function skipKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(BUTTONS.skip, CALLBACKS.skip)
    .row()
    .text(BUTTONS.cancel, CALLBACKS.cancel)
    .row()
    .text(BUTTONS.backToMenu, CALLBACKS.menuBack);
}

export function categoriesKeyboard(categories: Category[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  categories.forEach((category, i) => {
    keyboard.text(category.name, `cat:${category.id}`);
    if (i % 2 === 1) keyboard.row();
  });
  if (categories.length % 2 === 1) keyboard.row();
  return keyboard
    .text(BUTTONS.newCategory, CALLBACKS.newCategory)
    .row()
    .text(BUTTONS.cancel, CALLBACKS.cancel)
    .row()
    .text(BUTTONS.backToMenu, CALLBACKS.menuBack);
}

/**
 * Первый шаг диалога: если вошли по кнопке — редактируем это же сообщение,
 * если по команде — отправляем новое. Дальше все шаги редактируют его через editPrompt.
 */
export async function promptMessage(
  ctx: Context,
  text: string,
  keyboard: InlineKeyboard,
): Promise<PromptRef> {
  const fromMenu = cameFromMenu(ctx);
  keyboard = sectionKeyboard(keyboard, fromMenu);
  const cbMessage = ctx.callbackQuery?.message;
  if (cbMessage) {
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(logTelegramFailure(ctx, 'editMessageText'));
    return { chatId: cbMessage.chat.id, messageId: cbMessage.message_id, fromMenu };
  }
  const sent = await ctx.reply(text, { reply_markup: keyboard });
  return { chatId: sent.chat.id, messageId: sent.message_id, fromMenu };
}

export async function editPrompt(
  ctx: Context,
  ref: PromptRef,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  // "message is not modified" и подобные ошибки редактирования не должны ронять диалог
  await ctx.api
    .editMessageText(ref.chatId, ref.messageId, text, {
      reply_markup: sectionKeyboard(keyboard ?? backToMenuKeyboard(), ref.fromMenu ?? false),
    })
    .catch(logTelegramFailure(ctx, 'editMessageText'));
}

/** Завершает диалог с сообщением «Отменено». */
export async function cancelFlow(
  conversation: Conversation,
  ctx: Context,
  ref: PromptRef,
): Promise<never> {
  await editPrompt(ctx, ref, 'Отменено.');
  await conversation.halt();
  throw new Error('unreachable');
}

/**
 * Ждёт нажатия inline-кнопки, подходящей под pattern.
 * Отмена (кнопка или /cancel) прерывает диалог. Посторонние текстовые сообщения удаляются.
 */
export async function waitCallback(
  conversation: Conversation,
  ref: PromptRef,
  pattern: RegExp,
): Promise<{ ctx: Context; data: string }> {
  for (;;) {
    const ctx = await conversation.wait();
    const data = ctx.callbackQuery?.data;
    if (data) {
      const message = ctx.callbackQuery?.message;
      if (!message || message.chat.id !== ref.chatId || message.message_id !== ref.messageId) {
        await ctx.answerCallbackQuery().catch(logTelegramFailure(ctx, 'answerCallbackQuery'));
        continue;
      }
      await ctx.answerCallbackQuery().catch(logTelegramFailure(ctx, 'answerCallbackQuery'));
      if (data === CALLBACKS.menuBack) {
        await editPrompt(ctx, ref, MENU_TEXT, menuKeyboard());
        await conversation.halt();
        throw new Error('unreachable');
      }
      if (data === CALLBACKS.cancel) await cancelFlow(conversation, ctx, ref);
      if (pattern.test(data)) return { ctx, data };
      continue;
    }
    if (ctx.message) {
      const isCancel = ctx.message.text === '/cancel';
      await ctx.deleteMessage().catch(logTelegramFailure(ctx, 'deleteMessage'));
      if (isCancel) await cancelFlow(conversation, ctx, ref);
    }
  }
}

export type TextOrCallback =
  { kind: 'text'; text: string; ctx: Context } | { kind: 'callback'; data: string; ctx: Context };

/**
 * Ждёт текстовый ввод пользователя (сообщение удаляется, чтобы не засорять чат)
 * или нажатие кнопки из allowedCallbacks. Отмена прерывает диалог.
 */
export async function waitTextOrCallback(
  conversation: Conversation,
  ref: PromptRef,
  allowedCallbacks?: RegExp,
): Promise<TextOrCallback> {
  for (;;) {
    const ctx = await conversation.wait();
    const data = ctx.callbackQuery?.data;
    if (data) {
      const message = ctx.callbackQuery?.message;
      if (!message || message.chat.id !== ref.chatId || message.message_id !== ref.messageId) {
        await ctx.answerCallbackQuery().catch(logTelegramFailure(ctx, 'answerCallbackQuery'));
        continue;
      }
      await ctx.answerCallbackQuery().catch(logTelegramFailure(ctx, 'answerCallbackQuery'));
      if (data === CALLBACKS.menuBack) {
        await editPrompt(ctx, ref, MENU_TEXT, menuKeyboard());
        await conversation.halt();
        throw new Error('unreachable');
      }
      if (data === CALLBACKS.cancel) await cancelFlow(conversation, ctx, ref);
      if (allowedCallbacks?.test(data)) return { kind: 'callback', data, ctx };
      continue;
    }
    if (!ctx.message) continue;
    const text = ctx.message.text;
    await ctx.deleteMessage().catch(logTelegramFailure(ctx, 'deleteMessage'));
    if (!text) continue;
    if (text === '/cancel') await cancelFlow(conversation, ctx, ref);
    if (text.startsWith('/')) continue;
    return { kind: 'text', text: text.trim(), ctx };
  }
}

export async function waitText(
  conversation: Conversation,
  ref: PromptRef,
): Promise<{ text: string; ctx: Context }> {
  const result = await waitTextOrCallback(conversation, ref);
  // без allowedCallbacks сюда может прийти только текст
  return { text: (result as { kind: 'text'; text: string; ctx: Context }).text, ctx: result.ctx };
}

export function currencyKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const currency of currencyType.enumValues) keyboard.text(currency, `currency:${currency}`);
  return keyboard
    .row()
    .text(BUTTONS.cancel, CALLBACKS.cancel)
    .row()
    .text(BUTTONS.backToMenu, CALLBACKS.menuBack);
}
