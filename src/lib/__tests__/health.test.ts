/**
 * Apple Health mapping rules (PLAN Part 3). The DB layer is mocked so these
 * run on any machine: the point is the sample→row math, which is where the
 * subtle bugs live (double-counted sleep, unit mix-ups, day attribution).
 */

import { importWeight } from '../../db/queries/weight';
import {
  applyWeightSamples,
  buildHealthDayRows,
  mergeIntervals,
  sleepMinutesByDay,
  syncWindow,
  toWorkoutRow,
  workoutLabel,
} from '../health';

// Hoisted above the imports by babel-plugin-jest-hoist, so importing
// lib/health here never opens SQLite.
jest.mock('../../db/queries/weight', () => ({
  importWeight: jest.fn(() => true),
}));
jest.mock('../../db/queries/health', () => ({
  upsertHealthDays: jest.fn(),
  upsertHealthWorkouts: jest.fn(),
  pruneHealthWorkouts: jest.fn(),
}));

const mockImportWeight = importWeight as jest.MockedFunction<typeof importWeight>;

/** Local-time epoch ms, so these assertions hold in any timezone. */
function at(y: number, m: number, d: number, h: number, min = 0): number {
  return new Date(y, m - 1, d, h, min).getTime();
}

describe('mergeIntervals', () => {
  it('merges overlapping intervals and keeps disjoint ones', () => {
    expect(
      mergeIntervals([
        { start: 10, end: 20 },
        { start: 15, end: 30 },
        { start: 50, end: 60 },
      ]),
    ).toEqual([
      { start: 10, end: 30 },
      { start: 50, end: 60 },
    ]);
  });

  it('sorts before merging and drops empty intervals', () => {
    expect(
      mergeIntervals([
        { start: 50, end: 60 },
        { start: 5, end: 5 },
        { start: 10, end: 55 },
      ]),
    ).toEqual([{ start: 10, end: 60 }]);
  });

  it('swallows an interval fully contained in another', () => {
    expect(
      mergeIntervals([
        { start: 0, end: 100 },
        { start: 20, end: 30 },
      ]),
    ).toEqual([{ start: 0, end: 100 }]);
  });
});

describe('sleepMinutesByDay', () => {
  it('counts only asleep values, ignoring in-bed and awake', () => {
    const byDay = sleepMinutesByDay([
      { value: 0, startMs: at(2026, 8, 4, 22), endMs: at(2026, 8, 5, 7) }, // inBed
      { value: 3, startMs: at(2026, 8, 4, 23), endMs: at(2026, 8, 5, 3) }, // core, 4h
      { value: 2, startMs: at(2026, 8, 5, 3), endMs: at(2026, 8, 5, 3, 30) }, // awake
      { value: 5, startMs: at(2026, 8, 5, 3, 30), endMs: at(2026, 8, 5, 6) }, // REM, 2.5h
    ]);
    expect(byDay.get('2026-08-05')).toBeCloseTo(390); // 4h + 2.5h
    expect(byDay.size).toBe(1);
  });

  it('does not double-count the same night reported by two sources', () => {
    const watch = { value: 1, startMs: at(2026, 8, 4, 23), endMs: at(2026, 8, 5, 7) };
    const phone = { value: 3, startMs: at(2026, 8, 4, 23, 30), endMs: at(2026, 8, 5, 6, 30) };
    expect(sleepMinutesByDay([watch, phone]).get('2026-08-05')).toBeCloseTo(480);
  });

  it('attributes a session crossing midnight to the day it ends', () => {
    const byDay = sleepMinutesByDay([
      { value: 1, startMs: at(2026, 8, 4, 22), endMs: at(2026, 8, 5, 6) },
    ]);
    expect(byDay.has('2026-08-04')).toBe(false);
    expect(byDay.get('2026-08-05')).toBeCloseTo(480);
  });

  it('adds a daytime nap to the same day', () => {
    const byDay = sleepMinutesByDay([
      { value: 1, startMs: at(2026, 8, 4, 23), endMs: at(2026, 8, 5, 6) },
      { value: 1, startMs: at(2026, 8, 5, 14), endMs: at(2026, 8, 5, 14, 45) },
    ]);
    expect(byDay.get('2026-08-05')).toBeCloseTo(465);
  });
});

describe('toWorkoutRow', () => {
  it('normalizes units and keys the day off the start date', () => {
    const row = toWorkoutRow({
      uuid: 'abc',
      workoutActivityType: 37,
      startDate: new Date(2026, 7, 5, 6, 30),
      endDate: new Date(2026, 7, 5, 7, 15),
      duration: { unit: 'min', quantity: 42 },
      totalEnergyBurned: { unit: 'kJ', quantity: 2092 },
      totalDistance: { unit: 'km', quantity: 8.2 },
    });
    expect(row).toMatchObject({
      uuid: 'abc',
      day: '2026-08-05',
      activity: 'Running',
      durationSec: 2520,
      distanceM: 8200,
    });
    expect(row.energyKcal).toBeCloseTo(500);
  });

  it('falls back to elapsed time when HealthKit reports no duration', () => {
    const row = toWorkoutRow({
      uuid: 'x',
      workoutActivityType: 9999,
      startDate: new Date(2026, 7, 5, 6, 0),
      endDate: new Date(2026, 7, 5, 6, 30),
    });
    expect(row.durationSec).toBe(1800);
    expect(row.activity).toBe('Workout');
    expect(row.energyKcal).toBeNull();
    expect(row.distanceM).toBeNull();
  });

  it('labels known activity types', () => {
    expect(workoutLabel(52)).toBe('Walking');
    expect(workoutLabel(50)).toBe('Strength Training');
  });
});

describe('buildHealthDayRows', () => {
  const empty = new Map<string, number>();

  it('emits complete rows, nulling metrics with no data', () => {
    const rows = buildHealthDayRows('2026-08-04', '2026-08-05', {
      steps: new Map([['2026-08-04', 8241.6]]),
      activeEnergy: new Map([['2026-08-04', 512.4]]),
      basalEnergy: empty,
      exercise: empty,
      sleep: new Map([['2026-08-05', 430]]),
    });
    expect(rows).toEqual([
      {
        day: '2026-08-04',
        steps: 8242,
        activeEnergyKcal: 512.4,
        basalEnergyKcal: null,
        exerciseMinutes: null,
        sleepMinutes: null,
      },
      {
        day: '2026-08-05',
        steps: null,
        activeEnergyKcal: null,
        basalEnergyKcal: null,
        exerciseMinutes: null,
        sleepMinutes: 430,
      },
    ]);
  });

  it('skips days with no data at all', () => {
    const rows = buildHealthDayRows('2026-08-01', '2026-08-05', {
      steps: new Map([['2026-08-03', 100]]),
      activeEnergy: empty,
      basalEnergy: empty,
      exercise: empty,
      sleep: empty,
    });
    expect(rows.map((r) => r.day)).toEqual(['2026-08-03']);
  });
});

describe('syncWindow', () => {
  const now = new Date(2026, 7, 5, 12, 0);

  it('backfills a year on the first sync', () => {
    const w = syncWindow(null, now);
    expect(w).toMatchObject({ fromDay: '2025-08-06', toDay: '2026-08-05', isBackfill: true });
  });

  it('re-reads a few days before the last sync so late samples are not missed', () => {
    const w = syncWindow(new Date(2026, 7, 5, 9, 0).getTime(), now);
    expect(w).toMatchObject({ fromDay: '2026-08-02', toDay: '2026-08-05', isBackfill: false });
  });
});

describe('applyWeightSamples', () => {
  beforeEach(() => {
    mockImportWeight.mockClear();
    mockImportWeight.mockReturnValue(true);
  });

  it('keeps only the latest sample per day', () => {
    const imported = applyWeightSamples(
      [
        { day: '2026-08-05', weightKg: 80.5, sampledAt: at(2026, 8, 5, 7) },
        { day: '2026-08-05', weightKg: 81.2, sampledAt: at(2026, 8, 5, 19) },
        { day: '2026-08-04', weightKg: 80.9, sampledAt: at(2026, 8, 4, 7) },
      ],
      'healthkit',
    );
    expect(imported).toBe(2);
    expect(mockImportWeight).toHaveBeenCalledTimes(2);
    expect(mockImportWeight).toHaveBeenCalledWith('2026-08-05', 81.2, 'healthkit');
  });

  it('does not count days the DB refused (manual weigh-ins win)', () => {
    mockImportWeight.mockReturnValue(false);
    const imported = applyWeightSamples(
      [{ day: '2026-08-05', weightKg: 81.2, sampledAt: at(2026, 8, 5, 7) }],
      'healthkit',
    );
    expect(imported).toBe(0);
  });
});
