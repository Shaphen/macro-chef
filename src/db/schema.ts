import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

/**
 * Canonical units: grams for food amounts, kg for body weight, local 'YYYY-MM-DD'
 * strings for day bucketing. Display-layer converts per settings.
 *
 * Nutrition on `foods` is stored per 100 g/ml when perHundred=1, else per 1 serving.
 * `log_entries` / `recipe_items` store SNAPSHOT totals — editing a food later must
 * never rewrite history (see planning/PLAN.md §5).
 */

export const foods = sqliteTable(
  'foods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    brand: text('brand'),
    barcode: text('barcode'), // normalized form confirmed by lookup (PLAN §7)
    source: text('source', { enum: ['custom', 'off', 'usda'] }).notNull().default('custom'),
    sourceId: text('source_id'),
    perHundred: integer('per_100').notNull().default(1),
    calories: real('calories').notNull(),
    protein: real('protein').notNull().default(0),
    carbs: real('carbs').notNull().default(0),
    fat: real('fat').notNull().default(0),
    fiber: real('fiber'),
    sugar: real('sugar'),
    satFat: real('sat_fat'),
    sodiumMg: real('sodium_mg'),
    servingQty: real('serving_qty'),
    servingUnit: text('serving_unit'), // 'g' | 'ml' | 'unit'
    servingName: text('serving_name'), // "1 scoop", "2 cookies"
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: integer('last_used_at'),
    isDeleted: integer('is_deleted').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_foods_barcode').on(t.barcode), index('idx_foods_name').on(t.name)],
);

export const logEntries = sqliteTable(
  'log_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    day: text('day').notNull(), // 'YYYY-MM-DD' local
    meal: text('meal', { enum: ['breakfast', 'lunch', 'dinner', 'snack'] }).notNull(),
    loggedAt: integer('logged_at').notNull(),
    kind: text('kind', { enum: ['food', 'recipe', 'quick'] }).notNull(),
    foodId: integer('food_id'),
    recipeId: integer('recipe_id'),
    name: text('name').notNull(),
    amount: real('amount'),
    amountUnit: text('amount_unit'), // 'g' | 'oz' | 'serving'
    grams: real('grams'),
    calories: real('calories').notNull(),
    protein: real('protein').notNull().default(0),
    carbs: real('carbs').notNull().default(0),
    fat: real('fat').notNull().default(0),
  },
  (t) => [index('idx_log_day').on(t.day)],
);

export const recipes = sqliteTable('recipes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  servings: real('servings').notNull().default(1),
  notes: text('notes'),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const recipeItems = sqliteTable('recipe_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  recipeId: integer('recipe_id').notNull(),
  foodId: integer('food_id').notNull(),
  amount: real('amount'),
  amountUnit: text('amount_unit'),
  grams: real('grams'),
  calories: real('calories').notNull(),
  protein: real('protein').notNull().default(0),
  carbs: real('carbs').notNull().default(0),
  fat: real('fat').notNull().default(0),
});

export const weightEntries = sqliteTable('weight_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  day: text('day').notNull().unique(),
  weightKg: real('weight_kg').notNull(),
  loggedAt: integer('logged_at').notNull(),
  // Where the weigh-in came from (PLAN Part 2.2). Health syncs must never
  // overwrite a 'manual' entry — the user's own number always wins.
  source: text('source', { enum: ['manual', 'healthkit', 'healthconnect'] })
    .notNull()
    .default('manual'),
});

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(), // single row, id = 1
  unitWeight: text('unit_weight', { enum: ['lb', 'kg'] }).notNull().default('lb'),
  unitFood: text('unit_food', { enum: ['g', 'oz'] }).notNull().default('g'),
  targetWeightKg: real('target_weight_kg'),
  calorieTarget: integer('calorie_target'),
  proteinTargetG: integer('protein_target_g'),
  carbTargetG: integer('carb_target_g'),
  fatTargetG: integer('fat_target_g'),
  goalNote: text('goal_note'),
  onboarded: integer('onboarded').notNull().default(0),
  // Base URL of the deployed macrochef-api Vercel project (PLAN §11 "USDA
  // generic-food search"). Null/empty = feature off; the add-food flow then
  // only offers local + Open Food Facts search.
  usdaProxyUrl: text('usda_proxy_url'),
  // Apple Health sync (PLAN Part 3). 1 only after the user granted HealthKit
  // read access at least once; the app never queries HealthKit otherwise
  // (querying an un-requested type crashes the app, per the library docs).
  healthSyncEnabled: integer('health_sync_enabled').notNull().default(0),
  // Epoch ms of the last completed sync — the incremental window's start
  // (minus an overlap, see lib/health.ts) and the "Last synced" label.
  healthLastSyncAt: integer('health_last_sync_at'),
});

/**
 * One row per local day of Apple Health activity (PLAN Part 3). Every column
 * is nullable because "no data for that metric that day" is a real, distinct
 * state from zero — a day with no watch worn has null exercise minutes, not
 * 0. Rows are written wholesale per sync so a metric deleted in Health
 * clears here too, rather than lingering as a stale value.
 */
export const healthDays = sqliteTable('health_days', {
  day: text('day').primaryKey(),
  steps: integer('steps'),
  activeEnergyKcal: real('active_energy_kcal'),
  basalEnergyKcal: real('basal_energy_kcal'),
  exerciseMinutes: real('exercise_minutes'),
  /** Asleep minutes (in-bed/awake excluded), attributed to the wake day. */
  sleepMinutes: real('sleep_minutes'),
  syncedAt: integer('synced_at').notNull(),
});

/**
 * Individual workouts, keyed by HealthKit's own sample UUID so re-syncing an
 * overlapping window is idempotent.
 */
export const healthWorkouts = sqliteTable('health_workouts', {
  uuid: text('uuid').primaryKey(),
  day: text('day').notNull(),
  /** Humanized activity name ('Running'); see WORKOUT_LABELS in lib/health.ts. */
  activity: text('activity').notNull(),
  startMs: integer('start_ms').notNull(),
  endMs: integer('end_ms').notNull(),
  durationSec: real('duration_sec').notNull(),
  energyKcal: real('energy_kcal'),
  distanceM: real('distance_m'),
});

export type Food = typeof foods.$inferSelect;
export type NewFood = typeof foods.$inferInsert;
export type LogEntry = typeof logEntries.$inferSelect;
export type NewLogEntry = typeof logEntries.$inferInsert;
export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type RecipeItem = typeof recipeItems.$inferSelect;
export type NewRecipeItem = typeof recipeItems.$inferInsert;
export type WeightEntry = typeof weightEntries.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type HealthDay = typeof healthDays.$inferSelect;
export type NewHealthDay = typeof healthDays.$inferInsert;
export type HealthWorkout = typeof healthWorkouts.$inferSelect;
export type Meal = LogEntry['meal'];
