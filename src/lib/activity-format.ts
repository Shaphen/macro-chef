// Type-only import: erased at compile time, so this file stays free of any
// runtime dependency on the icon package (and of its jest transform cost).
import type { Ionicons } from '@expo/vector-icons';

/**
 * Display formatting for Apple Health activity values (PLAN Part 3). Kept
 * out of the screens so the Dashboard card and the Activity screen render
 * identical strings, and so the rounding rules are unit-testable.
 */

/** 8241 → "8,241". */
export function formatSteps(steps: number): string {
  return Math.round(steps).toLocaleString();
}

/** Minutes → "7h 32m" / "45m". Sub-minute durations read as "0m", not "". */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Seconds → "1h 05m" / "42m" (workout rows, where minutes are the unit). */
export function formatWorkoutDuration(seconds: number): string {
  return formatDuration(seconds / 60);
}

/**
 * Metres → miles or kilometres, following the weight-unit preference (the
 * app has no separate distance setting, and lb/mi vs kg/km travel together).
 */
export function formatDistance(meters: number, unitWeight: 'lb' | 'kg'): string {
  return unitWeight === 'lb'
    ? `${(meters / 1609.344).toFixed(2)} mi`
    : `${(meters / 1000).toFixed(2)} km`;
}

/** Energy is always shown as whole kcal — Health's precision is noise here. */
export function formatKcal(kcal: number): string {
  return `${Math.round(kcal).toLocaleString()} kcal`;
}

export interface WorkoutVisual {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

/**
 * Icon + accent colour for a workout tile, keyed by the humanized activity
 * names `workoutLabel()` produces (src/lib/health.ts WORKOUT_LABELS). The
 * colours group by effort family — cardio blue, strength orange, low-impact
 * purple, mixed/other grey-blue — so a screen of tiles is scannable without
 * reading every label. Unknown activities fall back to the generic badge
 * rather than rendering a broken glyph.
 */
const WORKOUT_VISUALS: Record<string, WorkoutVisual> = {
  Running: { icon: 'walk', color: '#3c87f7' },
  Walking: { icon: 'footsteps', color: '#3c87f7' },
  Hiking: { icon: 'trail-sign', color: '#3c87f7' },
  Cycling: { icon: 'bicycle', color: '#3c87f7' },
  Swimming: { icon: 'water', color: '#3c87f7' },
  Rowing: { icon: 'boat', color: '#3c87f7' },
  Elliptical: { icon: 'fitness', color: '#3c87f7' },
  'Stair Climbing': { icon: 'trending-up', color: '#3c87f7' },
  'Strength Training': { icon: 'barbell', color: '#f2a33c' },
  'Functional Strength': { icon: 'barbell', color: '#f2a33c' },
  HIIT: { icon: 'flame', color: '#f2a33c' },
  Kickboxing: { icon: 'hand-left', color: '#f2a33c' },
  'Jump Rope': { icon: 'infinite', color: '#f2a33c' },
  'Step Training': { icon: 'footsteps', color: '#f2a33c' },
  Yoga: { icon: 'body', color: '#8b5cf6' },
  Pilates: { icon: 'body', color: '#8b5cf6' },
  'Core Training': { icon: 'body', color: '#8b5cf6' },
  Flexibility: { icon: 'accessibility', color: '#8b5cf6' },
  Cooldown: { icon: 'snow', color: '#8b5cf6' },
  'Mixed Cardio': { icon: 'pulse', color: '#5a8fa8' },
  Pickleball: { icon: 'tennisball', color: '#5a8fa8' },
};

const DEFAULT_WORKOUT_VISUAL: WorkoutVisual = { icon: 'fitness', color: '#5a8fa8' };

export function workoutVisual(activity: string): WorkoutVisual {
  return WORKOUT_VISUALS[activity] ?? DEFAULT_WORKOUT_VISUAL;
}
