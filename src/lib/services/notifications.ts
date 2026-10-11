import { setTimeout as delay } from 'node:timers/promises';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import cron from 'node-cron';
import { GrammyError, InlineKeyboard, InputFile, type Api } from 'grammy';
import { db } from '../../db/index.js';
import { dailyDeliveries, users, currencyType, type User } from '../../db/schema.js';
import { tr, withLanguage } from '../i18n/index.js';
import { logger } from '../logging/logger.js';
import { renderDailyChart } from '../utils/chart.js';
import { formatAmount } from '../utils/money.js';
import {
  dailyIsDue,
  isNotificationTime,
  isTimeZone,
  localClock,
  localDayWindow,
} from '../utils/time-zone.js';
import { getConvertedStats, getSummary } from './transactions.js';

export async function getNotificationSettings(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user;
}
export async function setNotifications(userId: string, enabled: boolean, zone?: string) {
  if (zone && !isTimeZone(zone)) throw new Error('Invalid time zone');
  const user = await getNotificationSettings(userId);
  if (enabled && !(zone ?? user?.timeZone)) throw new Error('Missing time zone');
  await db
    .update(users)
    .set({ dailyNotifications: enabled, ...(zone ? { timeZone: zone } : {}) })
    .where(eq(users.id, userId));
}

/** Bounded retries and an atomic lease prevent overlapping sends across processes. */
export async function claimDailyDelivery(
  userId: string,
  date: string,
  now: Date,
  zone: string,
): Promise<{ id: number; windowEnd: Date; timeZone: string } | undefined> {
  const lease = new Date(now.getTime() + 10 * 60_000);
  const claimed = await db
    .insert(dailyDeliveries)
    .values({ userId, localDate: date, leaseUntil: lease, timeZone: zone, windowEnd: now })
    .onConflictDoUpdate({
      target: [dailyDeliveries.userId, dailyDeliveries.localDate],
      set: { leaseUntil: lease, attempts: sql`${dailyDeliveries.attempts} + 1` },
      setWhere: sql`${dailyDeliveries.sentAt} IS NULL AND ${dailyDeliveries.leaseUntil} <= ${now} AND ${dailyDeliveries.attempts} < 3`,
    })
    .returning({
      id: dailyDeliveries.id,
      windowEnd: dailyDeliveries.windowEnd,
      timeZone: dailyDeliveries.timeZone,
    });
  return claimed[0];
}
export async function markDailySent(userId: string, date: string) {
  await db
    .update(dailyDeliveries)
    .set({ sentAt: new Date() })
    .where(and(eq(dailyDeliveries.userId, userId), eq(dailyDeliveries.localDate, date)));
}

export async function renderDailySummary(user: User, now: Date, deliveryId: number) {
  const zone = user.timeZone!;
  const date = localClock(now, zone).date;
  const { from } = localDayWindow(date, zone);
  const data = await getConvertedStats(user.id, 'expense', user.preferredCurrency, from, now);
  const caption = [tr('daily-title', { v0: date })];
  const labels: string[] = [];
  const incomes: number[] = [];
  const expenses: number[] = [];
  if (data.missingRates) {
    caption.push(tr('daily-missing'));
    for (const currency of currencyType.enumValues) {
      const summary = await getSummary(user.id, from, currency, now);
      if (!summary.income && !summary.expense) continue;
      caption.push(
        tr('daily-income', { v0: formatAmount(summary.income), v1: currency }),
        tr('daily-expense', { v0: formatAmount(summary.expense), v1: currency }),
      );
      labels.push(currency);
      incomes.push(summary.income);
      expenses.push(summary.expense);
    }
  } else {
    caption.push(
      tr('daily-income', { v0: formatAmount(data.summary.income), v1: user.preferredCurrency }),
      tr('daily-expense', { v0: formatAmount(data.summary.expense), v1: user.preferredCurrency }),
    );
    if (data.estimatedRates) caption.push(tr('daily-estimated'));
    labels.push(user.preferredCurrency);
    incomes.push(data.summary.income);
    expenses.push(data.summary.expense);
  }
  const photo = await renderDailyChart(
    data.missingRates
      ? tr('daily-original-chart')
      : tr('daily-chart', { v0: user.preferredCurrency }),
    labels,
    incomes,
    expenses,
    tr('daily-income-label'),
    tr('daily-expense-label'),
  );
  // Carry the reporting cutoff so "Details" shows the same window after midnight.
  const keyboard = new InlineKeyboard()
    .text(tr('daily-details'), `daily:details:${deliveryId}`)
    .row()
    .text(tr('daily-disable'), 'daily:off');
  return { caption: caption.join('\n'), photo, keyboard, date };
}

export async function runDailyNotifications(api: Api, now = new Date()): Promise<void> {
  const subscribers = await db
    .select()
    .from(users)
    .where(and(eq(users.dailyNotifications, true), isNotNull(users.timeZone)));
  for (const user of subscribers) {
    try {
      if (
        !user.timeZone ||
        !isTimeZone(user.timeZone) ||
        !dailyIsDue(now, user.timeZone, user.notificationTime)
      )
        continue;
      const date = localClock(now, user.timeZone).date;
      // Recheck settings before claiming in case the user disabled notifications during the scan.
      const current = await getNotificationSettings(user.id);
      if (
        !current?.dailyNotifications ||
        current.timeZone !== user.timeZone ||
        !dailyIsDue(now, current.timeZone, current.notificationTime)
      )
        continue;
      const delivery = await claimDailyDelivery(user.id, date, now, user.timeZone);
      if (!delivery) continue;
      await withLanguage(current.language, async () => {
        const result = await renderDailySummary(
          { ...current, timeZone: delivery.timeZone },
          delivery.windowEnd,
          delivery.id,
        );
        await api.sendPhoto(current.id, new InputFile(result.photo), {
          caption: result.caption,
          reply_markup: result.keyboard,
        });
      });
      await markDailySent(user.id, date);
      logger.info({ event: 'notifications.sent' }, 'Ежедневная сводка отправлена');
      // Keep broadcast traffic below Telegram's general free broadcast limit.
      await delay(50);
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 403) {
        await setNotifications(user.id, false).catch((disableError) =>
          logger.error(
            { event: 'notifications.disable.failed', err: disableError },
            'Не удалось отключить уведомления',
          ),
        );
      }
      logger.error(
        { event: 'notifications.send.failed', err: error },
        'Не удалось отправить сводку',
      );
    }
  }
}
export function startDailyNotificationJob(api: Api) {
  let running: Promise<void> | undefined;
  function tick() {
    if (running) return running;
    running = runDailyNotifications(api)
      .catch((error) => {
        logger.error(
          { event: 'notifications.schedule.failed', err: error },
          'Ошибка задания сводок',
        );
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  }
  const task = cron.schedule('* * * * *', tick, { timezone: 'UTC', noOverlap: true });
  void tick();
  logger.info({ event: 'notifications.schedule.started' }, 'Расписание ежедневных сводок запущено');
  return {
    async destroy() {
      await task.destroy();
      await running;
    },
  };
}

export async function getDailyDelivery(userId: string, id: number) {
  const [delivery] = await db
    .select()
    .from(dailyDeliveries)
    .where(and(eq(dailyDeliveries.userId, userId), eq(dailyDeliveries.id, id)))
    .limit(1);
  return delivery;
}

export async function setNotificationTime(userId: string, time: number): Promise<void> {
  if (!isNotificationTime(time)) throw new Error('Invalid notification time');
  await db.update(users).set({ notificationTime: time }).where(eq(users.id, userId));
}
