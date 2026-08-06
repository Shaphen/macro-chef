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
