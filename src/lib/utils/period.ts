export type Period = 'week' | 'month' | 'all';

export const PERIOD_LABELS: Record<Period, string> = {
  week: 'Неделя',
  month: 'Месяц',
  all: 'Всё время',
};

/** Начало периода (скользящее окно от текущего момента). undefined — без ограничения. */
export function getPeriodStart(period: Period): Date | undefined {
  if (period === 'all') return undefined;
  const days = period === 'week' ? 7 : 30;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}
