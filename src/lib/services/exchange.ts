import { logger } from '../logging/logger.js';
import { desc, asc, lte, sql } from 'drizzle-orm';
import cron from 'node-cron';
import { db } from '../../db/index.js';
import { exchangeRates, transactions } from '../../db/schema.js';
import { fetchRateSnapshot } from '../utils/exchange.js';

export async function getLatestRates() {
  const [snapshot] = await db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.rateAt))
    .limit(1);
  return snapshot;
}

/** Best known snapshot at the operation time; otherwise oldest available, explicitly estimated. */
export async function getRatesForDate(date: Date) {
  const [historical] = await db
    .select()
    .from(exchangeRates)
    .where(lte(exchangeRates.rateAt, date))
    .orderBy(desc(exchangeRates.rateAt))
    .limit(1);
  if (historical) return historical;
  const [earliest] = await db
    .select()
    .from(exchangeRates)
    .orderBy(asc(exchangeRates.rateAt))
    .limit(1);
  return earliest;
}

/** Fill missing links once. Existing pinned snapshots are never replaced. */
export async function pinPendingRates(): Promise<void> {
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT t.id, r.rate_at,
        (r.rate_at > t.created_at OR r.next_update_at <= t.created_at) AS estimated
      FROM ${transactions} t
      CROSS JOIN LATERAL (
        SELECT rate_at, next_update_at FROM ${exchangeRates}
        ORDER BY (rate_at <= t.created_at) DESC,
          CASE WHEN rate_at <= t.created_at THEN rate_at END DESC,
          rate_at ASC
        LIMIT 1
      ) r
      WHERE t.rate_at IS NULL
    )
    UPDATE ${transactions} t SET rate_at = c.rate_at, rate_estimated = c.estimated
    FROM candidates c WHERE t.id = c.id AND t.rate_at IS NULL
  `);
  if (result.rowCount)
    logger.info(
      { event: 'exchange.operations.pinned', count: result.rowCount },
      'Курсы закреплены за операциями',
    );
}

let updating = false;
export async function refreshExchangeRates(): Promise<void> {
  if (updating) {
    logger.debug(
      { event: 'exchange.refresh.skipped', reason: 'in-progress' },
      'Обновление уже выполняется',
    );
    return;
  }
  const key = process.env.EXCHANGE_API_KEY;
  updating = true;
  const started = performance.now();
  let stage = 'database.read';
  try {
    const latest = await getLatestRates();
    stage = 'database.pin';
    await pinPendingRates();
    if (latest && latest.nextUpdateAt.getTime() > Date.now()) {
      logger.debug(
        { event: 'exchange.refresh.skipped', reason: 'fresh-cache' },
        'Сохранённые курсы актуальны',
      );
      return;
    }
    if (!key) {
      logger.warn(
        { event: 'exchange.refresh.skipped', reason: 'missing-key' },
        'EXCHANGE_API_KEY не задан',
      );
      return;
    }
    stage = 'api.fetch';
    const snapshot = await fetchRateSnapshot(key);
    stage = 'database.write';
    await db.insert(exchangeRates).values(snapshot).onConflictDoNothing();
    stage = 'database.pin';
    await pinPendingRates();
    logger.info(
      {
        event: 'exchange.refresh.completed',
        rateAt: snapshot.rateAt,
        durationMs: Math.round(performance.now() - started),
      },
      'Курсы валют обновлены',
    );
  } catch (error) {
    logger.error(
      {
        event: 'exchange.refresh.failed',
        stage,
        durationMs: Math.round(performance.now() - started),
        err: error,
      },
      'Не удалось обновить курсы; сохранённые курсы остаются доступными',
    );
  } finally {
    updating = false;
  }
}

export function startExchangeRateJob() {
  const task = cron.schedule('0 6 * * *', refreshExchangeRates, {
    timezone: 'Europe/Belgrade',
    noOverlap: true,
  });
  logger.info(
    { event: 'exchange.schedule.started', schedule: '0 6 * * *', timezone: 'Europe/Belgrade' },
    'Задание обновления курсов запущено',
  );
  void refreshExchangeRates();
  return task;
}
