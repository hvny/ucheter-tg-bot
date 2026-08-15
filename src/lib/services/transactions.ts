import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { categories, transactions, type OperationType, type Transaction } from '../../db/schema.js';

export interface CreateTransactionInput {
  userId: string;
  categoryId: number;
  amount: number;
  type: OperationType;
  comment?: string;
}

export async function createTransaction(input: CreateTransactionInput): Promise<Transaction> {
  const [created] = await db
    .insert(transactions)
    .values({
      userId: input.userId,
      categoryId: input.categoryId,
      amount: input.amount.toFixed(2),
      type: input.type,
      comment: input.comment ?? null,
    })
    .returning();
  return created!;
}

export interface TransactionFilters {
  type?: OperationType;
  categoryId?: number;
  /** Учитывать операции начиная с этой даты (включительно). */
  from?: Date;
}

export interface TransactionWithCategory extends Transaction {
  categoryName: string | null;
}

function transactionFilterConditions(userId: string, filters: TransactionFilters) {
  return and(
    eq(transactions.userId, userId),
    ...(filters.type ? [eq(transactions.type, filters.type)] : []),
    ...(filters.categoryId ? [eq(transactions.categoryId, filters.categoryId)] : []),
    ...(filters.from ? [gte(transactions.createdAt, filters.from)] : []),
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
        type: transactions.type,
        comment: transactions.comment,
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
      type: transactions.type,
      comment: transactions.comment,
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
export async function getSummary(userId: string, from?: Date): Promise<PeriodSummary> {
  const where = transactionFilterConditions(userId, { ...(from ? { from } : {}) });

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
): Promise<CategoryTotal[]> {
  const where = transactionFilterConditions(userId, { type, ...(from ? { from } : {}) });

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
    categoryName: row.categoryName ?? 'Без категории',
    total: row.total,
  }));
}
