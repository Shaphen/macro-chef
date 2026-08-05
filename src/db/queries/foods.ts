import { and, desc, eq, like, or, sql } from 'drizzle-orm';

import { db } from '../client';
import { foods, type Food, type NewFood } from '../schema';

const notDeleted = eq(foods.isDeleted, 0);

export function searchFoods(query: string, limit = 30): Food[] {
  const q = `%${query.trim()}%`;
  return db
    .select()
    .from(foods)
    .where(and(notDeleted, or(like(foods.name, q), like(foods.brand, q))))
    .orderBy(desc(foods.useCount), desc(foods.lastUsedAt))
    .limit(limit)
    .all();
}

/** History list: most recently / frequently used first (PLAN §8). */
export function recentFoods(limit = 25): Food[] {
  return db
    .select()
    .from(foods)
    .where(notDeleted)
    .orderBy(desc(foods.lastUsedAt), desc(foods.useCount))
    .limit(limit)
    .all();
}

export function getFood(id: number): Food | undefined {
  return db.select().from(foods).where(eq(foods.id, id)).get();
}

export function getFoodByBarcode(barcode: string): Food | undefined {
  return db
    .select()
    .from(foods)
    .where(and(notDeleted, eq(foods.barcode, barcode)))
    .get();
}

export function insertFood(food: Omit<NewFood, 'createdAt'>): Food {
  return db
    .insert(foods)
    .values({ ...food, createdAt: Date.now() })
    .returning()
    .get();
}

export function updateFood(id: number, patch: Partial<NewFood>): void {
  db.update(foods).set(patch).where(eq(foods.id, id)).run();
}

export function softDeleteFood(id: number): void {
  db.update(foods).set({ isDeleted: 1 }).where(eq(foods.id, id)).run();
}

/** Bump usage ranking whenever a food gets logged. */
export function touchFoodUsage(id: number): void {
  db.update(foods)
    .set({ useCount: sql`${foods.useCount} + 1`, lastUsedAt: Date.now() })
    .where(eq(foods.id, id))
    .run();
}
