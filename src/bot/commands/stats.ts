import { InlineKeyboard, InputFile, type Context } from 'grammy';
import type { OperationType } from '../../db/schema.js';
import { OPERATION_TYPE_LABELS } from '../../lib/constants/index.js';
import { getCategoryBreakdown, getSummary } from '../../lib/services/transactions.js';
import { renderPieChart } from '../../lib/utils/chart.js';
import { formatAmount } from '../../lib/utils/money.js';
import { getPeriodStart, PERIOD_LABELS, type Period } from '../../lib/utils/period.js';

export interface StatsState {
  period: Period;
  /** Тип операций, для которого строится разбивка по категориям на графике. */
  type: OperationType;
}

export const DEFAULT_STATS_STATE: StatsState = { period: 'month', type: 'expense' };

const PERIOD_CODES: Record<Period, string> = { all: 'a', week: 'w', month: 'm' };
const PERIOD_FROM_CODE: Record<string, Period> = { a: 'all', w: 'week', m: 'month' };
const TYPE_CODES: Record<OperationType, string> = { expense: 'e', income: 'i' };
const TYPE_FROM_CODE: Record<string, OperationType> = { e: 'expense', i: 'income' };

export const STATS_PATTERN = /^st:(a|w|m):(e|i)$/;
export const STATS_CLOSE_CALLBACK = 'st:close';

export function encodeStatsState(state: StatsState): string {
  return `st:${PERIOD_CODES[state.period]}:${TYPE_CODES[state.type]}`;
}

export function decodeStatsState(match: RegExpMatchArray): StatsState {
  return { period: PERIOD_FROM_CODE[match[1]!]!, type: TYPE_FROM_CODE[match[2]!]! };
}

export interface StatsResult {
  caption: string;
  photo?: Buffer;
  keyboard: InlineKeyboard;
}

/** Считает сводку и разбивку по категориям, формирует подпись, график (если есть данные) и клавиатуру. */
export async function renderStats(userId: string, state: StatsState): Promise<StatsResult> {
  const from = getPeriodStart(state.period);
  const [summary, breakdown] = await Promise.all([
    getSummary(userId, from),
    getCategoryBreakdown(userId, state.type, from),
  ]);

  const balance = summary.income - summary.expense;
  const balanceSign = balance > 0 ? '+' : '';

  const lines = [
    `📊 Статистика · ${PERIOD_LABELS[state.period]}`,
    '',
    `📈 Доход: ${formatAmount(summary.income)} ₽`,
    `📉 Расход: ${formatAmount(summary.expense)} ₽`,
    `💰 Баланс: ${balanceSign}${formatAmount(balance)} ₽`,
  ];

  if (breakdown.length > 0) {
    lines.push('', `Разбивка по категориям (${OPERATION_TYPE_LABELS[state.type].toLowerCase()}):`);
    for (const item of breakdown) {
      lines.push(`• ${item.categoryName}: ${formatAmount(item.total)} ₽`);
    }
  } else {
    lines.push('', `Нет операций типа «${OPERATION_TYPE_LABELS[state.type].toLowerCase()}» за этот период.`);
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
  keyboard.text('❌ Закрыть', STATS_CLOSE_CALLBACK);

  const caption = lines.join('\n');
  if (breakdown.length === 0) {
    return { caption, keyboard };
  }

  const photo = await renderPieChart(
    `${OPERATION_TYPE_LABELS[state.type]} по категориям · ${PERIOD_LABELS[state.period]}`,
    breakdown.map((b) => ({ label: b.categoryName, value: b.total })),
  );
  return { caption, photo, keyboard };
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
  await ctx.deleteMessage().catch(() => {});
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
  await ctx.editMessageText(result.caption, { reply_markup: result.keyboard }).catch(() => {});
}
