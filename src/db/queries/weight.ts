import { asc, desc, eq } from 'drizzle-orm';

import { db } from '../client';
import { weightEntries, type WeightEntry } from '../schema';

export function allWeightsAsc(): WeightEntry[] {
  return db.select().from(weightEntries).orderBy(asc(weightEntries.day)).all();
}

export function recentWeightsDesc(limit = 60): WeightEntry[] {
  return db.select().from(weightEntries).orderBy(desc(weightEntries.day)).limit(limit).all();
}

/**
 * One weigh-in per day; re-logging a day overwrites it. A manual save always
 * wins outright — including over a previously health-imported value — because
 * the user typing a number is the strongest possible signal of intent.
 */
export function upsertWeight(day: string, weightKg: number): void {
  db.insert(weightEntries)
    .values({ day, weightKg, loggedAt: Date.now(), source: 'manual' })
    .onConflictDoUpdate({
      target: weightEntries.day,
      set: { weightKg, loggedAt: Date.now(), source: 'manual' },
    })
    .run();
}

/**
 * Import path for Apple Health / Health Connect sync (PLAN Part 2.2).
 * Dedupe rules, in priority order:
 *   1. A 'manual' entry for that day is NEVER overwritten — silent data loss
 *      of a hand-typed weigh-in is the failure mode the source column exists
 *      to prevent.
 *   2. Otherwise "latest sample of the day wins": an import replaces an
 *      earlier import for the same day (people weigh in twice; the second
 *      HealthKit sample supersedes the first).
 * Returns true when the row was written, so sync code can count imports.
 */
export function importWeight(
  day: string,
  weightKg: number,
  source: 'healthkit' | 'healthconnect',
): boolean {
  const existing = db.select().from(weightEntries).where(eq(weightEntries.day, day)).get();
  if (existing?.source === 'manual') return false;
  db.insert(weightEntries)
    .values({ day, weightKg, loggedAt: Date.now(), source })
    .onConflictDoUpdate({
      target: weightEntries.day,
      set: { weightKg, loggedAt: Date.now(), source },
    })
    .run();
  return true;
}

export function deleteWeight(id: number): void {
  db.delete(weightEntries).where(eq(weightEntries.id, id)).run();
}
