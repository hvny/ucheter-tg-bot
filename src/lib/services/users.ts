import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { categories, users, type Currency, type User } from '../../db/schema.js';
import { DEFAULT_CATEGORIES } from '../constants/index.js';

/**
 * Регистрирует пользователя, если его ещё нет.
 * Новому пользователю создаётся дефолтный набор категорий.
 * Возвращает пользователя и флаг, был ли он только что создан.
 */
export async function registerUser(
  id: string,
  username?: string,
): Promise<{ user: User; isNew: boolean }> {
  const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (existing) {
    if (username && existing.username !== username) {
      await db.update(users).set({ username }).where(eq(users.id, id));
    }
    return { user: existing, isNew: false };
  }

  const user = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ id, username: username ?? null })
      .returning();

    const defaults = (['expense', 'income'] as const).flatMap((type) =>
      DEFAULT_CATEGORIES[type].map((name) => ({ userId: id, name, type })),
    );
    await tx.insert(categories).values(defaults);

    return created!;
  });

  return { user, isNew: true };
}

export async function getPreferredCurrency(userId: string): Promise<Currency> {
  const [user] = await db
    .select({ currency: users.preferredCurrency })
    .from(users)
    .where(eq(users.id, userId));
  return user?.currency ?? 'RUB';
}

export async function setPreferredCurrency(userId: string, currency: Currency): Promise<void> {
  await db.update(users).set({ preferredCurrency: currency }).where(eq(users.id, userId));
}
