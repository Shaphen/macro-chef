import type { Food } from '../db/schema';
import { ozToG, round1 } from './units';

/**
 * All serving/scaling math lives here (PLAN §5). Log entries snapshot the
 * result — never recompute historical entries from current food rows.
 */

export interface MacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const ZERO_TOTALS: MacroTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };

export type Amount =
  | { unit: 'g'; value: number }
  | { unit: 'oz'; value: number }
  | { unit: 'serving'; value: number };

/** Grams represented by an amount, when resolvable (serving needs the food's servingQty in g/ml). */
export function amountToGrams(food: Food, amount: Amount): number | null {
  switch (amount.unit) {
    case 'g':
      return amount.value;
    case 'oz':
      return ozToG(amount.value);
    case 'serving':
      return food.servingQty && (food.servingUnit === 'g' || food.servingUnit === 'ml')
        ? amount.value * food.servingQty
        : null;
  }
}

/** Macro totals for an amount of a food. */
export function scaleFood(food: Food, amount: Amount): MacroTotals {
  let factor: number;
  if (food.perHundred) {
    const grams = amountToGrams(food, amount);
    // per-100 foods without gram-resolvable servings shouldn't offer 'serving'
    factor = (grams ?? 0) / 100;
  } else {
    // Nutrition stored per 1 serving; grams-based entry needs servingQty to convert.
    if (amount.unit === 'serving') {
      factor = amount.value;
    } else {
      const grams = amount.unit === 'oz' ? ozToG(amount.value) : amount.value;
      factor = food.servingQty ? grams / food.servingQty : 0;
    }
  }
  return {
    calories: round1(food.calories * factor),
    protein: round1(food.protein * factor),
    carbs: round1(food.carbs * factor),
    fat: round1(food.fat * factor),
  };
}

export function sumTotals(items: MacroTotals[]): MacroTotals {
  return items.reduce(
    (acc, t) => ({
      calories: round1(acc.calories + t.calories),
      protein: round1(acc.protein + t.protein),
      carbs: round1(acc.carbs + t.carbs),
      fat: round1(acc.fat + t.fat),
    }),
    { ...ZERO_TOTALS },
  );
}

export const kcalFromMacros = (t: { protein: number; carbs: number; fat: number }) =>
  4 * t.protein + 4 * t.carbs + 9 * t.fat;

/**
 * Non-blocking label sanity check: true when stated kcal disagree with
 * 4P+4C+9F by more than 25% (labels legitimately differ some due to
 * fiber/alcohol/rounding — hint, never hard-block).
 */
export function macrosMismatchCalories(t: MacroTotals): boolean {
  if (t.calories <= 0) return false;
  return Math.abs(kcalFromMacros(t) - t.calories) > 0.25 * t.calories;
}
