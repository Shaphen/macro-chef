import { asc, eq, gte, sql } from 'drizzle-orm';

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

export function deleteEntry(id: number): void {
  db.delete(logEntries).where(eq(logEntries.id, id)).run();
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
