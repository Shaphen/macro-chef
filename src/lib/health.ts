import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

// Type-only: erased at compile time, so this never becomes a runtime require
// of the native module (which would break the Expo Go bundle).
import type {
  QuantityTypeIdentifier,
  UnitForIdentifier,
} from '@kingstinct/react-native-healthkit';

import {
  pruneHealthWorkouts,
  upsertHealthDays,
  upsertHealthWorkouts,
  type HealthDayInput,
} from '../db/queries/health';
import { importWeight } from '../db/queries/weight';
import type { HealthWorkout } from '../db/schema';
import { addDays, dayKey, parseDayKey } from './dates';

/**
 * Apple Health adapter (PLAN Part 3) — the ONLY file allowed to touch the
 * native health module.
 *
 * Read-only, by design: MacroChef never writes to Health. It imports body
 * mass into the weight log and caches steps / active + resting energy /
 * exercise minutes / sleep / workouts into `health_days` + `health_workouts`
 * for the Activity screen.
 *
 * Expo Go safety: HealthKit is a Nitro native module, so `require`-ing it
 * inside Expo Go throws. The require therefore happens lazily, behind an
 * execution-environment check, and every entry point degrades to "not
 * available" instead of crashing. That keeps `npx expo start` + Expo Go
 * working for all the non-health work (PLAN §2), while the dev/TestFlight
 * build gets the real thing.
 */

/** Everything the app asks to read. Never request what isn't displayed. */
const READ_TYPES = [
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierBasalEnergyBurned',
  'HKQuantityTypeIdentifierAppleExerciseTime',
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKWorkoutTypeIdentifier',
] as const;

/** How far back the first sync reaches for daily activity + workouts. */
const BACKFILL_DAYS = 365;
/**
 * Every incremental sync re-reads this many days before the last sync.
 * Samples arrive late (a watch syncing hours later, a scale app back-filling)
 * and sleep is stitched together after the fact, so a strict "since last
 * sync" window would permanently miss data.
 */
const OVERLAP_DAYS = 3;

/** HealthKit sleep-analysis values that count as actually asleep. */
const ASLEEP_VALUES = new Set([1, 3, 4, 5]); // unspecified, core, deep, REM

type HealthKitModule = typeof import('@kingstinct/react-native-healthkit');

let cachedModule: HealthKitModule | null | undefined;

function loadHealthKit(): HealthKitModule | null {
  if (cachedModule !== undefined) return cachedModule;
  cachedModule = null;
  if (Platform.OS !== 'ios') return cachedModule;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return cachedModule;
  try {
    // Deliberately a runtime require, not a top-level import: in Expo Go the
    // module's native side is missing and importing it would break the whole
    // bundle rather than just this feature.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@kingstinct/react-native-healthkit') as HealthKitModule;
    cachedModule = mod.isHealthDataAvailable() ? mod : null;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export interface HealthAvailability {
  available: boolean;
  reason: string;
}

/** Whether HealthKit can actually be used in this build, and why not if it can't. */
export function healthAvailability(): HealthAvailability {
  if (Platform.OS !== 'ios') {
    return { available: false, reason: 'Health Connect arrives with the Android release.' };
  }
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return {
      available: false,
      reason:
        'Apple Health needs the development build — Expo Go can’t load HealthKit. See README “Apple Health / dev build”.',
    };
  }
  if (!loadHealthKit()) {
    return { available: false, reason: 'HealthKit isn’t available on this device.' };
  }
  return {
    available: true,
    reason:
      'Reads weight, steps, energy, exercise, workouts and sleep. MacroChef never writes to Health.',
  };
}

/**
 * Show the HealthKit permission sheet. Resolving `true` means the sheet was
 * completed, NOT that anything was granted — Apple deliberately hides read
 * denials, so a denied type simply returns no samples. That's why the UI
 * reports "0 found" with a pointer to Settings rather than claiming success.
 */
export async function requestHealthPermission(): Promise<boolean> {
  const hk = loadHealthKit();
  if (!hk) throw new Error('Apple Health is not available in this build.');
  return hk.requestAuthorization({ toRead: READ_TYPES });
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable without a device — see __tests__/health.test.ts)
// ---------------------------------------------------------------------------

export interface HealthWeightSample {
  /** Local day the sample belongs to ('YYYY-MM-DD'). */
  day: string;
  weightKg: number;
  /** Epoch ms of the sample, used to pick the latest sample per day. */
  sampledAt: number;
}

/**
 * Bucket weight samples by local day, keep the latest per day, and hand each
 * winner to `importWeight`. `force` (used by the backfill) lets Health's
 * history replace hand-typed entries for the days it covers.
 * Returns the number of days actually written.
 */
export function applyWeightSamples(
  samples: HealthWeightSample[],
  source: 'healthkit' | 'healthconnect',
  force = false,
): number {
  const latestPerDay = new Map<string, HealthWeightSample>();
  for (const s of samples) {
    const current = latestPerDay.get(s.day);
    if (!current || s.sampledAt > current.sampledAt) latestPerDay.set(s.day, s);
  }
  let imported = 0;
  for (const s of latestPerDay.values()) {
    if (importWeight(s.day, s.weightKg, source, force)) imported++;
  }
  return imported;
}

export interface Interval {
  start: number;
  end: number;
}

/**
 * Merge overlapping/touching intervals. Sleep is reported by every source
 * that observed it (watch, phone, third-party trackers) with heavy overlap,
 * so summing raw sample durations double-counts a night badly.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    if (last && next.start <= last.end) {
      if (next.end > last.end) last.end = next.end;
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

export interface SleepSample {
  value: number;
  startMs: number;
  endMs: number;
}

/**
 * Hour at which a sleep day rolls over. Health groups sleep into a day that
 * runs 18:00 → 18:00, so everything from tonight's bedtime through tomorrow
 * afternoon counts as tomorrow's sleep.
 */
const SLEEP_DAY_CUTOFF_HOUR = 18;

/**
 * The day an asleep interval belongs to.
 *
 * This is NOT "the day it ends", which is the obvious-looking rule and is
 * wrong: a watch reports a night as dozens of stage fragments separated by
 * brief awake gaps, so an end-of-interval rule files everything before
 * midnight under the previous day and reports a short night (the bug that
 * showed 5h15m for a 6h46m night). Bucketing on the 18:00 boundary keeps a
 * whole night — pre- and post-midnight fragments alike — on the wake day,
 * and still puts an afternoon nap on the day it happened.
 */
export function sleepDayKey(startMs: number): string {
  const start = new Date(startMs);
  const day = dayKey(start);
  return start.getHours() >= SLEEP_DAY_CUTOFF_HOUR ? addDays(day, 1) : day;
}

/**
 * Asleep minutes per local day. Overlapping intervals are merged first —
 * several sources (watch, phone, third-party trackers) report the same night
 * — then each interval is credited to its sleep day.
 */
export function sleepMinutesByDay(samples: SleepSample[]): Map<string, number> {
  const asleep = samples
    .filter((s) => ASLEEP_VALUES.has(s.value))
    .map((s) => ({ start: s.startMs, end: s.endMs }));
  const byDay = new Map<string, number>();
  for (const interval of mergeIntervals(asleep)) {
    const day = sleepDayKey(interval.start);
    const minutes = (interval.end - interval.start) / 60000;
    byDay.set(day, (byDay.get(day) ?? 0) + minutes);
  }
  return byDay;
}

/** HealthKit workout-activity enum → display label. */
const WORKOUT_LABELS: Record<number, string> = {
  13: 'Cycling',
  16: 'Elliptical',
  20: 'Functional Strength',
  24: 'Hiking',
  35: 'Rowing',
  37: 'Running',
  44: 'Stair Climbing',
  46: 'Swimming',
  50: 'Strength Training',
  52: 'Walking',
  57: 'Yoga',
  59: 'Core Training',
  62: 'Flexibility',
  63: 'HIIT',
  64: 'Jump Rope',
  65: 'Kickboxing',
  66: 'Pilates',
  69: 'Step Training',
  73: 'Mixed Cardio',
  79: 'Pickleball',
  80: 'Cooldown',
  3000: 'Workout',
};

export function workoutLabel(activityType: number): string {
  return WORKOUT_LABELS[activityType] ?? 'Workout';
}

interface Quantity {
  readonly unit: string;
  readonly quantity: number;
}

/** Raw shape read off a HealthKit workout sample (subset MacroChef stores). */
export interface RawWorkout {
  uuid: string;
  workoutActivityType: number;
  startDate: Date;
  endDate: Date;
  duration?: Quantity;
  totalEnergyBurned?: Quantity;
  totalDistance?: Quantity;
}

function toKcal(q?: Quantity): number | null {
  if (!q) return null;
  switch (q.unit) {
    case 'kcal':
    case 'Cal':
      return q.quantity;
    case 'cal':
      return q.quantity / 1000;
    case 'kJ':
      return q.quantity / 4.184;
    case 'J':
      return q.quantity / 4184;
    default:
      return q.quantity;
  }
}

function toMeters(q?: Quantity): number | null {
  if (!q) return null;
  switch (q.unit) {
    case 'm':
      return q.quantity;
    case 'km':
      return q.quantity * 1000;
    case 'cm':
      return q.quantity / 100;
    case 'mi':
      return q.quantity * 1609.344;
    case 'ft':
      return q.quantity * 0.3048;
    case 'yd':
      return q.quantity * 0.9144;
    case 'in':
      return q.quantity * 0.0254;
    default:
      return q.quantity;
  }
}

function toSeconds(q: Quantity | undefined, fallbackMs: number): number {
  if (!q) return fallbackMs / 1000;
  switch (q.unit) {
    case 's':
      return q.quantity;
    case 'ms':
      return q.quantity / 1000;
    case 'min':
      return q.quantity * 60;
    case 'hr':
      return q.quantity * 3600;
    default:
      return q.quantity;
  }
}

/**
 * Map a HealthKit workout to a stored row. Duration comes from HealthKit's
 * own value (which excludes paused time) and falls back to elapsed time.
 */
export function toWorkoutRow(raw: RawWorkout): HealthWorkout {
  const startMs = raw.startDate.getTime();
  const endMs = raw.endDate.getTime();
  return {
    uuid: raw.uuid,
    day: dayKey(raw.startDate),
    activity: workoutLabel(raw.workoutActivityType),
    startMs,
    endMs,
    durationSec: toSeconds(raw.duration, endMs - startMs),
    energyKcal: toKcal(raw.totalEnergyBurned),
    distanceM: toMeters(raw.totalDistance),
  };
}

/**
 * Assemble one complete row per day in the window from the per-metric maps.
 * Rows are complete (missing metric = explicit null) so writing them can
 * safely overwrite, which is how deleted Health data stops lingering.
 */
export function buildHealthDayRows(
  fromDay: string,
  toDay: string,
  metrics: {
    steps: Map<string, number>;
    activeEnergy: Map<string, number>;
    basalEnergy: Map<string, number>;
    exercise: Map<string, number>;
    sleep: Map<string, number>;
  },
): HealthDayInput[] {
  const rows: HealthDayInput[] = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    const steps = metrics.steps.get(day);
    const activeEnergy = metrics.activeEnergy.get(day);
    const basalEnergy = metrics.basalEnergy.get(day);
    const exercise = metrics.exercise.get(day);
    const sleep = metrics.sleep.get(day);
    const empty =
      steps === undefined &&
      activeEnergy === undefined &&
      basalEnergy === undefined &&
      exercise === undefined &&
      sleep === undefined;
    // A day with nothing at all isn't worth a row — it would be
    // indistinguishable from "synced but no data" in every chart anyway.
    if (empty) continue;
    rows.push({
      day,
      steps: steps === undefined ? null : Math.round(steps),
      activeEnergyKcal: activeEnergy ?? null,
      basalEnergyKcal: basalEnergy ?? null,
      exerciseMinutes: exercise ?? null,
      sleepMinutes: sleep ?? null,
    });
  }
  return rows;
}

/** Window a sync should cover, given when it last completed. */
export function syncWindow(lastSyncAt: number | null, now = new Date()): {
  fromDay: string;
  toDay: string;
  isBackfill: boolean;
} {
  const toDay = dayKey(now);
  if (!lastSyncAt) {
    return { fromDay: addDays(toDay, -(BACKFILL_DAYS - 1)), toDay, isBackfill: true };
  }
  const fromDay = addDays(dayKey(new Date(lastSyncAt)), -OVERLAP_DAYS);
  return { fromDay, toDay, isBackfill: false };
}

// ---------------------------------------------------------------------------
// Native reads
// ---------------------------------------------------------------------------

/**
 * Per-day totals for a cumulative quantity type. Uses HealthKit's statistics
 * collection rather than raw samples so overlapping sources (iPhone + Watch
 * both counting steps) are de-duplicated by HealthKit itself.
 */
async function dailySums<T extends QuantityTypeIdentifier>(
  hk: HealthKitModule,
  identifier: T,
  unit: UnitForIdentifier<T>,
  startDate: Date,
  endDate: Date,
): Promise<Map<string, number>> {
  const byDay = new Map<string, number>();
  try {
    const collection = await hk.queryStatisticsCollectionForQuantity(
      identifier,
      ['cumulativeSum'],
      startDate,
      { day: 1 },
      { unit, filter: { date: { startDate, endDate } } },
    );
    for (const stat of collection) {
      const sum = stat.sumQuantity?.quantity;
      if (sum === undefined || !stat.startDate) continue;
      byDay.set(dayKey(new Date(stat.startDate)), sum);
    }
  } catch {
    // A type the user denied (or that this device never records, e.g.
    // exercise minutes without a Watch) must not fail the whole sync.
  }
  return byDay;
}

export interface HealthSyncResult {
  fromDay: string;
  toDay: string;
  /** Days of activity written. */
  days: number;
  workouts: number;
  /** Weigh-ins imported (manual entries are skipped, so this can be 0). */
  weighIns: number;
  /** True when nothing at all came back — usually means reads were denied. */
  empty: boolean;
}

/**
 * Pull everything MacroChef reads, in one pass, and persist it.
 * `lastSyncAt` null → first-run backfill (a year of activity, all weight
 * history). Safe to call repeatedly: every write is keyed by day or sample
 * UUID, so re-syncing an overlapping window is idempotent.
 */
export async function syncHealth(lastSyncAt: number | null): Promise<HealthSyncResult> {
  const hk = loadHealthKit();
  if (!hk) throw new Error('Apple Health is not available in this build.');

  const { fromDay, toDay, isBackfill } = syncWindow(lastSyncAt);
  const startDate = parseDayKey(fromDay);
  // Exclusive-ish upper bound: local midnight after today, so today's
  // partial totals are included.
  const endDate = parseDayKey(addDays(toDay, 1));

  const [steps, activeEnergy, basalEnergy, exercise] = await Promise.all([
    dailySums(hk, 'HKQuantityTypeIdentifierStepCount', 'count', startDate, endDate),
    dailySums(hk, 'HKQuantityTypeIdentifierActiveEnergyBurned', 'kcal', startDate, endDate),
    dailySums(hk, 'HKQuantityTypeIdentifierBasalEnergyBurned', 'kcal', startDate, endDate),
    dailySums(hk, 'HKQuantityTypeIdentifierAppleExerciseTime', 'min', startDate, endDate),
  ]);

  let sleep = new Map<string, number>();
  try {
    const sleepSamples = await hk.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
      limit: 0,
      ascending: true,
      filter: { date: { startDate, endDate } },
    });
    sleep = sleepMinutesByDay(
      sleepSamples.map((s) => ({
        value: s.value as number,
        startMs: s.startDate.getTime(),
        endMs: s.endDate.getTime(),
      })),
    );
  } catch {
    // denied or unavailable — leave sleep empty
  }

  const dayRows = buildHealthDayRows(fromDay, toDay, {
    steps,
    activeEnergy,
    basalEnergy,
    exercise,
    sleep,
  });
  upsertHealthDays(dayRows);

  let workoutRows: HealthWorkout[] = [];
  try {
    const workouts = await hk.queryWorkoutSamples({
      limit: 0,
      ascending: false,
      filter: { date: { startDate, endDate } },
    });
    workoutRows = workouts.map((w) =>
      toWorkoutRow({
        uuid: w.uuid,
        workoutActivityType: w.workoutActivityType as number,
        startDate: w.startDate,
        endDate: w.endDate,
        duration: w.duration,
        totalEnergyBurned: w.totalEnergyBurned,
        totalDistance: w.totalDistance,
      }),
    );
    upsertHealthWorkouts(workoutRows);
    pruneHealthWorkouts(
      fromDay,
      toDay,
      workoutRows.map((w) => w.uuid),
    );
  } catch {
    // denied or unavailable — keep whatever was cached
  }

  let weighIns = 0;
  try {
    const weights = await hk.queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', {
      limit: 0,
      unit: 'kg',
      ascending: true,
      // The first sync takes ALL weight history so the EWMA trend starts
      // from real data instead of a one-year cliff.
      filter: isBackfill ? undefined : { date: { startDate, endDate } },
    });
    weighIns = applyWeightSamples(
      weights.map((s) => ({
        day: dayKey(s.startDate),
        weightKg: s.quantity,
        sampledAt: s.startDate.getTime(),
      })),
      'healthkit',
      // Backfill = "import my real history"; it may replace hand-typed rows.
      isBackfill,
    );
  } catch {
    // denied or unavailable — weight stays manual-only
  }

  return {
    fromDay,
    toDay,
    days: dayRows.length,
    workouts: workoutRows.length,
    weighIns,
    empty: dayRows.length === 0 && workoutRows.length === 0 && weighIns === 0,
  };
}

/** Convenience for mapping a native sample date to the app's day key. */
export function sampleDay(date: Date): string {
  return dayKey(date);
}
