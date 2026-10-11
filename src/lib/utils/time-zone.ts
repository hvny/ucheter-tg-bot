/** IANA zones preserve daylight-saving changes, unlike fixed UTC offsets. */
export const TIME_ZONES = ['UTC', ...Intl.supportedValuesOf('timeZone')];
const formatters = new Map<string, Intl.DateTimeFormat>();
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}
export function localClock(
  now: Date,
  zone: string,
): { date: string; hour: number; minute: number } {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}
/** Finds the first instant of a local calendar day, including DST midnight changes. */
function dayBoundary(date: string, zone: string): Date {
  const center = Date.parse(`${date}T00:00:00Z`);
  let low = center - 36 * 3600_000;
  let high = center + 36 * 3600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localClock(new Date(middle), zone).date < date) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
}
export function localDayWindow(date: string, zone: string): { from: Date; to: Date } {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    !isTimeZone(zone)
  )
    throw new Error('Invalid local day');
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return {
    from: dayBoundary(date, zone),
    to: dayBoundary(parsed.toISOString().slice(0, 10), zone),
  };
}
export function isNotificationTime(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < 1440;
}
export function formatNotificationTime(value = 1200): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
export function dailyIsDue(now: Date, zone: string, time = 1200): boolean {
  if (!isNotificationTime(time)) return false;
  const clock = localClock(now, zone);
  return clock.hour * 60 + clock.minute >= time;
}
