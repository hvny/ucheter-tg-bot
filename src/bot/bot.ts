import { handleAbout } from './commands/about.js';
import { chooseLanguage, showLanguagePicker } from './commands/language.js';
import {
  i18n,
  withLanguage,
  normalizeLanguage,
  parseLanguagePayload,
  type LocalizedContext,
  type Language,
  tr,
} from '../lib/i18n/index.js';
import { logger } from '../lib/logging/logger.js';
import { updateKind } from './logging.js';
import { logTelegramFailure } from './logging.js';
import { getUserLanguage, registerUser, setPreferredCurrency } from '../lib/services/users.js';
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
import {
  menuText,
  menuKeyboard,
  returnToMenu,
  backToMenuKeyboard,
  cameFromMenu,
} from './commands/menu.js';
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

export type BotContext = ConversationFlavor<LocalizedContext>;

export function createBot(token: string): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  bot.use(async (ctx, next) => {
    const started = performance.now();
    const fields = { updateId: ctx.update.update_id, action: updateKind(ctx) };
    logger.debug({ ...fields, event: 'bot.update.received' }, 'Получено обновление');
    try {
      await next();
      logger.info(
        {
          ...fields,
          event: 'bot.update.completed',
          durationMs: Math.round(performance.now() - started),
        },
        'Обновление обработано',
      );
    } catch (error) {
      logger.error(
        {
          ...fields,
          event: 'bot.update.failed',
          durationMs: Math.round(performance.now() - started),
          err: error,
        },
        'Ошибка обработки обновления',
      );
      throw error;
    }
  });
  bot.use(async (ctx, next) => {
    const stored = ctx.from ? await getUserLanguage(String(ctx.from.id)) : undefined;
    const startPayload =
      ctx.message?.text?.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/)?.[1] ?? '';
    const explicit = parseLanguagePayload(startPayload);
    const choice = ctx.callbackQuery?.data?.match(/^language:(ru|en)$/)?.[1] as
      Language | undefined;
    const language = explicit ?? choice ?? stored ?? normalizeLanguage(ctx.from?.language_code);
    await withLanguage(language, next);
  });
  bot.use(i18n);
  // Informational command stays available without cancelling an active conversation.
  bot.command('about', handleAbout);
  bot.use(conversations());
  bot.use(createConversation(addOperation));
  bot.use(createConversation(addCategory));
  bot.use(createConversation(editOperation));

  bot.callbackQuery(EDIT_PATTERN, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('editOperation');
  });

  bot.command('start', async (ctx) => {
    await ctx.conversation.exitAll();
    await handleStart(ctx);
  });

  bot.command('language', async (ctx) => {
    await ctx.conversation.exitAll();
    await showLanguagePicker(ctx);
  });
  bot.callbackQuery('menu:language', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showLanguagePicker(ctx, true);
  });
  bot.callbackQuery(/^language:(ru|en)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await chooseLanguage(ctx, ctx.match[1] as Language);
  });

  bot.command('menu', async (ctx) => {
    await ctx.reply(menuText(), { reply_markup: menuKeyboard() });
  });

  bot.command('add', async (ctx) => {
    await ctx.conversation.enter('addOperation');
  });

  bot.command('history', async (ctx) => {
    if (!ctx.from) return;
    const { text, keyboard } = await renderHistory(
      String(ctx.from.id),
      DEFAULT_HISTORY_STATE,
      cameFromMenu(ctx),
    );
    await ctx.reply(text, { reply_markup: keyboard });
  });

  bot.command('stats', async (ctx) => {
    if (!ctx.from) return;
    const result = await renderStats(
      String(ctx.from.id),
      await getInitialStatsState(String(ctx.from.id)),
      cameFromMenu(ctx),
    );
    await sendStats(ctx, result);
  });

  bot.command('export', async (ctx) => {
    const { text, keyboard } = renderExportMenu(cameFromMenu(ctx));
    await ctx.reply(text, { reply_markup: keyboard });
  });

  bot.command('categories', async (ctx) => {
    if (!ctx.from) return;
    const { text, keyboard } = await renderCategories(String(ctx.from.id), cameFromMenu(ctx));
    await ctx.reply(text, { reply_markup: keyboard });
  });

  // /cancel вне диалога (внутри диалога его перехватывает сам диалог)
  bot.command('cancel', async (ctx) => {
    await ctx.conversation.exitAll();
    await ctx.reply(tr('bot-message-1'));
  });

  bot.callbackQuery(CALLBACKS.menuBack, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.exitAll();
    await returnToMenu(ctx);
  });

  // кнопки меню
  bot.callbackQuery(CALLBACKS.menuAdd, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('addOperation');
  });

  bot.callbackQuery(CALLBACKS.menuHistory, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const { text, keyboard } = await renderHistory(
      String(ctx.from.id),
      DEFAULT_HISTORY_STATE,
      cameFromMenu(ctx),
    );
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(logTelegramFailure(ctx, 'editMessageText'));
  });

  bot.callbackQuery(HISTORY_PATTERN, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const state = decodeHistoryState(ctx.match as RegExpMatchArray);
    const { text, keyboard } = await renderHistory(String(ctx.from.id), state, cameFromMenu(ctx));
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(logTelegramFailure(ctx, 'editMessageText'));
  });

  bot.callbackQuery(HISTORY_CATEGORY_MENU_PATTERN, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const state = decodeHistoryState(ctx.match as RegExpMatchArray);
    const { text, keyboard } = await renderHistoryCategoryMenu(
      String(ctx.from.id),
      state,
      cameFromMenu(ctx),
    );
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(logTelegramFailure(ctx, 'editMessageText'));
  });

  bot.callbackQuery(HISTORY_NOOP_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(HISTORY_CLOSE_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(logTelegramFailure(ctx, 'deleteMessage'));
  });

  bot.callbackQuery(CALLBACKS.menuStats, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const result = await renderStats(
      String(ctx.from.id),
      await getInitialStatsState(String(ctx.from.id)),
      cameFromMenu(ctx),
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
    const result = await renderStats(String(ctx.from.id), state, cameFromMenu(ctx));
    await updateStats(ctx, result);
  });

  bot.callbackQuery(STATS_CLOSE_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(logTelegramFailure(ctx, 'deleteMessage'));
  });

  bot.callbackQuery(CALLBACKS.menuCategories, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const { text, keyboard } = await renderCategories(String(ctx.from.id), cameFromMenu(ctx));
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(logTelegramFailure(ctx, 'editMessageText'));
  });

  bot.callbackQuery(ADD_CATEGORY_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('addCategory');
  });

  bot.callbackQuery(ARCHIVE_MENU_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = renderArchiveTypePicker(cameFromMenu(ctx));
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(logTelegramFailure(ctx, 'editMessageText'));
  });

  bot.callbackQuery(BACK_TO_CATEGORIES_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const { text, keyboard } = await renderCategories(String(ctx.from.id), cameFromMenu(ctx));
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(logTelegramFailure(ctx, 'editMessageText'));
  });

  bot.callbackQuery(ARCHIVE_TYPE_PATTERN, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const type = ctx.match[1] as 'expense' | 'income';
    const { text, keyboard } = await renderArchiveCategoryPicker(
      String(ctx.from.id),
      type,
      cameFromMenu(ctx),
    );
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(logTelegramFailure(ctx, 'editMessageText'));
  });

  bot.callbackQuery(ARCHIVE_ID_PATTERN, async (ctx) => {
    if (!ctx.from) return;
    const categoryId = Number(ctx.match[1]);
    const { text, keyboard } = await handleArchive(
      String(ctx.from.id),
      categoryId,
      cameFromMenu(ctx),
    );
    await ctx.answerCallbackQuery();
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(logTelegramFailure(ctx, 'editMessageText'));
  });

  bot.callbackQuery(CALLBACKS.menuExport, async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = renderExportMenu(cameFromMenu(ctx));
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(logTelegramFailure(ctx, 'editMessageText'));
  });

  bot.callbackQuery(EXPORT_PATTERN, async (ctx) => {
    if (!ctx.from) return;
    const fromMenu = cameFromMenu(ctx);
    const period = decodeExportPeriod(ctx.match as RegExpMatchArray);
    await ctx.answerCallbackQuery({ text: tr('bot-message-2') });
    await ctx
      .editMessageReplyMarkup({
        reply_markup: fromMenu
          ? backToMenuKeyboard()
          : new InlineKeyboard().text(tr('categories-message-7'), EXPORT_CLOSE_CALLBACK),
      })
      .catch(logTelegramFailure(ctx, 'editMessageReplyMarkup'));
    await sendExport(ctx, String(ctx.from.id), period, fromMenu);
  });

  bot.callbackQuery(EXPORT_CLOSE_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(logTelegramFailure(ctx, 'deleteMessage'));
  });

  bot.callbackQuery('section:close', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(logTelegramFailure(ctx, 'deleteMessage'));
  });

  // просроченные кнопки отменённых диалогов
  bot.callbackQuery(CALLBACKS.cancel, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx
      .editMessageReplyMarkup({ reply_markup: new InlineKeyboard() })
      .catch(logTelegramFailure(ctx, 'editMessageReplyMarkup'));
  });

  bot.catch((err) => {
    logger.debug(
      { event: 'bot.error.handled', updateId: err.ctx.update.update_id },
      'Ошибка передана обработчику бота',
    );
  });

  return bot;
}
