import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { categories, type Category } from '../../db/schema.js';
import { ru, en, tr } from '../i18n/index.js';

const SEED = [
  ...(
    [
      'index-message-1',
      'index-message-2',
      'index-message-3',
      'index-message-4',
      'index-message-5',
      'index-message-6',
      'index-message-7',
      'index-message-8',
    ] as const
  ).map((key) => ({ key, type: 'expense' as const })),
  ...(['index-message-9', 'index-message-10', 'index-message-11', 'index-message-8'] as const).map(
    (key) => ({ key, type: 'income' as const }),
  ),
];

/** Registration inserts the complete initial set before any user-created category.
 * Match its order and names, rather than translating every user category with a similar name.
 */
export function identifyDefaultCategories(initial: Pick<Category, 'id' | 'name' | 'type'>[]) {
  const result = new Map<number, (typeof SEED)[number]['key']>();
  if (initial.length !== SEED.length) return result;
  for (let index = 0; index < SEED.length; index++) {
    const expected = SEED[index]!;
    const category = initial[index]!;
    if (
      category.type !== expected.type ||
      ![ru[expected.key], en[expected.key]].includes(category.name)
    )
      return new Map<number, (typeof SEED)[number]['key']>();
    result.set(category.id, expected.key);
  }
  return result;
}
export async function getDefaultCategoryNames(userId: string): Promise<Map<number, string>> {
  // Archived defaults are included: their identity is still needed in history and export.
  const initial = await db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.id))
    .limit(SEED.length);
  return new Map([...identifyDefaultCategories(initial)].map(([id, key]) => [id, tr(key)]));
}
export function translateCategory<T extends Category>(category: T, names: Map<number, string>): T {
  return { ...category, name: names.get(category.id) ?? category.name };
}
