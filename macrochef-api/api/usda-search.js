/**
 * macrochef-api — the single serverless function PLAN §2/§11 describes:
 * a thin proxy in front of USDA FoodData Central text search, so the app can
 * find generic foods ("chicken breast, raw") where Open Food Facts coverage
 * is weak.
 *
 * Why a proxy at all (instead of calling USDA from the phone):
 *  - FDC requires an API key. Shipping the key inside the app bundle means
 *    anyone can extract and burn your 1000 req/hr quota; keeping it in a
 *    Vercel env var (FDC_API_KEY) is the whole point of this function.
 *  - The proxy also flattens FDC's verbose nutrient array into the exact
 *    slim shape the app's Food type wants, so nutrient-number knowledge
 *    (208 = kcal, 203 = protein, …) lives server-side and can be fixed
 *    without an app release.
 *
 * Contract with the app (src/api/usda.ts):
 *   GET /api/usda-search?q=<text>
 *   -> 200 { foods: [{ fdcId, name, brand, calories, protein, carbs, fat,
 *                      fiber, sugar, satFat, sodiumMg }] }   // all per 100 g
 *   -> 4xx/5xx { error: string }
 * The app treats ANY non-200 (or a network failure / timeout) as "proxy not
 * available" and silently falls back to local + Open Food Facts search.
 */

// FDC nutrient numbers -> our field names. Values in search results are
// normalized per 100 g (Branded label data included), which matches the
// app's `per_100 = 1` storage convention directly.
const NUTRIENTS = {
  208: 'calories', // Energy (kcal)
  203: 'protein',
  205: 'carbs',
  204: 'fat',
  291: 'fiber',
  269: 'sugar',
  606: 'satFat',
  307: 'sodiumMg', // already reported in mg
};

// Generic-food-first: Foundation and SR Legacy are lab/reference data (the
// "chicken breast, raw" use case); Branded fills in packaged items OFF may
// miss. Survey (FNDDS) is excluded — its recipe-style entries duplicate and
// clutter results.
const DATA_TYPES = 'Foundation,SR Legacy,Branded';

export default async function handler(req, res) {
  const q = (req.query.q || '').toString().trim();
  if (!q) {
    return res.status(400).json({ error: 'Missing ?q= search text' });
  }

  const apiKey = process.env.FDC_API_KEY;
  if (!apiKey) {
    // Deploy-time misconfiguration, not a client error — 503 tells the app
    // to fall back without retrying aggressively.
    return res.status(503).json({ error: 'FDC_API_KEY is not configured on this deployment' });
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    query: q,
    dataType: DATA_TYPES,
    pageSize: '20',
  });

  let upstream;
  try {
    upstream = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`);
  } catch {
    return res.status(502).json({ error: 'USDA FoodData Central is unreachable' });
  }
  if (!upstream.ok) {
    // 403 = bad/over-quota key; pass through a stable message the app can log.
    return res.status(502).json({ error: `USDA responded ${upstream.status}` });
  }

  const json = await upstream.json();
  const foods = (json.foods || [])
    .map((f) => {
      const out = {
        fdcId: f.fdcId,
        name: f.description || 'Unnamed food',
        brand: f.brandName || f.brandOwner || null,
        calories: null,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: null,
        sugar: null,
        satFat: null,
        sodiumMg: null,
      };
      for (const n of f.foodNutrients || []) {
        const key = NUTRIENTS[Number(n.nutrientNumber)];
        if (key && typeof n.value === 'number') out[key] = n.value;
      }
      // kJ fallback (nutrient 268) for the rare records without a kcal row.
      if (out.calories == null) {
        const kj = (f.foodNutrients || []).find((n) => Number(n.nutrientNumber) === 268);
        if (kj && typeof kj.value === 'number') out.calories = kj.value / 4.184;
      }
      return out;
    })
    // A food without energy data can't be logged meaningfully — drop it here
    // rather than making the app deal with null-calorie rows.
    .filter((f) => f.calories != null);

  // Generic-food search results change rarely; let Vercel's CDN absorb
  // repeat queries for a day so the free-tier invocation budget lasts.
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).json({ foods });
}
