import { InlineKeyboard, type Context } from 'grammy';
import { tr } from '../../lib/i18n/index.js';
import {
  TIME_ZONES,
  isTimeZone,
  localDayWindow,
  formatNotificationTime,
} from '../../lib/utils/time-zone.js';
import {
  getNotificationSettings,
  setNotifications,
  setNotificationTime,
  getDailyDelivery,
} from '../../lib/services/notifications.js';
import { registerUser } from '../../lib/services/users.js';
import { BUTTONS, CALLBACKS } from '../../lib/constants/index.js';
import type { Currency, OperationType } from '../../db/schema.js';
import { cameFromMenu, sectionKeyboard } from './menu.js';
import { getInitialStatsState, renderStats, sendStats, updateStats } from './stats.js';

const POPULAR = [
  'Europe/Belgrade',
  'Europe/Moscow',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Yerevan',
  'Asia/Tbilisi',
  'Asia/Almaty',
  'Asia/Bangkok',
  'America/New_York',
  'UTC',
];
const ZONES = [...new Set([...POPULAR, ...TIME_ZONES])];
const PAGE_SIZE = 12;
export async function showNotifications(ctx: Context, edit = false): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== 'private') {
    await ctx.reply(tr('daily-private'));
    return;
  }
  await registerUser(String(ctx.from.id), ctx.from.username);
  const user = await getNotificationSettings(String(ctx.from.id));
  const text = tr('daily-settings', {
    v0: tr(user?.dailyNotifications ? 'daily-enabled' : 'daily-disabled'),
    v1: user?.timeZone ?? tr('daily-unset'),
    v2: formatNotificationTime(user?.notificationTime),
  });
  const keyboard = new InlineKeyboard()
    .text(
      tr(user?.dailyNotifications ? 'daily-disable' : 'daily-enable'),
      user?.dailyNotifications ? 'daily:off' : 'daily:on',
    )
    .row()
    .text(tr('daily-time-button'), 'notifications:time')
    .row()
    .text(tr('daily-zone'), 'notifications:zones:0')
    .row()
    .text(BUTTONS.backToMenu, CALLBACKS.menuBack);
  const navigation = sectionKeyboard(keyboard, cameFromMenu(ctx));
  if (edit && ctx.callbackQuery?.message && 'text' in ctx.callbackQuery.message)
    await ctx.editMessageText(text, { reply_markup: navigation });
  else await ctx.reply(text, { reply_markup: navigation });
}
export async function showTimeZones(ctx: Context, requested = 0): Promise<void> {
  const pages = Math.ceil(ZONES.length / PAGE_SIZE);
  const page = Math.min(pages - 1, Math.max(0, requested));
  const keyboard = new InlineKeyboard();
  for (const zone of ZONES.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE))
    keyboard.text(zone.replaceAll('_', ' '), `notifications:zone:${zone}`).row();
  if (page > 0) keyboard.text('←', `notifications:zones:${page - 1}`);
  if (page < pages - 1) keyboard.text('→', `notifications:zones:${page + 1}`);
  keyboard.row().text(tr('daily-back'), 'notifications:settings');
  if (cameFromMenu(ctx)) keyboard.row().text(BUTTONS.backToMenu, CALLBACKS.menuBack);
  await ctx.editMessageText(tr('daily-zones-title', { v0: page + 1, v1: pages }), {
    reply_markup: keyboard,
  });
}
export async function handleNotificationAction(ctx: Context): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== 'private') {
    await ctx.reply(tr('daily-private'));
    return;
  }
  const data = ctx.callbackQuery?.data ?? '';
  await registerUser(String(ctx.from.id), ctx.from.username);
  if (data === 'notifications:time') {
    await showNotificationHours(ctx);
    return;
  }
  const minutes = /^notifications:minutes:(\d{1,2})(?::([0-2]))?$/.exec(data);
  if (minutes) {
    const hour = Number(minutes[1]);
    if (hour > 23) {
      await ctx.reply(tr('daily-invalid'));
      return;
    }
    await showNotificationMinutes(ctx, hour, Number(minutes[2] ?? 0));
    return;
  }
  const time = /^notifications:time:(\d{2}):(\d{2})$/.exec(data);
  if (time) {
    const hour = Number(time[1]),
      minute = Number(time[2]);
    if (hour > 23 || minute > 59) {
      await ctx.reply(tr('daily-invalid'));
      return;
    }
    await setNotificationTime(String(ctx.from.id), hour * 60 + minute);
    await showNotifications(ctx, true);
    return;
  }
  if (data.startsWith('notifications:zones:')) {
    await showTimeZones(ctx, Number(data.split(':')[2]) || 0);
    return;
  }
  if (data.startsWith('notifications:zone:')) {
    const zone = data.slice('notifications:zone:'.length);
    if (!isTimeZone(zone)) {
      await ctx.reply(tr('daily-invalid'));
      return;
    }
    await setNotifications(String(ctx.from.id), true, zone);
  } else if (data === 'daily:off') {
    await setNotifications(String(ctx.from.id), false);
  } else if (data === 'daily:on') {
    const user = await getNotificationSettings(String(ctx.from.id));
    if (!user?.timeZone) {
      await showTimeZones(ctx);
      return;
    }
    await setNotifications(String(ctx.from.id), true);
  }
  await showNotifications(ctx, true);
}
export async function showDailyDetails(
  ctx: Context,
  id: number,
  filters?: { type: OperationType; currency: Currency; converted: boolean },
): Promise<void> {
  if (!ctx.from || !Number.isSafeInteger(id)) return;
  const delivery = await getDailyDelivery(String(ctx.from.id), id);
  if (!delivery) {
    await ctx.reply(tr('daily-invalid'));
    return;
  }
  const { from } = localDayWindow(delivery.localDate, delivery.timeZone);
  const state = { ...(await getInitialStatsState(String(ctx.from.id))), ...filters };
  const result = await renderStats(String(ctx.from.id), state, false, {
    from,
    to: delivery.windowEnd,
    label: tr('daily-day', { v0: delivery.localDate }),
    deliveryId: id,
  });
  if (filters) await updateStats(ctx, result);
  else await sendStats(ctx, result);
}

async function showNotificationHours(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard();
  for (let hour = 0; hour < 24; hour++) {
    keyboard.text(String(hour).padStart(2, '0'), `notifications:minutes:${hour}`);
    if (hour % 4 === 3) keyboard.row();
  }
  keyboard.text(tr('daily-back'), 'notifications:settings');
  if (cameFromMenu(ctx)) keyboard.row().text(BUTTONS.backToMenu, CALLBACKS.menuBack);
  await ctx.editMessageText(tr('daily-time-hours'), { reply_markup: keyboard });
}
async function showNotificationMinutes(ctx: Context, hour: number, page: number): Promise<void> {
  const keyboard = new InlineKeyboard();
  for (let minute = page * 20; minute < (page + 1) * 20; minute++) {
    const time = formatNotificationTime(hour * 60 + minute);
    keyboard.text(time, `notifications:time:${time}`);
    if (minute % 4 === 3) keyboard.row();
  }
  if (page > 0) keyboard.text('←', `notifications:minutes:${hour}:${page - 1}`);
  if (page < 2) keyboard.text('→', `notifications:minutes:${hour}:${page + 1}`);
  keyboard.row().text(tr('daily-back'), 'notifications:time');
  if (cameFromMenu(ctx)) keyboard.row().text(BUTTONS.backToMenu, CALLBACKS.menuBack);
  await ctx.editMessageText(tr('daily-time-minutes', { v0: String(hour).padStart(2, '0') }), {
    reply_markup: keyboard,
  });
}
