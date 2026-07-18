import { MAX_AMOUNT } from '../constants/index.js';

/**
 * Парсит сумму из пользовательского ввода.
 * Поддерживает запятую и точку как десятичный разделитель, пробелы как разделители тысяч.
 * Возвращает null, если ввод не является положительным числом.
 */
export function parseAmount(input: string): number | null {
  const normalized = input.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) return null;

  return value;
}

export function formatAmount(amount: number | string): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}
