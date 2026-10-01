import { InlineKeyboard } from 'grammy';
import type { OperationType } from '../../db/schema.js';
import { OPERATION_TYPE_EMOJI, OPERATION_TYPE_LABELS } from '../../lib/constants/index.js';
import { getActiveCategories, getCategoryById } from '../../lib/services/categories.js';
import { listTransactions } from '../../lib/services/transactions.js';
import { formatDate } from '../../lib/utils/date.js';
import { formatAmount } from '../../lib/utils/money.js';
import { getPeriodStart, PERIOD_LABELS, type Period } from '../../lib/utils/period.js';

const PAGE_SIZE = 5;

type TypeFilter = 'all' | OperationType;

export interface HistoryState {
  type: TypeFilter;
  period: Period;
  /** 0 — без фильтра по категории */
  categoryId: number;
  page: number;
}

export const DEFAULT_HISTORY_STATE: HistoryState = {
  type: 'all',
  period: 'month',
  categoryId: 0,
  page: 0,
};

const TYPE_CODES: Record<TypeFilter, string> = { all: 'a', expense: 'e', income: 'i' };
const TYPE_FROM_CODE: Record<string, TypeFilter> = { a: 'all', e: 'expense', i: 'income' };
const PERIOD_CODES: Record<Period, string> = { all: 'a', week: 'w', month: 'm' };
const PERIOD_FROM_CODE: Record<string, Period> = { a: 'all', w: 'week', m: 'month' };

export const HISTORY_PATTERN = /^h:(a|e|i):(a|w|m):(\d+):(\d+)$/;
export const HISTORY_CATEGORY_MENU_PATTERN = /^hcat:(a|e|i):(a|w|m):(\d+):(\d+)$/;
export const HISTORY_NOOP_CALLBACK = 'h:noop';
export const HISTORY_CLOSE_CALLBACK = 'h:close';

export function encodeHistoryState(state: HistoryState): string {
  return `h:${TYPE_CODES[state.type]}:${PERIOD_CODES[state.period]}:${state.categoryId}:${state.page}`;
}

export function decodeHistoryState(match: RegExpMatchArray): HistoryState {
  return {
    type: TYPE_FROM_CODE[match[1]!]!,
    period: PERIOD_FROM_CODE[match[2]!]!,
    categoryId: Number(match[3]),
    page: Number(match[4]),
  };
}

/** Текст и клавиатура экрана истории операций. */
export async function renderHistory(
  userId: string,
  state: HistoryState,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const from = getPeriodStart(state.period);
  const filters = {
    ...(state.type !== 'all' ? { type: state.type } : {}),
    ...(state.categoryId ? { categoryId: state.categoryId } : {}),
    ...(from ? { from } : {}),
  };

  const { items, total } = await listTransactions(userId, filters, {
    limit: PAGE_SIZE,
    offset: state.page * PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const categoryLabel = state.categoryId
    ? ((await getCategoryById(userId, state.categoryId))?.name ?? 'Все категории')
    : 'Все категории';

  const lines = items.length
    ? items.map((t) => {
        const sign = t.type === 'expense' ? '−' : '+';
        const comment = t.comment ? ` — ${t.comment}` : '';
        return `${OPERATION_TYPE_EMOJI[t.type]} ${sign}${formatAmount(t.amount)} ${t.currency} · ${t.categoryName ?? 'Без категории'}${comment}\n   ${formatDate(t.createdAt)}`;
      })
    : ['Операций не найдено.'];

  const text = [
    '📜 История операций',
    '',
    `Тип: ${state.type === 'all' ? 'Все' : OPERATION_TYPE_LABELS[state.type]} · Период: ${PERIOD_LABELS[state.period]} · Категория: ${categoryLabel}`,
    `Стр. ${state.page + 1}/${totalPages} · всего операций: ${total}`,
    '',
    ...lines,
  ].join('\n');

  const keyboard = new InlineKeyboard();
  for (const item of items)
    keyboard
      .text(
        `✏️ ${formatAmount(item.amount)} ${item.currency} · ${item.categoryName}`,
        `edit:${item.id}`,
      )
      .row();

  (['all', 'expense', 'income'] as const).forEach((type) => {
    const label =
      (type === state.type ? '✓ ' : '') + (type === 'all' ? 'Все' : OPERATION_TYPE_LABELS[type]);
    keyboard.text(label, encodeHistoryState({ ...state, type, categoryId: 0, page: 0 }));
  });
  keyboard.row();

  (['week', 'month', 'all'] as const).forEach((period) => {
    const label = (period === state.period ? '✓ ' : '') + PERIOD_LABELS[period];
    keyboard.text(label, encodeHistoryState({ ...state, period, page: 0 }));
  });
  keyboard.row();

  keyboard
    .text(
      `🗂 ${categoryLabel}`,
      `hcat:${TYPE_CODES[state.type]}:${PERIOD_CODES[state.period]}:${state.categoryId}:${state.page}`,
    )
    .row();

  if (state.page > 0) keyboard.text('◀️', encodeHistoryState({ ...state, page: state.page - 1 }));
  keyboard.text(`${state.page + 1}/${totalPages}`, HISTORY_NOOP_CALLBACK);
  if (state.page + 1 < totalPages)
    keyboard.text('▶️', encodeHistoryState({ ...state, page: state.page + 1 }));
  keyboard.row();

  keyboard.text('❌ Закрыть', HISTORY_CLOSE_CALLBACK);

  return { text, keyboard };
}

/** Экран выбора категории для фильтра истории. */
export async function renderHistoryCategoryMenu(
  userId: string,
  state: HistoryState,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const list =
    state.type === 'all'
      ? await getActiveCategories(userId)
      : await getActiveCategories(userId, state.type);

  const keyboard = new InlineKeyboard();
  keyboard.text('Все категории', encodeHistoryState({ ...state, categoryId: 0, page: 0 })).row();
  list.forEach((category, i) => {
    keyboard.text(
      category.name,
      encodeHistoryState({ ...state, categoryId: category.id, page: 0 }),
    );
    if (i % 2 === 1) keyboard.row();
  });
  if (list.length % 2 === 1) keyboard.row();
  keyboard.text('◀️ Назад', encodeHistoryState(state));

  return { text: 'Выбери категорию для фильтра:', keyboard };
}
