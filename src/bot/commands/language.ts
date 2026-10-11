import { InlineKeyboard, type Context } from 'grammy';
import { currentLanguage, tr, type Language } from '../../lib/i18n/index.js';
import { registerUser, setUserLanguage } from '../../lib/services/users.js';
import { menuKeyboard } from './menu.js';

export function languageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text((currentLanguage() === 'ru' ? '✓ ' : '') + 'Русский', 'language:ru')
    .text((currentLanguage() === 'en' ? '✓ ' : '') + 'English', 'language:en');
}

export async function showLanguagePicker(ctx: Context, edit = false): Promise<void> {
  if (edit) await ctx.editMessageText(tr('language-title'), { reply_markup: languageKeyboard() });
  else await ctx.reply(tr('language-title'), { reply_markup: languageKeyboard() });
}

export async function chooseLanguage(ctx: Context, language: Language): Promise<void> {
  if (!ctx.from) return;
  await registerUser(String(ctx.from.id), ctx.from.username, language);
  await setUserLanguage(String(ctx.from.id), language);
  await ctx.editMessageText(tr('menu-message-1'), { reply_markup: menuKeyboard() });
}
