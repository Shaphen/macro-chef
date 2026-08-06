import type { NewFood } from '../db/schema';

/**
 * A partially-known food handed to the food editor through router params.
 *
 * Why this exists: a scanned barcode that Open Food Facts doesn't fully know
 * must NOT be saved as a food row with zeros standing in for missing label
 * values — zeros are indistinguishable from real data once logged. So the
 * scan flow passes what it does know here and the editor renders every
 * unknown field BLANK, forcing the user to fill in the label (name and
 * calories are required to save; see food/[id]).
 *
 * Every field is optional, and `undefined` means "unknown", never "zero".
 */
export type FoodPrefill = Partial<Omit<NewFood, 'createdAt'>>;

export function encodeFoodPrefill(prefill: FoodPrefill): string {
  return JSON.stringify(prefill);
}

/** Tolerant decode — a malformed param must never crash the editor. */
export function decodeFoodPrefill(raw: string | undefined): FoodPrefill {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as FoodPrefill) : {};
  } catch {
    return {};
  }
}
