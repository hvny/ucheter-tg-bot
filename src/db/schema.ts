import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const currencyType = pgEnum('currency', ['RUB', 'USD', 'EUR', 'RSD']);
export type Currency = (typeof currencyType.enumValues)[number];

export const operationType = pgEnum('operation_type', ['expense', 'income']);

export const users = pgTable('users', {
  id: text('id').primaryKey(), // telegram user id
  username: text('username'),
  preferredCurrency: currencyType('preferred_currency').notNull().default('RUB'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  type: operationType('type').notNull(),
  isArchived: boolean('is_archived').notNull().default(false),
});

export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  categoryId: integer('category_id')
    .notNull()
    .references(() => categories.id),
  currency: currencyType('currency').notNull().default('RUB'),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  type: operationType('type').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type OperationType = (typeof operationType.enumValues)[number];

/** One complete USD-based snapshot per provider publication time. */
export const exchangeRates = pgTable('exchange_rates', {
  rateAt: timestamp('rate_at', { withTimezone: true }).primaryKey(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  nextUpdateAt: timestamp('next_update_at', { withTimezone: true }).notNull(),
  baseCurrency: currencyType('base_currency').notNull().default('USD'),
  rates: jsonb('rates').$type<Record<Currency, number>>().notNull(),
});
