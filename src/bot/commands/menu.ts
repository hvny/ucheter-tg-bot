import { logTelegramFailure } from '../logging.js';
import { InlineKeyboard, type Context } from 'grammy';
import { BUTTONS, CALLBACKS } from '../../lib/constants/index.js';

export const MENU_TEXT = '📋 Меню — что делаем?';

export function menuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(BUTTONS.add, CALLBACKS.menuAdd)
    .text(BUTTONS.history, CALLBACKS.menuHistory)
    .row()
    .text(BUTTONS.stats, CALLBACKS.menuStats)
    .text(BUTTONS.categories, CALLBACKS.menuCategories)
    .row()
    .text(BUTTONS.export, CALLBACKS.menuExport);
}

export function backToMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(BUTTONS.backToMenu, CALLBACKS.menuBack);
}

/** Telegram cannot turn a photo or document into a text message in place. */
export async function returnToMenu(ctx: Context): Promise<void> {
  const message = ctx.callbackQuery?.message;
  if (message && 'text' in message) {
    await ctx.editMessageText(MENU_TEXT, { reply_markup: menuKeyboard() });
  } else {
    await ctx.deleteMessage().catch(logTelegramFailure(ctx, 'deleteMessage'));
    await ctx.reply(MENU_TEXT, { reply_markup: menuKeyboard() });
  }
}

/** Navigation origin is carried by the current message's keyboard. */
export function cameFromMenu(ctx: Context): boolean {
  const data = ctx.callbackQuery?.data;
  if (data && data.startsWith('menu:')) return true;
  const message = ctx.callbackQuery?.message;
  return Boolean(
    message &&
    'reply_markup' in message &&
    message.reply_markup?.inline_keyboard.some((row) =>
      row.some(
        (button) => 'callback_data' in button && button.callback_data === CALLBACKS.menuBack,
      ),
    ),
  );
}

export function sectionKeyboard(keyboard: InlineKeyboard, fromMenu: boolean): InlineKeyboard {
  if (fromMenu) return keyboard;
  return new InlineKeyboard(
    keyboard.inline_keyboard
      .map((row) =>
        row.filter(
          (button) => !('callback_data' in button) || button.callback_data !== CALLBACKS.menuBack,
        ),
      )
      .filter((row) => row.length),
  );
}
