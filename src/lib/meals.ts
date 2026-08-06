import type { Meal } from '../db/schema';

/**
 * The four meal buckets (PLAN §4 `log_entries.meal`) and their display names,
 * in the order they're shown everywhere (log sections, meal pickers).
 */
export const MEALS: { key: Meal; label: string; plural?: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snack', plural: 'Snacks' },
];

export function mealLabel(meal: Meal): string {
  return MEALS.find((m) => m.key === meal)?.label ?? meal;
}

/**
 * Which meal an add-food flow should start on when the caller didn't say
 * (the Dashboard's "+ Add food", the scan modal). Defaulting to 'snack'
 * silently filed most logging under Snacks; the clock is a far better guess
 * and the meal is user-changeable on every screen that logs.
 *
 * Boundaries are deliberately generous at the ends of the day: an 11 am meal
 * is more likely lunch than breakfast, and anything after 21:00 is a snack.
 */
export function defaultMealForNow(now: Date = new Date()): Meal {
  const hour = now.getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}
