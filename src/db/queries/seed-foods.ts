import { inArray } from 'drizzle-orm';

import {
  parseQuery,
  prepareTarget,
  searchWithFallback,
  type SearchTarget,
} from '../../lib/food-search';
import { db } from '../client';
import { seedFoods, type SeedFood } from '../schema';

/**
 * Offline search over the bundled generic-food database (PLAN Part 5/7).
 *
 * Matching is tolerant rather than exact (see lib/food-search.ts): word order
 * doesn't matter, extra words are forgiven, and small typos still land —
 * "chiken breast" finds chicken breast, "greek yogurt" finds "Yogurt, Greek".
 * SR Legacy names are comma-stacked qualifier lists, so exact-substring
 * matching was a poor fit for them from the start.
 */

interface IndexEntry {
  fdcId: number;
  name: string;
  target: SearchTarget;
}

/**
 * Normalized names, built once and kept for the process lifetime.
 *
 * Safe to cache: seed_foods is written only by ensureSeedFoods(), which runs
 * as part of the db/client.ts module side-effect — i.e. strictly before any
 * query file can be imported, let alone called. Nothing mutates the table at
 * runtime. Rebuilding this per keystroke instead would mean re-reading and
 * re-normalizing ~7.8k rows every time.
 */
let nameIndex: IndexEntry[] | null = null;

function index(): IndexEntry[] {
  if (!nameIndex) {
    nameIndex = db
      .select({ fdcId: seedFoods.fdcId, name: seedFoods.name })
      .from(seedFoods)
      .all()
      .map((row) => ({ fdcId: row.fdcId, name: row.name, target: prepareTarget(row.name) }));
  }
  return nameIndex;
}

export function searchSeedFoods(query: string, limit = 12): SeedFood[] {
  const parsed = parseQuery(query);
  if (!parsed) return [];

  const ranked = searchWithFallback(index(), parsed, (entry) => entry.target)
    // Shortest name first among equal scores: SR Legacy descriptions gain a
    // clause per qualifier, so the short one is the canonical form of a food.
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.name.length - b.item.name.length ||
        a.item.name.localeCompare(b.item.name),
    )
    .slice(0, limit);
  if (!ranked.length) return [];

  // Only the winners are hydrated into full rows; the ranking pass never
  // needs the macro columns.
  const ids = ranked.map((hit) => hit.item.fdcId);
  const byId = new Map(
    db.select().from(seedFoods).where(inArray(seedFoods.fdcId, ids)).all().map((r) => [r.fdcId, r]),
  );
  return ids.map((id) => byId.get(id)).filter((row): row is SeedFood => row !== undefined);
}
