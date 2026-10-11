import { tr } from '../../lib/i18n/index.js';
import { logTelegramFailure } from '../logging.js';
import { sectionKeyboard } from './menu.js';
import { getPreferredCurrency } from '../../lib/services/users.js';
import { InlineKeyboard, InputFile, type Context } from 'grammy';
import { currencyType, type Currency, type OperationType } from '../../db/schema.js';
import { BUTTONS, CALLBACKS, OPERATION_TYPE_LABELS } from '../../lib/constants/index.js';
import {
  getCategoryBreakdown,
  getConvertedStats,
  getSummary,
} from '../../lib/services/transactions.js';
import { renderPieChart } from '../../lib/utils/chart.js';
import { formatAmount } from '../../lib/utils/money.js';
import { getPeriodStart, PERIOD_LABELS, type Period } from '../../lib/utils/period.js';

export interface StatsState {
  period: Period;
  currency: Currency;
  converted: boolean;
  /** Тип операций, для которого строится разбивка по категориям на графике. */
  type: OperationType;
}

export const DEFAULT_STATS_STATE: StatsState = {
  period: 'month',
  type: 'expense',
  currency: 'RUB',
  converted: true,
};

const PERIOD_CODES: Record<Period, string> = { all: 'a', week: 'w', month: 'm' };
const PERIOD_FROM_CODE: Record<string, Period> = { a: 'all', w: 'week', m: 'month' };
const TYPE_CODES: Record<OperationType, string> = { expense: 'e', income: 'i' };
const TYPE_FROM_CODE: Record<string, OperationType> = { e: 'expense', i: 'income' };

export const STATS_PATTERN = /^st:(a|w|m):(e|i)(?::(RUB|USD|EUR|RSD))?(?::(all|one))?$/;
export const STATS_CLOSE_CALLBACK = 'st:close';

export function encodeStatsState(state: StatsState): string {
  return `st:${PERIOD_CODES[state.period]}:${TYPE_CODES[state.type]}:${state.currency}:${state.converted ? 'all' : 'one'}`;
}

export function decodeStatsState(match: RegExpMatchArray): StatsState {
  return {
    period: PERIOD_FROM_CODE[match[1]!]!,
    type: TYPE_FROM_CODE[match[2]!]!,
    currency: (match[3] ?? 'RUB') as Currency,
    converted: match[4] === 'all',
  };
}

export interface StatsResult {
  caption: string;
  photo?: Buffer;
  keyboard: InlineKeyboard;
}

/** Считает сводку и разбивку по категориям, формирует подпись, график (если есть данные) и клавиатуру. */
export async function renderStats(
  userId: string,
  state: StatsState,
  fromMenu = true,
): Promise<StatsResult> {
  const from = getPeriodStart(state.period);
  const periodLabel = PERIOD_LABELS[state.period];
  const data = state.converted
    ? await getConvertedStats(userId, state.type, state.currency, from)
    : {
        summary: await getSummary(userId, from, state.currency),
        breakdown: await getCategoryBreakdown(userId, state.type, from, state.currency),
        missingRates: 0,
        estimatedRates: 0,
      };
  const { summary } = data;
  // Never present an incomplete total as an overall balance.
  const incomplete = data.missingRates > 0;
  const breakdown = incomplete ? [] : data.breakdown;

  const balance = summary.income - summary.expense;
  const balanceSign = balance > 0 ? '+' : '';

  const lines = [
    tr('stats-message-2', {
      v0: periodLabel,
      v1: state.converted ? tr('stats-message-1') : '',
      v2: state.currency,
    }),
    '',
    tr('stats-message-3', { v0: formatAmount(summary.income), v1: state.currency }),
    tr('stats-message-4', { v0: formatAmount(summary.expense), v1: state.currency }),
    tr('stats-message-5', { v0: balanceSign, v1: formatAmount(balance), v2: state.currency }),
  ];

  if (state.converted && !incomplete) {
    lines.push('', tr('stats-message-6'));
    if (data.estimatedRates) lines.push(tr('stats-message-7', { v0: data.estimatedRates }));
  }
  if (incomplete) {
    lines.splice(2);
    lines.push(tr('stats-message-8', { v0: data.missingRates }), tr('stats-message-9'));
    for (const currency of currencyType.enumValues) {
      const original = await getSummary(userId, from, currency);
      if (original.income || original.expense)
        lines.push(
          tr('stats-message-10', {
            v0: currency,
            v1: formatAmount(original.income),
            v2: formatAmount(original.expense),
          }),
        );
    }
    lines.push(tr('stats-message-11'));
  }

  if (breakdown.length > 0) {
    lines.push('', tr('stats-message-12', { v0: OPERATION_TYPE_LABELS[state.type].toLowerCase() }));
    for (const item of breakdown) {
      lines.push(`• ${item.categoryName}: ${formatAmount(item.total)} ${state.currency}`);
    }
  } else if (!incomplete) {
    lines.push('', tr('stats-message-13', { v0: OPERATION_TYPE_LABELS[state.type].toLowerCase() }));
  }

  const keyboard = new InlineKeyboard();
  (['week', 'month', 'all'] as const).forEach((period) => {
    const label = (period === state.period ? '✓ ' : '') + PERIOD_LABELS[period];
    keyboard.text(label, encodeStatsState({ ...state, period }));
  });
  keyboard.row();
  (['expense', 'income'] as const).forEach((type) => {
    const label = (type === state.type ? '✓ ' : '') + OPERATION_TYPE_LABELS[type];
    keyboard.text(label, encodeStatsState({ ...state, type }));
  });
  keyboard.row();
  for (const currency of currencyType.enumValues)
    keyboard.text(
      (currency === state.currency ? '✓ ' : '') + currency,
      encodeStatsState({ ...state, currency }),
    );
  keyboard.row();
  keyboard
    .text(
      (state.converted ? '✓ ' : '') + tr('stats-message-14'),
      encodeStatsState({ ...state, converted: true }),
    )
    .text(
      (!state.converted ? '✓ ' : '') + tr('stats-message-15'),
      encodeStatsState({ ...state, converted: false }),
    )
    .row();
  keyboard.text(BUTTONS.backToMenu, CALLBACKS.menuBack).row();
  keyboard.text(tr('categories-message-7'), STATS_CLOSE_CALLBACK);

  const navigationKeyboard = sectionKeyboard(keyboard, fromMenu);
  const caption = lines.join('\n');
  if (breakdown.length === 0) {
    return { caption, keyboard: navigationKeyboard };
  }

  const photo = await renderPieChart(
    tr('stats-message-16', {
      v0: OPERATION_TYPE_LABELS[state.type],
      v1: periodLabel,
      v2: state.currency,
    }),
    breakdown.map((b) => ({ label: b.categoryName, value: b.total })),
  );
  return { caption, photo, keyboard: navigationKeyboard };
}

/** Отправляет новое сообщение со статистикой (фото+подпись либо просто текст). */
export async function sendStats(ctx: Context, result: StatsResult): Promise<void> {
  if (result.photo) {
    await ctx.replyWithPhoto(new InputFile(result.photo), {
      caption: result.caption,
      reply_markup: result.keyboard,
    });
  } else {
    await ctx.reply(result.caption, { reply_markup: result.keyboard });
  }
}

/** Удаляет текущее сообщение (например, экран /menu) и отправляет статистику заново. */
export async function replaceWithStats(ctx: Context, result: StatsResult): Promise<void> {
  await ctx.deleteMessage().catch(logTelegramFailure(ctx, 'deleteMessage'));
  await sendStats(ctx, result);
}

/**
 * Обновляет уже показанный экран статистики. Между фото и текстом Telegram не даёт
 * редактировать сообщение "на лету" — в этом случае старое сообщение удаляется и шлётся новое.
 */
export async function updateStats(ctx: Context, result: StatsResult): Promise<void> {
  const message = ctx.callbackQuery?.message;
  const isCurrentPhoto = Boolean(message && 'photo' in message && message.photo?.length);

  if (result.photo) {
    if (!isCurrentPhoto) {
      await replaceWithStats(ctx, result);
      return;
    }
    await ctx.editMessageMedia(
      { type: 'photo', media: new InputFile(result.photo), caption: result.caption },
      { reply_markup: result.keyboard },
    );
    return;
  }

  if (isCurrentPhoto) {
    await replaceWithStats(ctx, result);
    return;
  }
  await ctx
    .editMessageText(result.caption, { reply_markup: result.keyboard })
    .catch(logTelegramFailure(ctx, 'editMessageText'));
}

export async function getInitialStatsState(userId: string): Promise<StatsState> {
  return { ...DEFAULT_STATS_STATE, currency: await getPreferredCurrency(userId) };
}
