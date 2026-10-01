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
  if (updating) return;
  const key = process.env.EXCHANGE_API_KEY;
  if (!key) return;
  updating = true;
  try {
    const latest = await getLatestRates();
    if (latest && latest.nextUpdateAt.getTime() > Date.now()) return;
    const snapshot = await fetchRateSnapshot(key);
    await db.insert(exchangeRates).values(snapshot).onConflictDoNothing();
    console.log('Курсы валют обновлены');
  } catch {
    console.error(
      'Не удалось обновить курсы валют. Сохранённые курсы остаются доступными. Проверь API-ключ, подключение и схему БД.',
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
  void refreshExchangeRates();
  return task;
}
