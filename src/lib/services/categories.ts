import { and, asc, eq, ilike } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { categories, type Category, type OperationType } from '../../db/schema.js';

/** Список неархивированных категорий пользователя, опционально по типу. */
export async function getActiveCategories(
  userId: string,
  type?: OperationType,
): Promise<Category[]> {
  return db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.userId, userId),
        eq(categories.isArchived, false),
        ...(type ? [eq(categories.type, type)] : []),
      ),
    )
    .orderBy(asc(categories.type), asc(categories.name));
}

export async function getCategoryById(userId: string, id: number): Promise<Category | undefined> {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))
    .limit(1);
  return category;
}

/**
 * Создаёт категорию. Если неархивированная категория с таким именем и типом
 * уже существует — возвращает её, не создавая дубликат.
 */
export async function createCategory(
  userId: string,
  name: string,
  type: OperationType,
): Promise<Category> {
  const trimmed = name.trim();

  const [existing] = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.userId, userId),
        eq(categories.type, type),
        eq(categories.isArchived, false),
        ilike(categories.name, trimmed),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await db.insert(categories).values({ userId, name: trimmed, type }).returning();
  return created!;
}
