import { and, desc, eq, sql } from 'drizzle-orm';

import { parseQuery, prepareTarget, searchWithFallback } from '../../lib/food-search';
import { db } from '../client';
import { foods, type Food, type NewFood } from '../schema';

const notDeleted = eq(foods.isDeleted, 0);

/**
 * Tolerant search over the user's saved foods (PLAN Part 7).
 *
 * This used to match the WHOLE query as one contiguous SQL substring, so
 * "garlic herb cream cheese" found nothing while "cream cheese" found
 * "Garlic and Herb Cream Cheese" — a single unanticipated word in the middle
 * lost the match. Scoring now happens in JS (see lib/food-search.ts): word
 * order is free, extra/missing words are forgiven, and typos still land.
 *
 * The whole (non-deleted) table is scanned because `LIKE` cannot express
 * "close enough" and a personal food library is small — hundreds of rows,
 * not millions. Revisit with an FTS index only if that stops being true.
 */
export function searchFoods(query: string, limit = 30): Food[] {
  const parsed = parseQuery(query);
  if (!parsed) return [];

  const rows = db.select().from(foods).where(notDeleted).all();
  return searchWithFallback(rows, parsed, (row) =>
    prepareTarget(row.brand ? `${row.name} ${row.brand}` : row.name),
  )
    // Ties are broken the way the list was always ordered — the food you
    // reach for most, most recently — so familiar entries stay on top.
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.item.useCount - a.item.useCount ||
        (b.item.lastUsedAt ?? 0) - (a.item.lastUsedAt ?? 0) ||
        a.item.name.length - b.item.name.length,
    )
    .slice(0, limit)
    .map((hit) => hit.item);
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

/**
 * Dedupe hook for online-sourced foods without a barcode (USDA hits key on
 * fdcId): picking the same remote result twice reuses the saved local row
 * instead of inserting a duplicate.
 */
export function getFoodBySource(source: Food['source'], sourceId: string): Food | undefined {
  return db
    .select()
    .from(foods)
    .where(and(notDeleted, eq(foods.source, source), eq(foods.sourceId, sourceId)))
    .get();
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
