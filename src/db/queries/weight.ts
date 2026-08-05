import { asc, desc, eq } from 'drizzle-orm';

import { db } from '../client';
import { weightEntries, type WeightEntry } from '../schema';

export function allWeightsAsc(): WeightEntry[] {
  return db.select().from(weightEntries).orderBy(asc(weightEntries.day)).all();
}

export function recentWeightsDesc(limit = 60): WeightEntry[] {
  return db.select().from(weightEntries).orderBy(desc(weightEntries.day)).limit(limit).all();
}

/** One weigh-in per day; re-logging a day overwrites it. */
export function upsertWeight(day: string, weightKg: number): void {
  db.insert(weightEntries)
    .values({ day, weightKg, loggedAt: Date.now() })
    .onConflictDoUpdate({
      target: weightEntries.day,
      set: { weightKg, loggedAt: Date.now() },
    })
    .run();
}

export function deleteWeight(id: number): void {
  db.delete(weightEntries).where(eq(weightEntries.id, id)).run();
}
