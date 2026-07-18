import { db } from '../../db/index.js';
import { transactions, type OperationType, type Transaction } from '../../db/schema.js';

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
