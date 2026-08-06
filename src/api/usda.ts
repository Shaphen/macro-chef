import type { NewFood } from '../db/schema';

/**
 * Client for the optional macrochef-api Vercel proxy (see macrochef-api/
 * README.md and PLAN §11 "USDA generic-food search").
 *
 * Availability model: the proxy URL lives in the settings row
 * (`usda_proxy_url`) and is empty by default. Empty URL = feature entirely
 * off (no UI shown). A configured URL that fails — network error, timeout,
 * non-200, cold deployment, deleted project — must degrade to exactly the
 * pre-proxy experience: local foods + Open Food Facts. That is why every
 * failure path here throws a single `UsdaUnavailableError` the add-food
 * screen catches to show a one-line "using local/OFF only" notice instead
 * of an error state.
 */

export class UsdaUnavailableError extends Error {
  constructor(detail: string) {
    super(`USDA proxy unavailable: ${detail}`);
    this.name = 'UsdaUnavailableError';
  }
}

/** Slim shape the proxy returns; nutrition is always per 100 g. */
export interface UsdaHit {
  fdcId: number;
  name: string;
  brand: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  sugar: number | null;
  satFat: number | null;
  sodiumMg: number | null;
}

/**
 * Normalize whatever the user pasted into Settings ("macrochef-api.vercel.app",
 * trailing slash, missing scheme) into a fetchable base URL, or null when the
 * field is effectively empty — the single check the UI uses to decide whether
 * the USDA option exists at all.
 */
export function normalizeProxyUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

/**
 * Search generic foods via the proxy. 6-second abort: the phone is on a
 * cellular network and the function may cold-start; anything slower than
 * that reads as broken to someone mid-food-logging, so we cut over to the
 * fallback message instead of spinning.
 */
export async function searchUsda(baseUrl: string, query: string): Promise<UsdaHit[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${baseUrl}/api/usda-search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new UsdaUnavailableError(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.foods)) throw new UsdaUnavailableError('malformed response');
    return json.foods as UsdaHit[];
  } catch (e) {
    if (e instanceof UsdaUnavailableError) throw e;
    // AbortError, DNS failure, JSON parse error — all the same to the user.
    throw new UsdaUnavailableError(e instanceof Error ? e.message : 'network error');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Map a proxy hit to a local food row. Saved with source='usda' +
 * sourceId=fdcId so re-picking the same result later can reuse the saved
 * row (mirrors how OFF foods key on barcode). Values are per 100 g, which
 * is the app's native storage convention — no unit juggling needed.
 */
export function usdaHitToFood(hit: UsdaHit): Omit<NewFood, 'createdAt'> {
  return {
    name: hit.name,
    brand: hit.brand,
    barcode: null,
    source: 'usda',
    sourceId: String(hit.fdcId),
    perHundred: 1,
    calories: Math.round(hit.calories * 10) / 10,
    protein: hit.protein ?? 0,
    carbs: hit.carbs ?? 0,
    fat: hit.fat ?? 0,
    fiber: hit.fiber,
    sugar: hit.sugar,
    satFat: hit.satFat,
    sodiumMg: hit.sodiumMg,
    servingQty: null,
    servingUnit: null,
    servingName: null,
  };
}
