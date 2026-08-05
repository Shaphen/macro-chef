import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

import type { MacroTotals } from '../../lib/nutrition';
import { db } from '../client';
import { logEntries, type LogEntry, type NewLogEntry } from '../schema';

export function entriesForDay(day: string): LogEntry[] {
  return db
    .select()
    .from(logEntries)
    .where(eq(logEntries.day, day))
    .orderBy(asc(logEntries.loggedAt))
    .all();
}

export function addEntry(
  entry: Omit<NewLogEntry, 'loggedAt'> & { loggedAt?: number },
): LogEntry {
  return db
    .insert(logEntries)
    .values({ loggedAt: Date.now(), ...entry })
    .returning()
    .get();
}

export function getEntry(id: number): LogEntry | undefined {
  return db.select().from(logEntries).where(eq(logEntries.id, id)).get();
}

/**
 * Patch an existing entry (edit-amount / move-meal flows). The caller is
 * responsible for having recomputed the macro snapshot when the amount
 * changed — this function deliberately doesn't know any nutrition math
 * (that lives in lib/nutrition.ts only, PLAN §5).
 */
export function updateEntry(id: number, patch: Partial<NewLogEntry>): void {
  db.update(logEntries).set(patch).where(eq(logEntries.id, id)).run();
}

/**
 * Copy an entry to another day/meal ("copy yesterday's breakfast", PLAN §8).
 * Copies the stored SNAPSHOT verbatim rather than recomputing from the
 * current food — a duplicate of what you ate should claim exactly what the
 * original claimed, even if the food's values were edited since.
 */
export function duplicateEntry(id: number, day: string, meal: LogEntry['meal']): LogEntry | undefined {
  const src = getEntry(id);
  if (!src) return undefined;
  const { id: _id, ...rest } = src;
  return db
    .insert(logEntries)
    .values({ ...rest, day, meal, loggedAt: Date.now() })
    .returning()
    .get();
}

export function deleteEntry(id: number): void {
  db.delete(logEntries).where(eq(logEntries.id, id)).run();
}

/**
 * Which days in [fromDay, toDay] have at least one entry — powers the
 * "logged day" dots on the Log week strip and month calendar (PLAN Part 2.1).
 * DISTINCT over the indexed `day` column keeps it cheap even with years of
 * history, so callers can re-run it every time the visible week changes.
 */
export function loggedDaysBetween(fromDay: string, toDay: string): Set<string> {
  const rows = db
    .selectDistinct({ day: logEntries.day })
    .from(logEntries)
    .where(and(gte(logEntries.day, fromDay), lte(logEntries.day, toDay)))
    .all();
  return new Set(rows.map((r) => r.day));
}

/** Day totals are always computed on read, never stored (PLAN §5). */
export function dayTotals(day: string): MacroTotals {
  const row = db
    .select({
      calories: sql<number>`coalesce(sum(${logEntries.calories}), 0)`,
      protein: sql<number>`coalesce(sum(${logEntries.protein}), 0)`,
      carbs: sql<number>`coalesce(sum(${logEntries.carbs}), 0)`,
      fat: sql<number>`coalesce(sum(${logEntries.fat}), 0)`,
    })
    .from(logEntries)
    .where(eq(logEntries.day, day))
    .get();
  return row ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

/** Calories per day since `fromDay` inclusive (dashboard chart). */
export function dailyCaloriesSince(fromDay: string): { day: string; calories: number }[] {
  return db
    .select({
      day: logEntries.day,
      calories: sql<number>`coalesce(sum(${logEntries.calories}), 0)`,
    })
    .from(logEntries)
    .where(gte(logEntries.day, fromDay))
    .groupBy(logEntries.day)
    .orderBy(asc(logEntries.day))
    .all();
}
