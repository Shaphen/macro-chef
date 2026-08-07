import { and, like, sql } from 'drizzle-orm';

import { searchTerms } from '../../lib/seed-foods';
import { db } from '../client';
import { seedFoods, type SeedFood } from '../schema';

/**
 * Offline search over the bundled generic-food database (PLAN Part 5).
 * Every whitespace-separated term must match somewhere in the name, so
 * "chicken breast roast" finds "Chicken, broilers or fryers, breast, meat
 * only, cooked, roasted". Shortest names first: SR Legacy descriptions grow
 * a clause per qualifier, so short ≈ the canonical variant of a food.
 */
export function searchSeedFoods(query: string, limit = 12): SeedFood[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  return db
    .select()
    .from(seedFoods)
    .where(and(...terms.map((t) => like(seedFoods.name, `%${t}%`))))
    .orderBy(sql`length(${seedFoods.name})`, seedFoods.name)
    .limit(limit)
    .all();
}
