import type { NewFood } from '../db/schema';

/**
 * Open Food Facts client. Called directly from the device — OFF rate limits apply
 * per user for mobile apps, far above human scanning rates. A descriptive
 * User-Agent is REQUIRED by OFF policy (requests without one get throttled).
 * See planning/PLAN.md §7.
 */

const BASE = 'https://world.openfoodfacts.org';
const USER_AGENT = 'MacroChef/0.1 (iOS; personal project)';
const PRODUCT_FIELDS =
  'code,product_name,brands,nutriments,serving_size,serving_quantity,nutrition_data_per';

export type MacroKey = 'calories' | 'protein' | 'carbs' | 'fat';

export interface OffLookupResult {
  found: boolean;
  /** Barcode form OFF confirmed (store this on the food). */
  code?: string;
  food?: Omit<NewFood, 'createdAt'>;
  /** True when kcal was present; false means we defaulted macros and UI should flag it. */
  complete?: boolean;
  /**
   * Macro fields OFF had no value for. `food` carries 0 for them because the
   * DB columns are NOT NULL, but 0 is a guess, not data — callers must not
   * save a product with a non-empty `missing` list silently. The scan flow
   * routes those into the editor with those fields left blank (PLAN §7
   * "Missing macros default 0 but flag the food incomplete in UI").
   */
  missing?: MacroKey[];
}

/**
 * iOS reports UPC-A as 13-digit EAN with a leading 0. Try the scanned code
 * as-is first, then the alternate form (strip/pad leading zero).
 */
export function barcodeCandidates(raw: string): string[] {
  const code = raw.trim();
  const candidates = [code];
  if (code.length === 13 && code.startsWith('0')) candidates.push(code.slice(1));
  else if (code.length === 12) candidates.push(`0${code}`);
  return candidates;
}

export async function lookupBarcode(raw: string): Promise<OffLookupResult> {
  for (const code of barcodeCandidates(raw)) {
    const res = await fetch(`${BASE}/api/v2/product/${code}?fields=${PRODUCT_FIELDS}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Open Food Facts error ${res.status}`);
    const json = await res.json();
    if (json.status !== 1 || !json.product) continue;
    return mapProduct(json.product, code);
  }
  return { found: false };
}

export interface OffSearchHit {
  code: string;
  name: string;
  brand?: string;
}

/** Text search, used only after local DB results ("Search online"). */
export async function searchProducts(query: string, signal?: AbortSignal): Promise<OffSearchHit[]> {
  const params = new URLSearchParams({
    search_terms: query,
    fields: 'code,product_name,brands',
    page_size: '20',
    json: '1',
  });
  const res = await fetch(`${BASE}/cgi/search.pl?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal,
  });
  if (!res.ok) throw new Error(`Open Food Facts search error ${res.status}`);
  const json = await res.json();
  return (json.products ?? [])
    .filter((p: any) => p.product_name)
    .map((p: any) => ({ code: p.code, name: p.product_name, brand: p.brands || undefined }));
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return typeof n === 'number' && isFinite(n) ? n : undefined;
}

function mapProduct(p: any, code: string): OffLookupResult {
  const n = p.nutriments ?? {};
  const perServing = p.nutrition_data_per === 'serving';
  const suffix = perServing ? '_serving' : '_100g';

  // Prefer kcal directly; fall back to kJ.
  let kcal = num(n[`energy-kcal${suffix}`]);
  if (kcal === undefined) {
    const kj = num(n[`energy${suffix}`]);
    if (kj !== undefined) kcal = kj / 4.184;
  }

  const protein = num(n[`proteins${suffix}`]);
  const carbs = num(n[`carbohydrates${suffix}`]);
  const fat = num(n[`fat${suffix}`]);
  const missing: MacroKey[] = [];
  if (kcal === undefined) missing.push('calories');
  if (protein === undefined) missing.push('protein');
  if (carbs === undefined) missing.push('carbs');
  if (fat === undefined) missing.push('fat');

  const servingQty = num(p.serving_quantity);
  const food: Omit<NewFood, 'createdAt'> = {
    name: p.product_name || 'Unnamed product',
    brand: p.brands ? String(p.brands).split(',')[0].trim() : undefined,
    barcode: code,
    source: 'off',
    sourceId: p.code ?? code,
    perHundred: perServing ? 0 : 1,
    calories: Math.round((kcal ?? 0) * 10) / 10,
    protein: protein ?? 0,
    carbs: carbs ?? 0,
    fat: fat ?? 0,
    fiber: num(n[`fiber${suffix}`]),
    sugar: num(n[`sugars${suffix}`]),
    satFat: num(n[`saturated-fat${suffix}`]),
    sodiumMg: (() => {
      const g = num(n[`sodium${suffix}`]);
      return g !== undefined ? g * 1000 : undefined;
    })(),
    servingQty: servingQty,
    servingUnit: servingQty ? 'g' : undefined,
    servingName: p.serving_size || undefined,
  };

  return { found: true, code, food, complete: kcal !== undefined, missing };
}
