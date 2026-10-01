import { registerUser, setPreferredCurrency } from '../lib/services/users.js';
import {
  conversations,
  createConversation,
  type ConversationFlavor,
} from '@grammyjs/conversations';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { CALLBACKS } from '../lib/constants/index.js';
import { editOperation, EDIT_PATTERN } from './commands/edit.js';
import { addOperation } from './commands/add.js';
import {
  ADD_CATEGORY_CALLBACK,
  ARCHIVE_ID_PATTERN,
  ARCHIVE_MENU_CALLBACK,
  ARCHIVE_TYPE_PATTERN,
  BACK_TO_CATEGORIES_CALLBACK,
  addCategory,
  handleArchive,
  renderArchiveCategoryPicker,
  renderArchiveTypePicker,
  renderCategories,
} from './commands/categories.js';
import {
  DEFAULT_HISTORY_STATE,
  HISTORY_CATEGORY_MENU_PATTERN,
  HISTORY_CLOSE_CALLBACK,
  HISTORY_NOOP_CALLBACK,
  HISTORY_PATTERN,
  decodeHistoryState,
  renderHistory,
  renderHistoryCategoryMenu,
} from './commands/history.js';
import {
  EXPORT_CLOSE_CALLBACK,
  EXPORT_PATTERN,
  decodeExportPeriod,
  renderExportMenu,
  sendExport,
} from './commands/export.js';
import { MENU_TEXT, menuKeyboard } from './commands/menu.js';
import { handleStart } from './commands/start.js';
import {
  getInitialStatsState,
  STATS_CLOSE_CALLBACK,
  STATS_PATTERN,
  decodeStatsState,
  renderStats,
  replaceWithStats,
  sendStats,
  updateStats,
} from './commands/stats.js';

export type BotContext = ConversationFlavor<Context>;

export function createBot(token: string): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  bot.use(conversations());
  bot.use(createConversation(addOperation));
  bot.use(createConversation(addCategory));
  bot.use(createConversation(editOperation));

  bot.callbackQuery(EDIT_PATTERN, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('editOperation');
  });

  bot.command('start', handleStart);

  bot.command('menu', async (ctx) => {
    await ctx.reply(MENU_TEXT, { reply_markup: menuKeyboard() });
  });

  bot.command('add', async (ctx) => {
    await ctx.conversation.enter('addOperation');
  });

  bot.command('history', async (ctx) => {
    if (!ctx.from) return;
    const { text, keyboard } = await renderHistory(String(ctx.from.id), DEFAULT_HISTORY_STATE);
    await ctx.reply(text, { reply_markup: keyboard });
  });

  bot.command('stats', async (ctx) => {
    if (!ctx.from) return;
    const result = await renderStats(
      String(ctx.from.id),
      await getInitialStatsState(String(ctx.from.id)),
    );
    await sendStats(ctx, result);
  });

  bot.command('export', async (ctx) => {
    const { text, keyboard } = renderExportMenu();
    await ctx.reply(text, { reply_markup: keyboard });
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

  bot.callbackQuery(CALLBACKS.menuHistory, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const { text, keyboard } = await renderHistory(String(ctx.from.id), DEFAULT_HISTORY_STATE);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(HISTORY_PATTERN, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const state = decodeHistoryState(ctx.match as RegExpMatchArray);
    const { text, keyboard } = await renderHistory(String(ctx.from.id), state);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(HISTORY_CATEGORY_MENU_PATTERN, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const state = decodeHistoryState(ctx.match as RegExpMatchArray);
    const { text, keyboard } = await renderHistoryCategoryMenu(String(ctx.from.id), state);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(HISTORY_NOOP_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(HISTORY_CLOSE_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
  });

  bot.callbackQuery(CALLBACKS.menuStats, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const result = await renderStats(
      String(ctx.from.id),
      await getInitialStatsState(String(ctx.from.id)),
    );
    await replaceWithStats(ctx, result);
  });

  bot.callbackQuery(STATS_PATTERN, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const state = decodeStatsState(ctx.match as RegExpMatchArray);
    if (state.converted) {
      await registerUser(String(ctx.from.id), ctx.from.username);
      await setPreferredCurrency(String(ctx.from.id), state.currency);
    }
    const result = await renderStats(String(ctx.from.id), state);
    await updateStats(ctx, result);
  });

  bot.callbackQuery(STATS_CLOSE_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
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

  bot.callbackQuery(ARCHIVE_MENU_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = renderArchiveTypePicker();
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(BACK_TO_CATEGORIES_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const { text, keyboard } = await renderCategories(String(ctx.from.id));
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(ARCHIVE_TYPE_PATTERN, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const type = ctx.match[1] as 'expense' | 'income';
    const { text, keyboard } = await renderArchiveCategoryPicker(String(ctx.from.id), type);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(ARCHIVE_ID_PATTERN, async (ctx) => {
    if (!ctx.from) return;
    const categoryId = Number(ctx.match[1]);
    const { text, keyboard } = await handleArchive(String(ctx.from.id), categoryId);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(CALLBACKS.menuExport, async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = renderExportMenu();
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
  });

  bot.callbackQuery(EXPORT_PATTERN, async (ctx) => {
    if (!ctx.from) return;
    const period = decodeExportPeriod(ctx.match as RegExpMatchArray);
    await ctx.answerCallbackQuery({ text: 'Готовлю файл…' });
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
    await sendExport(ctx, String(ctx.from.id), period);
  });

  bot.callbackQuery(EXPORT_CLOSE_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
  });

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
