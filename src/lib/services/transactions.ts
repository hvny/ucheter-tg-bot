import { tr } from '../i18n/index.js';
import { getRatesForDate } from './exchange.js';
import { convertAmount } from '../utils/exchange.js';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  categories,
  exchangeRates,
  transactions,
  type Currency,
  type OperationType,
  type Transaction,
} from '../../db/schema.js';

export interface CreateTransactionInput {
  userId: string;
  categoryId: number;
  amount: number;
  currency: Currency;
  type: OperationType;
  comment?: string;
}

export async function createTransaction(input: CreateTransactionInput): Promise<Transaction> {
  const createdAt = new Date();
  const snapshot = await getRatesForDate(createdAt);
  const [created] = await db
    .insert(transactions)
    .values({
      createdAt,
      rateAt: snapshot?.rateAt ?? null,
      rateEstimated: snapshot
        ? snapshot.rateAt > createdAt || snapshot.nextUpdateAt <= createdAt
        : false,
      userId: input.userId,
      categoryId: input.categoryId,
      amount: input.amount.toFixed(2),
      type: input.type,
      currency: input.currency,
      comment: input.comment ?? null,
    })
    .returning();
  return created!;
}

export interface TransactionFilters {
  type?: OperationType;
  currency?: Currency;
  categoryId?: number;
  /** Учитывать операции начиная с этой даты (включительно). */
  from?: Date;
  /** Exclusive end of the reporting window. */
  to?: Date;
}

export interface TransactionWithCategory extends Transaction {
  categoryName: string | null;
}

function transactionFilterConditions(userId: string, filters: TransactionFilters) {
  return and(
    eq(transactions.userId, userId),
    ...(filters.currency ? [eq(transactions.currency, filters.currency)] : []),
    ...(filters.type ? [eq(transactions.type, filters.type)] : []),
    ...(filters.categoryId ? [eq(transactions.categoryId, filters.categoryId)] : []),
    ...(filters.from ? [gte(transactions.createdAt, filters.from)] : []),
    ...(filters.to ? [lt(transactions.createdAt, filters.to)] : []),
  );
}

/** Список операций с фильтрами и пагинацией, новые сверху. */
export async function listTransactions(
  userId: string,
  filters: TransactionFilters,
  page: { limit: number; offset: number },
): Promise<{ items: TransactionWithCategory[]; total: number }> {
  const where = transactionFilterConditions(userId, filters);

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: transactions.id,
        userId: transactions.userId,
        categoryId: transactions.categoryId,
        amount: transactions.amount,
        currency: transactions.currency,
        type: transactions.type,
        comment: transactions.comment,
        rateAt: transactions.rateAt,
        rateEstimated: transactions.rateEstimated,
        createdAt: transactions.createdAt,
        categoryName: categories.name,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(where)
      .orderBy(desc(transactions.createdAt), desc(transactions.id))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(transactions)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.count ?? 0 };
}

/** Все операции за период (без пагинации) — для выгрузки в Excel. */
export async function listAllTransactions(
  userId: string,
  filters: TransactionFilters,
): Promise<TransactionWithCategory[]> {
  const where = transactionFilterConditions(userId, filters);

  return db
    .select({
      id: transactions.id,
      userId: transactions.userId,
      categoryId: transactions.categoryId,
      amount: transactions.amount,
      currency: transactions.currency,
      type: transactions.type,
      comment: transactions.comment,
      rateAt: transactions.rateAt,
      rateEstimated: transactions.rateEstimated,
      createdAt: transactions.createdAt,
      categoryName: categories.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .orderBy(transactions.createdAt, transactions.id);
}

export interface PeriodSummary {
  income: number;
  expense: number;
}

/** Суммы доходов и расходов за период. */
export async function getSummary(
  userId: string,
  from?: Date,
  currency: Currency = 'RUB',
  to?: Date,
): Promise<PeriodSummary> {
  const where = transactionFilterConditions(userId, {
    currency,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });

  const rows = await db
    .select({
      type: transactions.type,
      total: sql<number>`sum(${transactions.amount})`.mapWith(Number),
    })
    .from(transactions)
    .where(where)
    .groupBy(transactions.type);

  const summary: PeriodSummary = { income: 0, expense: 0 };
  for (const row of rows) {
    summary[row.type] = row.total;
  }
  return summary;
}

export interface CategoryTotal {
  categoryId: number;
  categoryName: string;
  total: number;
}

/** Разбивка сумм по категориям для одного типа операций за период. */
export async function getCategoryBreakdown(
  userId: string,
  type: OperationType,
  from?: Date,
  currency: Currency = 'RUB',
  to?: Date,
): Promise<CategoryTotal[]> {
  const where = transactionFilterConditions(userId, {
    type,
    currency,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });

  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      total: sql<number>`sum(${transactions.amount})`.mapWith(Number),
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .groupBy(transactions.categoryId, categories.name)
    .orderBy(desc(sql`sum(${transactions.amount})`));

  return rows.map((row) => ({
    categoryId: row.categoryId,
    categoryName: row.categoryName ?? tr('edit-message-2'),
    total: row.total,
  }));
}

/** Reads and updates only operations owned by this Telegram user. */
export async function getTransactionById(
  userId: string,
  id: number,
): Promise<Transaction | undefined> {
  const [item] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)));
  return item;
}

export async function updateTransaction(
  userId: string,
  id: number,
  input: Omit<CreateTransactionInput, 'userId'>,
): Promise<Transaction | undefined> {
  const [category] = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.userId, userId),
        eq(categories.id, input.categoryId),
        eq(categories.type, input.type),
      ),
    );
  if (!category) return undefined;
  const [updated] = await db
    .update(transactions)
    .set({
      categoryId: input.categoryId,
      type: input.type,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      comment: input.comment ?? null,
    })
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
    .returning();
  return updated;
}

/** Aggregate only operations sharing the same pinned snapshot before conversion. */
export async function getConvertedStats(
  userId: string,
  type: OperationType,
  currency: Currency,
  from?: Date,
  to?: Date,
): Promise<{
  summary: PeriodSummary;
  breakdown: CategoryTotal[];
  missingRates: number;
  estimatedRates: number;
}> {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      type: transactions.type,
      currency: transactions.currency,
      rates: exchangeRates.rates,
      rateEstimated: transactions.rateEstimated,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`sum(${transactions.amount})`.mapWith(Number),
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(exchangeRates, eq(transactions.rateAt, exchangeRates.rateAt))
    .where(
      transactionFilterConditions(userId, { ...(from ? { from } : {}), ...(to ? { to } : {}) }),
    )
    .groupBy(
      transactions.categoryId,
      categories.name,
      transactions.type,
      transactions.currency,
      transactions.rateAt,
      transactions.rateEstimated,
      exchangeRates.rates,
    );
  const summary: PeriodSummary = { income: 0, expense: 0 };
  const totals = new Map<number, CategoryTotal>();
  let missingRates = 0;
  let estimatedRates = 0;
  for (const row of rows) {
    if (!row.rates && row.currency !== currency) {
      missingRates += row.count;
      continue;
    }
    if (row.rateEstimated && row.currency !== currency) estimatedRates += row.count;
    const total =
      row.currency === currency
        ? row.total
        : convertAmount(row.total, row.currency, currency, row.rates!);
    summary[row.type] += total;
    if (row.type !== type) continue;
    const category = totals.get(row.categoryId) ?? {
      categoryId: row.categoryId,
      categoryName: row.categoryName ?? tr('edit-message-2'),
      total: 0,
    };
    category.total += total;
    totals.set(row.categoryId, category);
  }
  return {
    summary,
    breakdown: [...totals.values()].sort((a, b) => b.total - a.total),
    missingRates,
    estimatedRates,
  };
}

/** Delete only an operation owned by the requesting Telegram user. */
export async function deleteTransaction(userId: string, id: number): Promise<boolean> {
  const deleted = await db
    .delete(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
    .returning({ id: transactions.id });
  return deleted.length > 0;
}
