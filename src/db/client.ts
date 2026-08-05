import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

/**
 * Hand-rolled migrations: append-only SQL, tracked with PRAGMA user_version.
 * Never edit an applied migration — add a new one (PLAN §4).
 */
const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    brand TEXT,
    barcode TEXT,
    source TEXT NOT NULL DEFAULT 'custom',
    source_id TEXT,
    per_100 INTEGER NOT NULL DEFAULT 1,
    calories REAL NOT NULL,
    protein REAL NOT NULL DEFAULT 0,
    carbs REAL NOT NULL DEFAULT 0,
    fat REAL NOT NULL DEFAULT 0,
    fiber REAL,
    sugar REAL,
    sat_fat REAL,
    sodium_mg REAL,
    serving_qty REAL,
    serving_unit TEXT,
    serving_name TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_foods_barcode ON foods(barcode);
  CREATE INDEX idx_foods_name ON foods(name);

  CREATE TABLE log_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    meal TEXT NOT NULL,
    logged_at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    food_id INTEGER,
    recipe_id INTEGER,
    name TEXT NOT NULL,
    amount REAL,
    amount_unit TEXT,
    grams REAL,
    calories REAL NOT NULL,
    protein REAL NOT NULL DEFAULT 0,
    carbs REAL NOT NULL DEFAULT 0,
    fat REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_log_day ON log_entries(day);

  CREATE TABLE recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    servings REAL NOT NULL DEFAULT 1,
    notes TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE recipe_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    food_id INTEGER NOT NULL,
    amount REAL,
    amount_unit TEXT,
    grams REAL,
    calories REAL NOT NULL,
    protein REAL NOT NULL DEFAULT 0,
    carbs REAL NOT NULL DEFAULT 0,
    fat REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE weight_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL UNIQUE,
    weight_kg REAL NOT NULL,
    logged_at INTEGER NOT NULL
  );

  CREATE TABLE settings (
    id INTEGER PRIMARY KEY,
    unit_weight TEXT NOT NULL DEFAULT 'lb',
    unit_food TEXT NOT NULL DEFAULT 'g',
    target_weight_kg REAL,
    calorie_target INTEGER,
    protein_target_g INTEGER,
    carb_target_g INTEGER,
    fat_target_g INTEGER,
    goal_note TEXT,
    onboarded INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO settings (id) VALUES (1);
  `,
  // v2 — Part 2.2 groundwork + USDA proxy (PLAN Part 2 / §11):
  //  - weight_entries.source distinguishes manual weigh-ins from future
  //    HealthKit/Health Connect imports so sync can dedupe without ever
  //    silently overwriting something the user typed by hand.
  //  - settings.usda_proxy_url stores the deployed macrochef-api base URL;
  //    empty/null means "no proxy" and the app quietly stays local + OFF only.
  `
  ALTER TABLE weight_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
  ALTER TABLE settings ADD COLUMN usda_proxy_url TEXT;
  `,
];

export const sqlite = openDatabaseSync('macrochef.db');
export const db = drizzle(sqlite, { schema });

function runMigrations(): void {
  sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = sqlite.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    sqlite.withTransactionSync(() => {
      sqlite.execSync(MIGRATIONS[v]);
      sqlite.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

// Module side-effect: every DB consumer imports this file, so the schema is
// guaranteed current before any query runs.
runMigrations();
