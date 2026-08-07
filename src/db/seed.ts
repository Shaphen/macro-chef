import type { SQLiteDatabase } from 'expo-sqlite';

import { SEED_FOODS_VERSION } from '../data/seed-foods-version';
import type { SeedData } from '../lib/seed-foods';

/**
 * Import the bundled generic-food JSON into seed_foods (PLAN Part 5).
 * Called from client.ts right after migrations, so "import any query file"
 * also guarantees the seed is present.
 *
 * The steady-state cost is one SELECT: the bundled version ships as a tiny
 * generated constant precisely so this check never require()s the ~860 KB
 * JSON — that only enters JS memory on the launch that actually imports it
 * (first run, or first run after an update ships a new seed bundle).
 */
export function ensureSeedFoods(sqlite: SQLiteDatabase): void {
  const loaded = sqlite.getFirstSync<{ version: number }>(
    'SELECT version FROM seed_meta WHERE id = 1',
  );
  if (loaded?.version === SEED_FOODS_VERSION) return;

  const data = require('../data/seed-foods.json') as SeedData;

  // Column order must match SeedFoodTuple (src/lib/seed-foods.ts).
  const stmt = sqlite.prepareSync(
    `INSERT INTO seed_foods
       (fdc_id, name, calories, protein, carbs, fat, fiber, sugar, sat_fat, sodium_mg, serving_qty, serving_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  try {
    sqlite.withTransactionSync(() => {
      sqlite.runSync('DELETE FROM seed_foods');
      for (const food of data.foods) stmt.executeSync(food);
      sqlite.runSync('INSERT OR REPLACE INTO seed_meta (id, version) VALUES (1, ?)', [
        data.version,
      ]);
    });
  } finally {
    stmt.finalizeSync();
  }
}
