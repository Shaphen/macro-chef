import { and, desc, eq, like } from 'drizzle-orm';

import { sumTotals, type MacroTotals, ZERO_TOTALS } from '../../lib/nutrition';
import { db } from '../client';
import {
  recipeItems,
  recipes,
  type NewRecipeItem,
  type Recipe,
  type RecipeItem,
} from '../schema';

/**
 * Recipe persistence (PLAN §4/§5, Phase 4).
 *
 * The load-bearing rule mirrors log_entries: `recipe_items` rows carry a
 * SNAPSHOT of the ingredient's macros at the moment the recipe was saved.
 * Recipe totals are always the sum of those snapshots — we never re-derive
 * them from the current `foods` rows, so editing (or soft-deleting) an
 * ingredient food later cannot silently change what a saved recipe claims
 * to contain. Re-saving the recipe is the only thing that refreshes items,
 * which matches §5's "re-logging uses the food's current values".
 */

const notDeleted = eq(recipes.isDeleted, 0);

/**
 * Library list for the Foods tab / add-food flow. Soft-deleted recipes are
 * hidden but their rows stay in the table so old log entries whose
 * `recipe_id` points at them keep a valid reference.
 */
export function listRecipes(query = '', limit = 50): Recipe[] {
  const where = query.trim()
    ? and(notDeleted, like(recipes.name, `%${query.trim()}%`))
    : notDeleted;
  return db
    .select()
    .from(recipes)
    .where(where)
    .orderBy(desc(recipes.createdAt))
    .limit(limit)
    .all();
}

export function getRecipe(id: number): Recipe | undefined {
  return db.select().from(recipes).where(eq(recipes.id, id)).get();
}

export function itemsForRecipe(recipeId: number): RecipeItem[] {
  return db.select().from(recipeItems).where(eq(recipeItems.recipeId, recipeId)).all();
}

/** Input shape for saving: everything but the FK the save assigns itself. */
export type RecipeItemDraft = Omit<NewRecipeItem, 'id' | 'recipeId'>;

/**
 * Create a recipe and its item snapshots in one transaction so a crash
 * mid-save can't leave a recipe without ingredients (or orphan items).
 */
export function insertRecipe(
  data: { name: string; servings: number; notes?: string | null },
  items: RecipeItemDraft[],
): Recipe {
  return db.transaction((tx) => {
    const recipe = tx
      .insert(recipes)
      .values({ ...data, createdAt: Date.now() })
      .returning()
      .get();
    for (const item of items) {
      tx.insert(recipeItems).values({ ...item, recipeId: recipe.id }).run();
    }
    return recipe;
  });
}

/**
 * Update = replace: metadata is patched and the item set is deleted and
 * re-inserted wholesale. Item rows are cheap and have no external
 * references (log entries reference the recipe, never its items), so
 * replace-all is simpler and safer than diffing.
 */
export function updateRecipe(
  id: number,
  data: { name: string; servings: number; notes?: string | null },
  items: RecipeItemDraft[],
): void {
  db.transaction((tx) => {
    tx.update(recipes).set(data).where(eq(recipes.id, id)).run();
    tx.delete(recipeItems).where(eq(recipeItems.recipeId, id)).run();
    for (const item of items) {
      tx.insert(recipeItems).values({ ...item, recipeId: id }).run();
    }
  });
}

/**
 * Soft delete only — past log entries display their own snapshot but keep
 * `recipe_id` for provenance, so the row must survive (same reasoning as
 * foods.is_deleted, PLAN §4).
 */
export function softDeleteRecipe(id: number): void {
  db.update(recipes).set({ isDeleted: 1 }).where(eq(recipes.id, id)).run();
}

/** Whole-recipe totals = sum of item snapshots (never recomputed from foods). */
export function recipeTotals(recipeId: number): MacroTotals {
  return sumTotals(itemsForRecipe(recipeId));
}

/**
 * Per-serving totals — what actually gets scaled when logging N servings.
 * Guards servings<=0 (the schema default is 1, but a hand-edited value of 0
 * would otherwise produce Infinity and poison every downstream snapshot).
 */
export function perServingTotals(recipe: Recipe): MacroTotals {
  const totals = recipeTotals(recipe.id);
  const servings = recipe.servings > 0 ? recipe.servings : 1;
  return {
    calories: totals.calories / servings,
    protein: totals.protein / servings,
    carbs: totals.carbs / servings,
    fat: totals.fat / servings,
  };
}

export { ZERO_TOTALS };
