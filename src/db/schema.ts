import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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
  language: text('language').$type<'ru' | 'en'>().notNull().default('ru'),
  timeZone: text('time_zone'),
  notificationTime: integer('notification_time').notNull().default(1200), // minutes after local midnight
  dailyNotifications: boolean('daily_notifications').notNull().default(false),
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

/** One complete USD-based snapshot per provider publication time. */
export const exchangeRates = pgTable('exchange_rates', {
  rateAt: timestamp('rate_at', { withTimezone: true }).primaryKey(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  nextUpdateAt: timestamp('next_update_at', { withTimezone: true }).notNull(),
  baseCurrency: currencyType('base_currency').notNull().default('USD'),
  rates: jsonb('rates').$type<Record<Currency, number>>().notNull(),
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
  rateAt: timestamp('rate_at', { withTimezone: true }).references(() => exchangeRates.rateAt),
  rateEstimated: boolean('rate_estimated').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type OperationType = (typeof operationType.enumValues)[number];

/** Persistent send claims survive restarts and prevent concurrent daily deliveries. */
export const dailyDeliveries = pgTable(
  'daily_deliveries',
  {
    id: serial('id').notNull().unique(),
    timeZone: text('time_zone').notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    localDate: text('local_date').notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(1),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.localDate] })],
);
