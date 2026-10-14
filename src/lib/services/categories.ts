import { getDefaultCategoryNames, translateCategory } from './default-categories.js';
import { and, asc, eq, ilike } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { categories, type Category, type OperationType } from '../../db/schema.js';

/** Список неархивированных категорий пользователя, опционально по типу. */
export async function getActiveCategories(
  userId: string,
  type?: OperationType,
): Promise<Category[]> {
  const rows = await db
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
  const names = await getDefaultCategoryNames(userId);
  return rows.map((category) => translateCategory(category, names));
}

export async function getCategoryById(userId: string, id: number): Promise<Category | undefined> {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))
    .limit(1);
  return category ? translateCategory(category, await getDefaultCategoryNames(userId)) : undefined;
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
  // A translated default label should select the same category rather than create a duplicate.
  const active = await getActiveCategories(userId, type);
  const localized = active.find(
    (category) => category.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (localized) return localized;

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
  if (existing) return translateCategory(existing, await getDefaultCategoryNames(userId));

  const [created] = await db.insert(categories).values({ userId, name: trimmed, type }).returning();
  return created!;
}

/** Архивирует категорию (не удаляет физически — история операций остаётся рабочей). */
export async function archiveCategory(userId: string, id: number): Promise<Category | undefined> {
  const [archived] = await db
    .update(categories)
    .set({ isArchived: true })
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))
    .returning();
  return archived ? translateCategory(archived, await getDefaultCategoryNames(userId)) : undefined;
}
