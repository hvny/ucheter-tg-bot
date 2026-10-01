import { currencyType, type Currency } from '../../db/schema.js';

export interface RateSnapshot {
  rateAt: Date;
  nextUpdateAt: Date;
  rates: Record<Currency, number>;
}

export function parseRateSnapshot(value: unknown): RateSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Некорректный ответ API курсов');
  const data = value as Record<string, unknown>;
  if (data.result !== 'success' || data.base_code !== 'USD')
    throw new Error('API не вернул курсы относительно USD');
  const raw = data.conversion_rates;
  if (!raw || typeof raw !== 'object') throw new Error('Отсутствуют курсы валют');
  const rates = {} as Record<Currency, number>;
  for (const currency of currencyType.enumValues) {
    const rate = (raw as Record<string, unknown>)[currency];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
      throw new Error(`Некорректный курс ${currency}`);
    rates[currency] = rate;
  }
  const last = data.time_last_update_unix;
  const next = data.time_next_update_unix;
  if (
    rates.USD !== 1 ||
    typeof last !== 'number' ||
    typeof next !== 'number' ||
    !Number.isFinite(last) ||
    !Number.isFinite(next) ||
    last <= 0 ||
    next <= last
  )
    throw new Error('Некорректные метаданные курсов');
  const rateAt = new Date(last * 1000);
  const nextUpdateAt = new Date(next * 1000);
  if (
    !Number.isFinite(rateAt.getTime()) ||
    !Number.isFinite(nextUpdateAt.getTime()) ||
    rateAt.getTime() > Date.now() + 300_000
  )
    throw new Error('Некорректная дата курсов');
  return { rates, rateAt, nextUpdateAt };
}

export function convertAmount(
  amount: number,
  source: Currency,
  target: Currency,
  rates: Record<Currency, number>,
): number {
  if (source === target) return amount;
  return (amount * rates[target]) / rates[source];
}

export async function fetchRateSnapshot(
  key: string,
  request: typeof fetch = fetch,
): Promise<RateSnapshot> {
  // Never log fetch errors: their URLs can contain the API key.
  let response: Response;
  try {
    response = await request(
      `https://v6.exchangerate-api.com/v6/${encodeURIComponent(key)}/latest/USD`,
      { signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    throw new Error('Не удалось подключиться к API курсов');
  }
  if (!response.ok) throw new Error(`API курсов: HTTP ${response.status}`);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('API курсов вернул некорректный JSON');
  }
  return parseRateSnapshot(data);
}
