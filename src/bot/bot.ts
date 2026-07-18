import {
  conversations,
  createConversation,
  type ConversationFlavor,
} from '@grammyjs/conversations';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { CALLBACKS } from '../lib/constants/index.js';
import { addOperation } from './commands/add.js';
import { ADD_CATEGORY_CALLBACK, addCategory, renderCategories } from './commands/categories.js';
import { MENU_TEXT, menuKeyboard } from './commands/menu.js';
import { handleStart } from './commands/start.js';

export type BotContext = ConversationFlavor<Context>;

export function createBot(token: string): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  bot.use(conversations());
  bot.use(createConversation(addOperation));
  bot.use(createConversation(addCategory));

  bot.command('start', handleStart);

  bot.command('menu', async (ctx) => {
    await ctx.reply(MENU_TEXT, { reply_markup: menuKeyboard() });
  });

  bot.command('add', async (ctx) => {
    await ctx.conversation.enter('addOperation');
  });

  bot.command('categories', async (ctx) => {
    if (!ctx.from) return;
    const { text, keyboard } = await renderCategories(String(ctx.from.id));
    await ctx.reply(text, { reply_markup: keyboard });
  });

  // /cancel вне диалога (внутри диалога его перехватывает сам диалог)
  bot.command('cancel', async (ctx) => {
    await ctx.conversation.exitAll();
    await ctx.reply('Сейчас нет активного диалога. Меню: /menu');
  });

  // кнопки меню
  bot.callbackQuery(CALLBACKS.menuAdd, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('addOperation');
  });

  bot.callbackQuery(CALLBACKS.menuCategories, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const { text, keyboard } = await renderCategories(String(ctx.from.id));
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(ADD_CATEGORY_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('addCategory');
  });

  // заглушки для нереализованных разделов
  bot.callbackQuery(
    [CALLBACKS.menuHistory, CALLBACKS.menuStats, CALLBACKS.menuExport],
    async (ctx) => {
      await ctx.answerCallbackQuery({ text: 'Пока в разработке 🚧' });
    },
  );

  // просроченные кнопки отменённых диалогов
  bot.callbackQuery(CALLBACKS.cancel, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
  });

  bot.catch((err) => {
    console.error('Bot error:', err.error);
  });

  return bot;
}
