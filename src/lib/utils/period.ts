import { tr } from '../i18n/index.js';
export type Period = 'week' | 'month' | 'all';

export const PERIOD_LABELS: Record<Period, string> = {
  get week() {
    return tr('period-message-1');
  },
  get month() {
    return tr('period-message-2');
  },
  get all() {
    return tr('period-message-3');
  },
};

/** Начало периода (скользящее окно от текущего момента). undefined — без ограничения. */
export function getPeriodStart(period: Period): Date | undefined {
  if (period === 'all') return undefined;
  const days = period === 'week' ? 7 : 30;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}
