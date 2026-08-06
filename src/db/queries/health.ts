import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';

import { db } from '../client';
import { healthDays, healthWorkouts, type HealthDay, type HealthWorkout } from '../schema';

/**
 * Apple Health cache reads/writes (PLAN Part 3). Unlike the food log these
 * rows are disposable: they mirror HealthKit, so a re-sync may legitimately
 * replace them wholesale.
 */

export interface HealthDayInput {
  day: string;
  steps: number | null;
  activeEnergyKcal: number | null;
  basalEnergyKcal: number | null;
  exerciseMinutes: number | null;
  sleepMinutes: number | null;
}

/**
 * Replace the rows for the synced days. Each input row carries ALL metrics
 * for that day (the sync computes them together), so a plain overwrite is
 * correct and lets a metric deleted in Health disappear here too.
 */
export function upsertHealthDays(rows: HealthDayInput[]): void {
  if (!rows.length) return;
  const syncedAt = Date.now();
  db.transaction((tx) => {
    for (const r of rows) {
      tx.insert(healthDays)
        .values({ ...r, syncedAt })
        .onConflictDoUpdate({
          target: healthDays.day,
          set: {
            steps: r.steps,
            activeEnergyKcal: r.activeEnergyKcal,
            basalEnergyKcal: r.basalEnergyKcal,
            exerciseMinutes: r.exerciseMinutes,
            sleepMinutes: r.sleepMinutes,
            syncedAt,
          },
        })
        .run();
    }
  });
}

export function upsertHealthWorkouts(rows: HealthWorkout[]): void {
  if (!rows.length) return;
  db.transaction((tx) => {
    for (const w of rows) {
      tx.insert(healthWorkouts)
        .values(w)
        .onConflictDoUpdate({
          target: healthWorkouts.uuid,
          set: {
            day: w.day,
            activity: w.activity,
            startMs: w.startMs,
            endMs: w.endMs,
            durationSec: w.durationSec,
            energyKcal: w.energyKcal,
            distanceM: w.distanceM,
          },
        })
        .run();
    }
  });
}

/**
 * Drop workouts HealthKit no longer reports inside a re-synced window. The
 * sync passes the window it just fetched plus the UUIDs it saw; anything
 * else in that range was deleted in Health and should not linger here.
 */
export function pruneHealthWorkouts(fromDay: string, toDay: string, keepUuids: string[]): void {
  const inWindow = db
    .select()
    .from(healthWorkouts)
    .where(and(gte(healthWorkouts.day, fromDay), lte(healthWorkouts.day, toDay)))
    .all();
  const keep = new Set(keepUuids);
  const stale = inWindow.filter((w) => !keep.has(w.uuid)).map((w) => w.uuid);
  if (stale.length) {
    db.delete(healthWorkouts).where(inArray(healthWorkouts.uuid, stale)).run();
  }
}

export function healthDaysSince(fromDay: string): HealthDay[] {
  return db.select().from(healthDays).where(gte(healthDays.day, fromDay)).all();
}

export function healthDay(day: string): HealthDay | undefined {
  return db.select().from(healthDays).where(eq(healthDays.day, day)).get();
}

export function workoutsSince(fromDay: string): HealthWorkout[] {
  return db
    .select()
    .from(healthWorkouts)
    .where(gte(healthWorkouts.day, fromDay))
    .orderBy(desc(healthWorkouts.startMs))
    .all();
}

/** Wipe the whole cache — used when the user disconnects Apple Health. */
export function clearHealthCache(): void {
  db.delete(healthDays).run();
  db.delete(healthWorkouts).run();
}
