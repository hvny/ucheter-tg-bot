import { logger } from '../logging/logger.js';
import { desc } from 'drizzle-orm';
import cron from 'node-cron';
import { db } from '../../db/index.js';
import { exchangeRates } from '../../db/schema.js';
import { fetchRateSnapshot } from '../utils/exchange.js';

export async function getLatestRates() {
  const [snapshot] = await db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.rateAt))
    .limit(1);
  return snapshot;
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
  if (!key) {
    logger.warn(
      { event: 'exchange.refresh.skipped', reason: 'missing-key' },
      'EXCHANGE_API_KEY не задан',
    );
    return;
  }
  updating = true;
  const started = performance.now();
  let stage = 'database.read';
  try {
    const latest = await getLatestRates();
    if (latest && latest.nextUpdateAt.getTime() > Date.now()) {
      logger.debug(
        { event: 'exchange.refresh.skipped', reason: 'fresh-cache' },
        'Сохранённые курсы актуальны',
      );
      return;
    }
    stage = 'api.fetch';
    const snapshot = await fetchRateSnapshot(key);
    stage = 'database.write';
    await db.insert(exchangeRates).values(snapshot).onConflictDoNothing();
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
