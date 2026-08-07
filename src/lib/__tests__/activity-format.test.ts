/**
 * Activity display formatting (PLAN Part 3 / Part 6). The workoutVisual
 * mapping is keyed by the humanized strings workoutLabel() emits, so the
 * contract test below walks every HealthKit activity type MacroChef knows
 * about — a renamed label would otherwise silently demote real workouts to
 * the generic badge.
 */

import {
  formatDistance,
  formatDuration,
  formatKcal,
  formatSteps,
  formatWorkoutDuration,
  workoutVisual,
} from '../activity-format';
import { workoutLabel } from '../health';

// Hoisted above the imports by babel-plugin-jest-hoist, so pulling
// workoutLabel out of lib/health here never opens SQLite (same pattern as
// health.test.ts — health.ts imports the DB query modules at the top level).
jest.mock('../../db/queries/weight', () => ({ importWeight: jest.fn(() => true) }));
jest.mock('../../db/queries/health', () => ({
  upsertHealthDays: jest.fn(),
  upsertHealthWorkouts: jest.fn(),
  pruneHealthWorkouts: jest.fn(),
}));

// Every activity type in health.ts WORKOUT_LABELS, plus 3000 ("Workout").
const KNOWN_ACTIVITY_TYPES = [
  13, 16, 20, 24, 35, 37, 44, 46, 50, 52, 57, 59, 62, 63, 64, 65, 66, 69, 73, 79, 80, 3000,
];

describe('formatters', () => {
  it('formats steps with thousands separators', () => {
    expect(formatSteps(8241)).toBe('8,241');
    expect(formatSteps(0)).toBe('0');
  });

  it('formats durations as h/m, keeping sub-minute visible as 0m', () => {
    expect(formatDuration(452)).toBe('7h 32m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(0.4)).toBe('0m');
  });

  it('converts workout seconds through the same rule', () => {
    expect(formatWorkoutDuration(3900)).toBe('1h 5m');
  });

  it('follows the weight-unit preference for distance', () => {
    expect(formatDistance(1609.344, 'lb')).toBe('1.00 mi');
    expect(formatDistance(1000, 'kg')).toBe('1.00 km');
  });

  it('rounds energy to whole kcal', () => {
    expect(formatKcal(412.7)).toBe('413 kcal');
  });
});

describe('workoutVisual', () => {
  it('gives distinct icons to the common cardio/strength activities', () => {
    expect(workoutVisual('Running').icon).toBe('walk');
    expect(workoutVisual('Cycling').icon).toBe('bicycle');
    expect(workoutVisual('Strength Training').icon).toBe('barbell');
    // Walking must not collide with Running — both are foot-based.
    expect(workoutVisual('Walking').icon).not.toBe(workoutVisual('Running').icon);
  });

  it('falls back to the generic badge for an unmapped activity', () => {
    const fallback = workoutVisual('Curling');
    expect(fallback.icon).toBe('fitness');
    expect(fallback.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('returns a usable visual for every activity type the sync can produce', () => {
    for (const type of KNOWN_ACTIVITY_TYPES) {
      const visual = workoutVisual(workoutLabel(type));
      expect(typeof visual.icon).toBe('string');
      expect(visual.icon.length).toBeGreaterThan(0);
      expect(visual.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('maps named activities to something other than the fallback', () => {
    // 3000 is genuinely "Workout" and is allowed to use the generic badge;
    // everything else should have earned its own entry.
    const named = KNOWN_ACTIVITY_TYPES.filter((t) => t !== 3000).map(workoutLabel);
    const generic = named.filter((label) => workoutVisual(label).icon === 'fitness');
    // Elliptical legitimately uses the generic 'fitness' glyph.
    expect(generic).toEqual(['Elliptical']);
  });
});
