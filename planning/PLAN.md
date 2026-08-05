# MacroChef — Implementation Plan (v1)

> **Living doc.** One plan doc for the whole v1; enhancements append versioned "Part" sections
> rather than new files. Last updated 2026-08-04.

A MacroFactor-style calorie/macro + weight-trend tracker for iOS (Android later).
Personal-use first, but built cleanly enough to ship to the App Store free/cheap.

---

## 1. Product scope

### In scope (v1)
- **Food logging** — timeline-style daily log, grouped by meal (Breakfast/Lunch/Dinner/Snack),
  swipe/arrow between days.
- **Barcode scanning** — scan a package → macros pulled from Open Food Facts → confirm serving →
  logged. Scanned foods are saved locally for instant re-use.
- **Manual/custom foods** — create foods with name/brand/serving/macros; saved to the local DB.
- **Food history & search** — search box hits the local DB first (recency + frequency ranked),
  then Open Food Facts remote search.
- **Quick add** — raw calories/macros entry with no food record.
- **Recipes** — combine ingredient foods with measurements → per-serving macros; log N servings.
  Editing a recipe never rewrites past log entries (snapshotting, see §5).
- **Weight tracking** — daily weigh-ins + **trend weight** (exponentially-smoothed, the
  Hacker's-Diet/MacroFactor approach) so daily water-weight noise doesn't obscure progress.
- **Dashboard** — today's calories + protein/fat/carb progress front-and-center; weight-trend
  chart and calorie-intake chart over selectable timeframes (1W/1M/3M/6M/1Y/All).
- **Manual goals** — user sets target weight, daily calories, and macro targets (grams or % split).
  Targets display throughout the app (dashboard, log header, add-food screens). No adaptive coaching.
- **Units** — lb/kg toggle; food amounts in g/oz/servings.
- **Data export/import** — JSON dump/restore (the "backup" story until cloud sync exists).

### Out of scope (v1)
- AI anything (photo estimation, coaching, smart suggestions).
- Adaptive TDEE/expenditure algorithm and auto-adjusting targets (MacroFactor's headline feature —
  deliberately replaced by manual targets. The schema keeps enough data — daily intake + trend
  weight — to compute expenditure later; see §11 Future).
- Accounts, sync, any server-side state. v1 is **fully local-first**.
- Micronutrient tracking beyond an optional handful (fiber, sugar, sat-fat, sodium stored when the
  source provides them; displayed on food detail only).
- Apple Health integration (future part).
- Android (architecture is cross-platform RN; just not tested/shipped in v1).

### What the research says we should copy (and skip)
From MacroFactor reviews/docs, the loved bits: logging speed (30–90 s/meal), barcode + custom foods
+ recipe builder, trend-weight insight, deep-but-clean analytics, targets visible everywhere.
Criticisms to avoid: dense onboarding (ours: 3 screens — units, goals, done), interface overload
(v1 dashboard = 3 cards), subscription paywall (ours: free).

---

## 2. Stack & architecture decision

| Layer | Choice | Why |
|---|---|---|
| App | **Expo / React Native + TypeScript**, Expo Router | Matches your existing Expo experience (chefkatscookies-app); Expo Router is the current default for new apps |
| Storage | **expo-sqlite + Drizzle ORM** | Local-first; Drizzle gives typed schema + migrations, pure JS |
| Barcode | **expo-camera** (`CameraView` barcode scanning) | Built into Expo, works in Expo Go; scans EAN-13/EAN-8/UPC-E (UPC-A arrives as EAN-13 on iOS) |
| Food data | **Open Food Facts API** (device → API directly) | Free, no key, open license; rate limits are per-user for mobile apps (15 product req/min — far above human usage) |
| Charts | **react-native-gifted-charts** (+ react-native-svg) | Pure JS, Expo Go compatible, good line/bar charts |
| State | **zustand** (thin) + React Query-style hooks around SQLite reads | Small app; avoid Redux ceremony |
| Backend | **None in v1** | See below |
| Deployment | **EAS Build → TestFlight → App Store** | Same pipeline as chefkatscookies-app |

### Why no backend (and the Vercel answer)
- Your Vercel Hobby concern: the **12-serverless-function cap is per project**, and Hobby allows up
  to **200 projects** — chefkatscookies-api/slot-booking being at 12/12 does **not** block a new
  MacroChef project. So Vercel *is* available if needed.
- But v1 doesn't need it: all data is personal and on-device (SQLite), and Open Food Facts is
  called directly from the phone. No auth, no invocation quotas, no cold starts, App Store privacy
  label = "Data Not Collected". Backup = JSON export (later: iCloud/`expo-file-system` document
  storage or a sync backend, §11).
- Note: Chef Kat's does **not** use Firebase — it's Vercel serverless + Shopify-as-datastore. The
  transferable reference is the Expo app structure and dev loop, not the backend.
- **Phase 2 backend (optional, 1 function):** a `macrochef-api` Vercel project with a single
  `api/usda-search.js` proxy to USDA FoodData Central (free key, 1000 req/hr) for generic foods
  ("chicken breast, raw") where OFF's coverage is weak. Key stays server-side. Not required for v1.

### Dev loop (important)
Every v1 dependency is **Expo Go-compatible** (sqlite, camera, svg, gifted-charts are all in Expo
Go). So the loop is: `npx expo start` → scan QR with Expo Go on the iPhone → live reload. **No EAS
build needed until TestFlight.** This is deliberately cheaper than Chef Kat's dev-client loop; only
move to a dev build if we later add a native module Expo Go lacks.

---

## 3. Repo layout

```
MacroChef/
├── app/                        # Expo Router routes
│   ├── _layout.tsx             # root stack + providers (DB init, theme)
│   ├── (tabs)/
│   │   ├── _layout.tsx         # tab bar: Dashboard · Log · Foods · Settings
│   │   ├── index.tsx           # Dashboard
│   │   ├── log.tsx             # Daily food log (day pager)
│   │   ├── foods.tsx           # My Foods + Recipes library
│   │   └── settings.tsx        # Goals, units, export/import
│   ├── add-food.tsx            # Add flow (modal): Search | Scan | Quick Add | Recipes
│   ├── scan.tsx                # Camera barcode scanner (modal)
│   ├── food/[id].tsx           # Food detail / editor (create + edit)
│   ├── recipe/[id].tsx         # Recipe builder / editor
│   ├── log-entry/[id].tsx      # Edit a logged entry (serving/amount)
│   └── weight.tsx              # Weight entry + history (modal)
├── src/
│   ├── db/
│   │   ├── schema.ts           # Drizzle schema (single source of truth)
│   │   ├── client.ts           # openDatabaseSync + drizzle wiring + migration runner
│   │   └── queries/            # foods.ts, log.ts, recipes.ts, weight.ts, settings.ts
│   ├── api/
│   │   └── openfoodfacts.ts    # product-by-barcode + text search, mapping to Food
│   ├── lib/
│   │   ├── nutrition.ts        # serving math, macro scaling, kcal-from-macros checks
│   │   ├── trend.ts            # EWMA trend weight, gap handling, timeframe series
│   │   ├── units.ts            # kg↔lb, g↔oz, serving conversions
│   │   └── dates.ts            # local 'YYYY-MM-DD' day keys (day boundary = local midnight)
│   ├── state/                  # zustand stores (settings cache, selected day)
│   └── components/             # MacroBars, CalorieRing, TrendChart, FoodRow, ServingEditor…
├── planning/PLAN.md            # this doc
└── CLAUDE.md                   # repo guidance for future Claude sessions
```

---

## 4. Data model (SQLite via Drizzle)

Canonical units internally: **grams** for food amounts (with a serving overlay), **kg** for
weight, **local-date strings** (`YYYY-MM-DD`) for day bucketing. Display converts per settings.

```
foods
  id            integer pk autoincrement
  name          text not null
  brand         text
  barcode       text            -- normalized EAN-13 (see §7), indexed, nullable
  source        text not null   -- 'custom' | 'off' | 'usda'
  source_id     text            -- OFF code / FDC id
  -- Nutrition stored per 100 g (or per 100 ml for liquids) when gram weight is known,
  -- else per 1 serving (per_100 = 0). All macro fields are for that base.
  per_100       integer not null default 1
  calories      real not null
  protein       real not null default 0
  carbs         real not null default 0
  fat           real not null default 0
  fiber         real; sugar real; sat_fat real; sodium_mg real   -- optional extras
  serving_qty   real            -- e.g. 30
  serving_unit  text            -- 'g' | 'ml' | 'unit'
  serving_name  text            -- "1 scoop", "2 cookies"
  use_count     integer default 0, last_used_at integer   -- powers history ranking
  is_deleted    integer default 0   -- soft delete: log snapshots keep working
  created_at    integer

log_entries
  id            integer pk
  day           text not null            -- 'YYYY-MM-DD', indexed
  meal          text not null            -- 'breakfast'|'lunch'|'dinner'|'snack'
  logged_at     integer not null
  kind          text not null            -- 'food' | 'recipe' | 'quick'
  food_id       integer fk nullable
  recipe_id     integer fk nullable
  name          text not null            -- denormalized display name
  amount        real                     -- what the user chose (e.g. 1.5)
  amount_unit   text                     -- 'g'|'oz'|'serving'
  grams         real                     -- resolved grams when known
  calories/protein/carbs/fat  real not null   -- SNAPSHOT totals for this entry (§5)

recipes
  id, name, servings real not null default 1, notes, created_at, is_deleted

recipe_items
  id, recipe_id fk, food_id fk, amount, amount_unit, grams,
  calories/protein/carbs/fat real    -- snapshot per item (recipe totals = sum)

weight_entries
  id, day text unique not null, weight_kg real not null, logged_at

settings  (single row, id=1)
  unit_weight        text 'lb'|'kg'      (default lb)
  unit_food          text 'g'|'oz'       (default g)
  target_weight_kg   real
  calorie_target     integer
  protein_target_g / carb_target_g / fat_target_g   integer
  goal_note          text                -- optional free text ("cut to 175 by Nov")
  onboarded          integer
```

Migrations: Drizzle-generated SQL bundled in the app; a tiny runner applies pending migrations at
startup (`PRAGMA user_version`-style tracking). Never edit an applied migration — append.

---

## 5. Nutrition math rules

- **Scaling:** entry macros = base macros × (grams / 100) when `per_100`, else × servings chosen.
  `lib/nutrition.ts` is the only place that does this math.
- **Snapshotting:** `log_entries` and `recipe_items` store computed macro totals at log time.
  Editing/deleting a food later never changes past days (matches MacroFactor behavior; keeps
  historical charts truthful). Re-logging uses the food's *current* values.
- **Serving editor:** amount steppers + unit picker (g / oz / servings); shows live-computed macros
  before confirming. Default = the food's serving if defined, else 100 g.
- **Sanity check:** on custom-food save, if |4·P + 4·C + 9·F − kcal| > 25% of kcal, show a
  non-blocking "macros don't match calories" hint (catches label typos, never hard-blocks —
  labels legitimately disagree due to fiber/alcohol/rounding).
- **Day totals:** SQL `SUM` over `log_entries WHERE day = ?` — computed on read, never stored.

## 6. Trend weight & charts

- **Trend weight:** exponentially-weighted moving average, α = 0.1 per day (Hacker's Diet
  standard, what TrendWeight/MacroFactor-style smoothing is built on):
  `trend[n] = trend[n-1] + α·(weight[n] − trend[n-1])`. Missing days: carry trend forward and
  apply the next real weigh-in once (no interpolation fabricating data). Seed = first weigh-in.
- **Dashboard cards (v1):**
  1. **Today** — calories eaten / target with remaining, plus P/F/C horizontal progress bars.
     This exact component (`MacroBars`) also renders in the log header and the add-food flow.
  2. **Weight** — current trend weight, delta vs. target, Δ over the selected timeframe; line
     chart with raw weigh-ins as faint dots + trend line bold; goal weight as dashed rule.
  3. **Calories** — daily intake bars vs. target line + 7-day rolling average line.
- Timeframe selector shared by cards: **1W · 1M · 3M · 6M · 1Y · All**.
- Charting: `react-native-gifted-charts` LineChart/BarChart; downsample >180 points for perf.

## 7. Barcode + Open Food Facts

- **Scanner:** `CameraView` with `barcodeTypes: ['ean13','ean8','upc_a','upc_e']`, torch toggle,
  haptic + freeze on detection, debounce duplicate reads. Permission denied → inline explainer +
  "enter barcode manually" input.
- **Normalization (durable gotcha):** iOS reports UPC-A as 13-digit EAN with leading `0`. Lookup
  strategy: try the scanned code as-is; on 404 retry with the leading zero stripped (12-digit) and
  vice-versa padded. Store whichever form OFF confirmed.
- **Lookup:** `GET https://world.openfoodfacts.org/api/v2/product/{code}?fields=code,product_name,brands,nutriments,serving_size,serving_quantity,nutrition_data_per`
  with a proper **`User-Agent: MacroChef/0.1 (iOS; personal project)`** header (OFF requires it).
- **Mapping:** `nutriments` → per-100g when `nutrition_data_per == '100g'`, else per-serving with
  `serving_quantity` grams. `energy-kcal_100g` preferred; fall back to `energy_100g` kJ ÷ 4.184.
  Missing macros default 0 but flag the food "incomplete" in UI.
- **Flow:** scan → local DB hit by barcode? → straight to serving editor (fast path). Else OFF →
  prefill food editor → user confirms/fixes → saved as local food (`source='off'`) → serving
  editor → logged. OFF miss → blank food editor with barcode attached.
- **Remote text search:** OFF search API, only after local results, behind a "Search online"
  section; 300 ms debounce; map + save-on-log same as barcode.

## 8. Screens (v1 spec)

- **Onboarding (first launch):** units → targets (weight, calories, macros with a %-split helper
  that converts to grams) → done. Skippable; editable later in Settings.
- **Dashboard:** cards per §6 + prominent `+` (add food) and weigh-in shortcut.
- **Log:** header = date nav (‹ today ›, swipe pager) + compact MacroBars; body = 4 meal sections
  with per-meal kcal subtotals; row tap → edit entry; swipe row → delete (undo snackbar);
  per-meal `+` preselects that meal; long-press → duplicate to today/another meal ("copy
  yesterday's breakfast" lives here).
- **Add flow (modal, meal-aware):** segmented Search | Scan | Quick | Recipes. Search shows
  History (recency+frequency) → All local matches → "Search Open Food Facts".
- **Foods tab:** My Foods + Recipes lists, search/filter, create buttons.
- **Recipe builder:** name, servings count, ingredient list (each via the same add-food search),
  live per-recipe and per-serving macro totals; "Log this recipe" with servings stepper.
- **Weight modal:** big numeric entry for today (pre-filled with last), edit-any-day history list.
- **Settings:** goals editor, units, export (share JSON file) / import (document picker, replace-DB
  with confirm), about/licenses (OFF attribution — ODbL requires it).

## 9. Implementation phases

- **Phase 0 — Scaffold (skeleton).** create-expo-app (TS, Expo Router), deps, repo layout, Drizzle
  schema + migration runner, seed settings row, tab shell with placeholder screens, CLAUDE.md.
- **Phase 1 — Log core.** Food CRUD + serving math, add-flow search (local), quick add, log
  screen with day paging + totals, MacroBars.
- **Phase 2 — Barcode.** Scan screen, OFF client + normalization + mapping, save-scanned-food
  fast path. *(Skeleton includes the scan screen + OFF client if budget allows.)*
- **Phase 3 — Weight + dashboard.** Weight entry/history, trend algorithm, the 3 dashboard cards,
  timeframe selector.
- **Phase 4 — Recipes.** Builder, snapshot logging, library.
- **Phase 5 — Polish + ship.** Onboarding, export/import, empty states, haptics, app icon/splash,
  EAS build → TestFlight → App Store review (free listing; privacy label "Data Not Collected";
  note App Review wants camera-permission purpose string: "Scan food barcodes to log nutrition").
- **Phase 6+ (future, see §11).**

Suggested order is dependency order; each phase leaves the app runnable in Expo Go.

## 10. Testing
- Pure logic (`lib/nutrition`, `lib/trend`, `lib/units`, OFF mapping) → **jest-expo** unit tests
  with fixture OFF payloads. This is where correctness lives; screens stay thin.
- DB queries → tested against an in-memory SQLite via drizzle.
- Manual device pass per phase in Expo Go (camera needs a real device; simulator has no camera).

## 11. Future parts (not v1)
- **Expenditure/TDEE estimate** — we already store daily intake + trend weight; energy balance
  regression over trailing 3–4 weeks gives a MacroFactor-style expenditure number without AI.
- **USDA generic-food search** via 1-function Vercel proxy (`macrochef-api`).
- **Apple Health** (weight read/write) — needs a dev build (native module) — natural moment to
  switch off Expo Go.
- **Cloud backup/sync** (Vercel + Postgres or iCloud), **Android release**, **widgets/watch**,
  micronutrient targets, training/rest-day macro cycling.

## 12. Handoff notes (if a different session implements)
- Read this doc top-to-bottom; §4–§7 are the contract. Keep every dependency Expo Go-compatible
  in v1 (no native modules beyond Expo SDK built-ins).
- Snapshot rule (§5) and barcode normalization (§7) are the two easiest things to get subtly
  wrong — both have unit-test fixtures specified in §10.
- OFF requires the custom User-Agent; without it you get throttled/blocked.
- Windows machine: use `npx expo start` from Git Bash or PowerShell; if Metro cache weirdness
  after dependency changes, `npx expo start --clear`.
