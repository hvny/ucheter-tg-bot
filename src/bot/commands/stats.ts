import { logTelegramFailure } from '../logging.js';
import { sectionKeyboard } from './menu.js';
import { getLatestRates } from '../../lib/services/exchange.js';
import { getPreferredCurrency } from '../../lib/services/users.js';
import { formatDate } from '../../lib/utils/date.js';
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
  const snapshot = state.converted ? await getLatestRates() : undefined;
  const data =
    state.converted && snapshot
      ? await getConvertedStats(userId, state.type, state.currency, snapshot.rates, from)
      : {
          summary: await getSummary(userId, from, state.currency),
          breakdown: await getCategoryBreakdown(userId, state.type, from, state.currency),
        };
  const { summary } = data;
  const breakdown = state.converted && !snapshot ? [] : data.breakdown;

  const balance = summary.income - summary.expense;
  const balanceSign = balance > 0 ? '+' : '';

  const lines = [
    `📊 Статистика · ${PERIOD_LABELS[state.period]} · ${state.converted ? 'Все валюты → ' : ''}${state.currency}`,
    '',
    `📈 Доход: ${formatAmount(summary.income)} ${state.currency}`,
    `📉 Расход: ${formatAmount(summary.expense)} ${state.currency}`,
    `💰 Баланс: ${balanceSign}${formatAmount(balance)} ${state.currency}`,
  ];

  if (state.converted && snapshot) {
    lines.push('', `По курсам от ${formatDate(snapshot.rateAt)} · ExchangeRate-API`);
    if (Date.now() > snapshot.nextUpdateAt.getTime())
      lines.push('Обновление курсов задерживается; использованы последние сохранённые.');
  }
  if (state.converted && !snapshot) {
    lines.splice(2);
    lines.push('Курсы ещё не загружены. Общий итог пока недоступен.', 'Суммы без пересчёта:');
    for (const currency of currencyType.enumValues) {
      const original = await getSummary(userId, from, currency);
      if (original.income || original.expense)
        lines.push(
          `${currency}: доход ${formatAmount(original.income)}, расход ${formatAmount(original.expense)}`,
        );
    }
    lines.push('Можно переключиться на «Одна валюта».');
  }

  if (breakdown.length > 0) {
    lines.push('', `Разбивка по категориям (${OPERATION_TYPE_LABELS[state.type].toLowerCase()}):`);
    for (const item of breakdown) {
      lines.push(`• ${item.categoryName}: ${formatAmount(item.total)} ${state.currency}`);
    }
  } else if (!state.converted || snapshot) {
    lines.push(
      '',
      `Нет операций типа «${OPERATION_TYPE_LABELS[state.type].toLowerCase()}» за этот период.`,
    );
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
      (state.converted ? '✓ ' : '') + 'Все валюты',
      encodeStatsState({ ...state, converted: true }),
    )
    .text(
      (!state.converted ? '✓ ' : '') + 'Одна валюта',
      encodeStatsState({ ...state, converted: false }),
    )
    .row();
  keyboard.text(BUTTONS.backToMenu, CALLBACKS.menuBack).row();
  keyboard.text('❌ Закрыть', STATS_CLOSE_CALLBACK);

  const navigationKeyboard = sectionKeyboard(keyboard, fromMenu);
  const caption = lines.join('\n');
  if (breakdown.length === 0) {
    return { caption, keyboard: navigationKeyboard };
  }

  const photo = await renderPieChart(
    `${OPERATION_TYPE_LABELS[state.type]} по категориям · ${PERIOD_LABELS[state.period]} · ${state.currency}`,
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
