import type { NewFood, SeedFood } from '../db/schema';

/**
 * Pure helpers for the bundled generic-food seed database (PLAN Part 5).
 * The DB-touching halves live in db/seed.ts (import) and
 * db/queries/seed-foods.ts (search).
 */

/**
 * One food in src/data/seed-foods.json, positional to keep the ~860 KB
 * bundle asset as small as JSON allows. Produced by
 * scripts/build-seed-foods.js — the layout here and the INSERT column order
 * in db/seed.ts must match it.
 */
export type SeedFoodTuple = [
  fdcId: number,
  name: string,
  calories: number,
  protein: number,
  carbs: number,
  fat: number,
  fiber: number | null,
  sugar: number | null,
  satFat: number | null,
  sodiumMg: number | null,
  servingQty: number | null,
  servingName: string | null,
];

export interface SeedData {
  version: number;
  foods: SeedFoodTuple[];
}

/**
 * Split a query into AND-ed search terms: "chicken breast roast" should
 * match "Chicken, broilers or fryers, breast, meat only, cooked, roasted"
 * even though the words are scattered through the description. Empty result
 * means "don't search".
 */
export function searchTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Copy a picked seed row into the shape `foods` expects. Same contract as
 * usdaHitToFood (src/api/usda.ts): source 'usda' + sourceId = fdcId, so a
 * food saved from the seed and the same food saved via the USDA proxy
 * dedupe to one local row. Values are per 100 g — the app's native storage
 * convention.
 */
export function seedFoodToNewFood(row: SeedFood): Omit<NewFood, 'createdAt'> {
  return {
    name: row.name,
    brand: null,
    barcode: null,
    source: 'usda',
    sourceId: String(row.fdcId),
    perHundred: 1,
    calories: row.calories,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    fiber: row.fiber,
    sugar: row.sugar,
    satFat: row.satFat,
    sodiumMg: row.sodiumMg,
    servingQty: row.servingQty,
    servingUnit: row.servingQty != null ? 'g' : null,
    servingName: row.servingName,
  };
}
