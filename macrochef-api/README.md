# macrochef-api

The optional one-function backend from `planning/PLAN.md` §2/§11: a Vercel
serverless proxy in front of **USDA FoodData Central** text search, used by the
MacroChef app for generic foods ("chicken breast, raw") where Open Food Facts
coverage is weak. The proxy exists so the free FDC API key stays server-side
instead of being extractable from the app bundle.

The app works fully without it — if this project is never deployed (or the
deployed URL stops responding), the add-food search silently falls back to
local foods + Open Food Facts only.

## Deploying (one-time, ~5 minutes)

1. **Get a free FDC API key**: <https://fdc.nal.usda.gov/api-key-signup.html>
   (instant email signup; 1 000 requests/hour, far above personal use).
2. **Create the Vercel project** — from this `macrochef-api/` directory:

   ```bash
   npm i -g vercel        # if you don't have the CLI
   vercel login
   vercel                 # accept defaults; creates the "macrochef-api" project
   ```

   This is a **new project** on your account — the Hobby plan's
   12-serverless-function cap is per project, so chefkatscookies-api /
   slot-booking being full does not matter (PLAN §2).
3. **Add the API key env var** (Production):

   ```bash
   vercel env add FDC_API_KEY production
   # paste the key when prompted
   ```

   (Or in the dashboard: Project → Settings → Environment Variables.)
4. **Deploy to production**:

   ```bash
   vercel --prod
   ```

   Note the production URL, e.g. `https://macrochef-api.vercel.app`.
5. **Point the app at it**: MacroChef → Settings → "USDA search (optional)" →
   paste the production URL → Save. The add-food search now shows a
   "Search USDA" option alongside Open Food Facts.

## Verifying

```bash
curl "https://<your-deployment>/api/usda-search?q=chicken%20breast"
```

should return `{ "foods": [ { "fdcId": …, "name": …, "calories": … } ] }`
with per-100 g values.

## Endpoint

`GET /api/usda-search?q=<text>` →
`{ foods: [{ fdcId, name, brand, calories, protein, carbs, fat, fiber, sugar, satFat, sodiumMg }] }`
— all nutrition per 100 g. Errors return non-200 with `{ error }`; the app
treats any non-200 or network failure as "proxy unavailable" and falls back.
