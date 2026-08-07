# MacroChef — Implementation Plan (v1)

> **Living doc.** One plan doc for the whole v1; enhancements append versioned "Part" sections
> rather than new files. Last updated 2026-08-05.

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

**SDK pin (durable, 2026-08-05):** the project is pinned to **Expo SDK 54** because the App Store
version of Expo Go is stuck supporting SDK 54 — Apple has not approved Expo's newer submissions
for months (see expo.dev/changelog/expo-go-and-app-store-may-2026). `create-expo-app` scaffolds
SDK 57+ by default, which Expo Go on a real iPhone rejects as incompatible. Don't bump the `expo`
major until either Apple approves a newer Expo Go, or we switch to `eas go` / a dev build (natural
moment: the TestFlight phase, which needs EAS anyway). Downgrade required: ThemeProvider/DarkTheme
import from `@react-navigation/native` (not re-exported by expo-router v6), no `experiments.reactCompiler`,
no `predictiveBackGestureEnabled`, eslint-config-expo ~10.

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

- **Phase 0 — Scaffold (skeleton).** ✅ create-expo-app (TS, Expo Router), deps, repo layout, Drizzle
  schema + migration runner, seed settings row, tab shell with placeholder screens, CLAUDE.md.
- **Phase 1 — Log core.** ✅ Food CRUD + serving math, add-flow search (local), quick add, log
  screen with day paging + totals, MacroBars. Entry editing (`log-entry/[id]`, proportional
  snapshot rescale), swipe-to-delete with undo snackbar, and long-press duplicate to any
  day/meal (meal sheet → month-calendar day picker) shipped 2026-08-05.
- **Phase 2 — Barcode.** ✅ Scan screen, OFF client + normalization + mapping, save-scanned-food
  fast path.
- **Phase 3 — Weight + dashboard.** ✅ Weight entry/history, trend algorithm, the 3 dashboard cards
  (gifted-charts: trend line + raw dots + goal rule; calorie bars + target rule + 7-day rolling
  average), shared 1W–All timeframe selector, >180-point downsampling. Shipped 2026-08-05.
- **Phase 4 — Recipes.** ✅ Builder (`recipe/[id]`, doubles as serving-picker with `?log=1`),
  snapshot logging, library section on the Foods tab + Recipes in the add flow. Shipped 2026-08-05.
- **Phase 5 — Polish + ship.** Onboarding ✅ (2-step, skippable) and export/import ✅ (JSON share
  sheet / document picker, replace-all restore) shipped 2026-08-05, plus OFF attribution in
  Settings. Remaining: app icon/splash, haptics pass, EAS build → TestFlight → App Store review
  (free listing; privacy label "Data Not Collected"; note App Review wants camera-permission
  purpose string: "Scan food barcodes to log nutrition").
- **Phase 6+ (future, see §11).** The USDA proxy from §11 shipped early (2026-08-05): the
  `macrochef-api/` folder holds the deployable Vercel project; Settings takes the deployed URL
  (`settings.usda_proxy_url`), and the add flow falls back to local + OFF when it's absent/down.

Suggested order is dependency order; each phase leaves the app runnable in Expo Go.

## 10. Testing
- Pure logic (`lib/nutrition`, `lib/trend`, `lib/units`, OFF mapping) → **jest-expo** unit tests
  with fixture OFF payloads. This is where correctness lives; screens stay thin.
  ✅ Shipped 2026-08-05: `npm test` (jest-expo preset) covers trend/EWMA + downsampling,
  serving math + the §5 mismatch hint, day/week/month-grid helpers, unit conversions, and
  §7 barcode normalization + OFF mapping via mocked-fetch fixtures (`src/**/__tests__/`).
- DB queries → tested against an in-memory SQLite via drizzle.
- Manual device pass per phase in Expo Go (camera needs a real device; simulator has no camera).

## 11. Future parts (not v1)
- **Expenditure/TDEE estimate** — we already store daily intake + trend weight; energy balance
  regression over trailing 3–4 weeks gives a MacroFactor-style expenditure number without AI.
- **USDA generic-food search** via 1-function Vercel proxy (`macrochef-api`). ✅ Shipped
  2026-08-05: deployable project lives in `macrochef-api/` (see its README for the one-time
  Vercel setup — free FDC key + `FDC_API_KEY` env var); app client in `src/api/usda.ts`; URL
  configured in Settings; any proxy failure silently falls back to local + OFF.
- **Health integrations** — see Part 2 item 2.
- **Cloud backup/sync** (Vercel + Postgres or iCloud), **Android release**, **widgets/watch**,
  micronutrient targets, training/rest-day macro cycling.

## Part 2 — Post-skeleton action items (added 2026-08-05)

Requested by Shaphen after confirming the skeleton works on-device.
**Status (2026-08-05):** 2.1 shipped in full; 2.2 shipped everything short of the native module
(schema migration, dedupe rules, sync helper, Settings section) — the HealthKit binding itself
waits for the EAS dev build per the constraint below. Details inline.

### 2.1 Log day navigation: week strip + calendar picker ✅
MacroFactor-style navigation for the Log tab (today it's only ‹ / › arrows):
- **Week strip** at the top of the Log screen: a horizontal row of 7 day chips (weekday letter +
  day number), swipeable between weeks, selected day highlighted; tapping a chip switches the log
  to that day. Nice-to-have: a small dot/fill on chips indicating logged days (any entries) or
  calorie adherence vs target.
- **Calendar icon** in the Log header opening a full month calendar to jump to any date (past
  weeks aren't reachable quickly with a strip alone).
- Implementation notes: selected-day state already exists in `(tabs)/log.tsx` (`day` string) —
  both controls just set it. Keep Expo Go compat: build the week strip as a custom component
  (FlatList paging by week), and for the month view use a pure-JS calendar
  (`react-native-calendars` is JS-only) or a custom grid; **no native date-picker modules**.
  "Logged day" dots need a cheap query: `SELECT DISTINCT day FROM log_entries WHERE day BETWEEN ?`.

Implemented as `components/week-strip.tsx` (paging FlatList, ±2y window) +
`components/month-calendar.tsx` (hand-rolled pure-JS month grid, no new dependency), both
controlled by the existing `day` state in `(tabs)/log.tsx`; dots via `loggedDaysBetween()`.

### 2.2 Health integrations (Apple Health first; Health Connect for Android later) — groundwork ✅
Pull weight data instead of/alongside manual weigh-ins, connected from Settings:
- **Settings toggle** "Connect Apple Health": on connect, request HealthKit read (body mass;
  optionally write our weigh-ins back — decide at implementation), backfill historical weights,
  then sync new samples on app foreground. Imported entries land in `weight_entries` deduped by
  day (one weigh-in/day rule; latest sample of the day wins). Add a `source` column
  (`'manual' | 'healthkit' | 'healthconnect'`) via a new migration so manual entries are never
  silently overwritten by sync.
- **Android**: same design against Health Connect when the Android release happens (§11).
- **Constraint (the reason this isn't in v1):** HealthKit requires a native module
  (e.g. `@kingstinct/react-native-healthkit` — there is no built-in Expo-SDK HealthKit module),
  which **breaks the Expo Go dev loop** (PLAN §2) and forces an EAS dev build. Natural moment:
  bundle it with the TestFlight/EAS phase (Phase 5) rather than doing a special build early.
  Trend-weight math needs no changes — it already consumes whatever is in `weight_entries`.
- **Superseded 2026-08-05 by Part 3 below** — Shaphen asked for the real integration (and for
  more than weight), so the native module landed now instead of at Phase 5.
- **Groundwork shipped (2026-08-05):** migration v2 added `weight_entries.source`
  (`'manual'|'healthkit'|'healthconnect'`, default manual); `db/queries/weight.ts#importWeight`
  enforces manual-never-overwritten + latest-sample-wins; `lib/health.ts` is the single adapter
  file whose stubs get swapped for real HealthKit calls at the dev-build moment (it also hosts
  the pure `applyWeightSamples()` dedupe logic, testable today); Settings shows the section with
  the availability explanation. Enabling for real = install the native module + rewrite only
  `lib/health.ts`.

## Part 3 — Apple Health sync, for real (added 2026-08-05)

Requested by Shaphen: "sync my apple health data into the app directly" — **read-only**, covering
body weight, active energy, steps, workouts and sleep, all displayed in-app ("the most data that
can be displayed… opens up opportunities to use the data for something in the future").

### The build-loop consequence (read this first)
HealthKit is a native module, so **Apple Health only works in a dev/TestFlight build — never in
Expo Go.** Part 2.2 deferred this to Phase 5 for exactly that reason; the decision is now
reversed deliberately. To keep the cost down the integration is *gated*, not unconditional:

- `lib/health.ts` `require`s the native module **lazily**, behind
  `Constants.executionEnvironment === StoreClient` (Expo Go) and a `try/catch`. Expo Go therefore
  still bundles and runs the whole app; Apple Health simply reports "needs the development
  build" and every other feature is untouched. Verified with `npx expo export --platform ios`.
- So the dev loop is now **two-track**: `npx expo start` + Expo Go for everything except health;
  `eas build --profile development --platform ios` (then `npx expo start --dev-client`) when
  health work needs testing. `eas.json` ships a `development` profile for this.

### What is read (and nothing is written)
MacroChef never writes to Apple Health — the plugin is configured with
`NSHealthUpdateUsageDescription: false`, so the app can't even ask for write access, and the only
entitlement requested is `com.apple.developer.healthkit` (no background delivery).

| HealthKit type | Lands in |
| --- | --- |
| `BodyMass` | `weight_entries` via `importWeight` (Part 2.2 dedupe rules unchanged) |
| `StepCount`, `ActiveEnergyBurned`, `BasalEnergyBurned`, `AppleExerciseTime` | `health_days` |
| `SleepAnalysis` (category) | `health_days.sleep_minutes` |
| Workouts | `health_workouts` (one row per sample) |

### Data model (migration v3)
- `health_days(day PK, steps, active_energy_kcal, basal_energy_kcal, exercise_minutes,
  sleep_minutes, synced_at)` — **every metric nullable**: "not measured" ≠ zero (no Watch that
  day means null exercise minutes, and a 0 bar would be a lie).
- `health_workouts(uuid PK, day, activity, start_ms, end_ms, duration_sec, energy_kcal,
  distance_m)` — keyed on HealthKit's own sample UUID so re-syncing an overlapping window is
  idempotent; `pruneHealthWorkouts` drops rows Health no longer reports in a re-synced window.
- `settings.health_sync_enabled` + `settings.health_last_sync_at`.
- **These tables are a cache, not history.** The §5 snapshot rule protects the food log because
  it can't be re-derived; health rows can always be re-synced, so they're overwritten wholesale
  (that's how data deleted in Health stops lingering here). Backups still include them so a
  restored device isn't blank before its first sync.

### Sync rules (the load-bearing ones)
- **Window:** first sync backfills 365 days of activity and **all** weight history (the EWMA
  trend shouldn't start at a one-year cliff); later syncs re-read from `last_sync − 3 days`,
  because samples arrive late (a watch syncing hours later, a scale back-filling) and sleep is
  stitched together after the fact.
- **Steps/energy/exercise use `queryStatisticsCollectionForQuantity`, not raw samples** — iPhone
  and Watch both count steps, and HealthKit's statistics query is what de-duplicates overlapping
  sources. Summing raw samples double-counts.
- **Sleep is merged, then bucketed on an 18:00 boundary.** Multiple sources report the same night
  with heavy overlap, so asleep intervals (values 1/3/4/5 — in-bed and awake excluded) are
  interval-merged before summing. The day an interval belongs to comes from `sleepDayKey`: a
  sleep day runs 18:00 → 18:00, like Health's own grouping.
  **Do not "simplify" this to the day the interval ends** — that was the first implementation and
  it under-reported every night (5h15m shown for a 6h46m night, fixed 2026-08-06). A watch splits
  a night into dozens of stage samples separated by brief awake gaps, and merging only joins
  *overlapping* intervals, so an end-day rule files every pre-midnight fragment under the previous
  day. Regression test: "keeps a fragmented night on ONE day".
- **The backfill may overwrite hand-typed weigh-ins; routine syncs may not.** Part 2.2's
  "manual always wins" rule protects a number you just typed, but applied to the initial import
  it strands stale test entries in place and the weight chart then disagrees with the Health app
  (reported 2026-08-06). So `importWeight(..., force)` is set on backfill only, and only days
  Health actually has a sample for are touched. The weigh-in list labels imported rows "Apple
  Health" so the origin of any row is visible.
- **The Dashboard headline weight is the EWMA trend, not the last weigh-in**, and lags it by
  design; the card now prints the latest actual weigh-in underneath so the gap doesn't read as
  a sync bug.
- **A denied read is invisible.** Apple never reveals read-permission denials, so
  `requestAuthorization` resolving `true` means only that the sheet was shown. Each metric's read
  is individually try/caught (one denied/unavailable type must not fail the sync), and a sync
  that returns nothing at all surfaces "check Health → Sharing → Apps → MacroChef" rather than
  claiming success.
- **Auto-sync** runs on mount + app foreground when the last sync is >15 min old, from the
  Dashboard and the Activity screen; a module-level in-flight promise stops the two overlapping.

### UI
- **Activity screen** (`src/app/health.tsx`, pushed from the Dashboard/Settings): connect + sync
  controls, today's steps/active energy/exercise/sleep, 1W/1M/3M bar charts for steps, active
  energy and sleep, and the workout list.
- **Dashboard** gains a compact ACTIVITY card (steps / active / sleep) that links there; it's
  hidden entirely when HealthKit is unavailable, so Expo Go shows no dead UI.
- **Settings** APPLE HEALTH section: connect, last-synced, open Activity, disconnect.
  Disconnecting clears the activity cache but **keeps imported weigh-ins** — they're part of the
  weight history the trend is built from.

### Chart interaction (added 2026-08-06)
- **Weight (Dashboard):** long-press the line and drag to scrub; the tooltip shows the day, the
  weigh-in logged then, and the trend value (gifted-charts `pointerConfig`,
  `activatePointersOnLongPress`). Day/raw ride along on the data items to make this possible.
- **Calories (Dashboard):** tap a bar to pin the day (value + delta vs target); the pin is a
  button into that day's Log — `(tabs)/log` now accepts a `day` search param for the deep link.
- **Activity charts:** tap a bar to swap the card's headline from the period average to that
  exact day; unselected bars dim. Tapping the same bar again clears.

### Future hooks this opens (not built)
Resting + active energy per day is a real TDEE signal, and steps/sleep are obvious adherence
covariates — enough to do MacroFactor-style expenditure estimation later without another data
migration. Deliberately not attempted here.

## Part 4 — Logging ergonomics pass (added 2026-08-06)

Reported by Shaphen after living with the app: the chart tooltip fought the page scroll, every
add path silently assumed "snack", the scanner dead-ended on products Open Food Facts doesn't
know, and the serving screen led with per-100 g numbers while hiding the macros it computed.

### 4.1 Chart scrub no longer fights the page ✅
Long-pressing the Dashboard weight chart locks the enclosing `ScrollView` (`scrollEnabled={false}`)
for the duration of the scrub, and the tooltip **persists after release** (`persistPointer`) so you
can move your hand out of the way and still read the day.
**The load-bearing detail:** gifted-charts activates its pointer after `activatePointersDelay` of
holding but exposes no callback at that instant — `pointerConfig.onResponderMove` only fires once
the delay has already elapsed *and* the finger has moved, by which point iOS has begun scrolling.
So `WeightChart` mirrors the library's rule with its own timer on `pointerConfig.onTouchStart`
(cleared on `onTouchEnd`/`onResponderEnd`, and on unmount so a torn-down touch can't leave the page
frozen). Locking on touch *start* instead would make a plain flick across the chart un-scrollable.

### 4.2 Every logging path is meal-aware ✅
`src/lib/meals.ts` owns the meal list, labels and `defaultMealForNow()` (breakfast <11:00, lunch
<16:00, dinner <21:00, else snack). `components/meal-picker.tsx` renders the chooser and now sits
on the add-food flow, the food serving picker, the recipe serving picker and the entry editor — so
the meal is visible *and changeable at the moment of logging*, not just inherited from wherever the
flow started. The Dashboard's "+ Add food" and the scan modal previously hard-defaulted to `snack`;
they now start from the clock.

### 4.3 A scan never dead-ends ✅
`lookupBarcode` reports `missing: MacroKey[]` alongside the mapped food (the 0s it writes into the
NOT NULL macro columns are placeholders, not measurements). The scan flow branches on it:
- fully known → saved and straight to the serving picker (unchanged fast path);
- **partially** known → **not saved**; the editor opens pre-filled with what OFF had and the
  missing fields **blank**, with a notice naming them. Saving a half-known product silently would
  bake guesses into the log, where 0 g protein is indistinguishable from measured 0 g protein;
- unknown → the editor opens with just the barcode attached, so saving it makes the next scan of
  that tub an instant local hit (this is what protein powders were failing at);
- lookup error → same manual path, instead of only "Try again".
Prefill travels as a JSON router param (`src/lib/food-prefill.ts`). Name + calories stay required.
`barcodeTypes` also accepts `code128`/`itf14` now (supplement tubs and multipacks).

### 4.4 The serving screen leads with the serving ✅
When logging a food that's already known, `food/[id]` shows name + "N kcal per serving (X g)", the
amount/unit picker, and a **`MacroSummary`** (display-size calories + colour-keyed P/C/F, shared
with the entry editor and recipe builder) — the per-100 g/per-serving label editor collapses behind
"Nutrition facts". It stays expanded for a new/scanned food, because filling it in *is* the task.
Units offered are only the ones that resolve for that food (a per-serving food with no gram serving
size no longer offers g/oz and silently computes 0), and switching units converts the amount so the
real quantity is unchanged (1 serving → 30 g).

### 4.5 Keyboard no longer covers the input ✅
Every scrollable form (`food/[id]`, `log-entry/[id]`, `recipe/[id]`, `add-food`) sets
`automaticallyAdjustKeyboardInsets` + `keyboardDismissMode="interactive"`, so iOS grows the content
inset by the keyboard height and scrolls the focused field above it. Use this on any new form
screen — it needs no `KeyboardAvoidingView` and no extra layout math.

### 4.6 Entry editor can change units ✅
`log-entry/[id]` now offers g / oz / serving, not just the unit the entry was logged in. This stays
snapshot-safe (§5): the only thing read off the current food row is its serving **size in grams** —
metadata used to translate the amount — while the macros still come from the entry's own snapshot
scaled by `newGrams / oldGrams`. It needs a gram anchor on both sides, so 'serving' requires the
food to define a gram serving size, and pre-existing entries stored without `grams` fall back to
same-unit editing. Logging now records resolved `grams` on the entry so this keeps working going
forward. Recipe entries stay servings-only.

### 4.7 Recipe ingredients can come from online ✅
The recipe builder's ingredient search was local-only, so building a recipe meant hand-creating
every ingredient first. `components/online-food-search.tsx` (extracted from the add-food screen, so
both use one implementation) adds the explicit "Search online" step — Open Food Facts always, USDA
when the proxy is configured — and picking a result saves it as a local food row before it becomes
an ingredient. Typing still never fires network requests (§8).

## Part 5 — Bundled offline generic-food database (added 2026-08-06)

Decision context: reviewed the food-data landscape (OFF, USDA proxy, FatSecret, Edamam,
Nutritionix, self-hosted merged DB) for a hypothetical 30K-DAU release. Verdict: stay on the free
stack while this is a hobby project — OFF's rate limits are per *user* for device-direct calls so
they never bind, and the real scale wall is the USDA proxy (one shared API key, 1,000 req/hr, and
Vercel Hobby is non-commercial). A self-hosted OFF+USDA merge (~$20–50/mo) is the upgrade path *if*
the app ever gets traction. What we built now is the free piece of that plan: the everyday
"chicken breast" search answered **on-device, offline, instantly** — which also makes the proxy
optional in practice, not just in code.

### Data: USDA SR Legacy, generated into the bundle ✅
`scripts/build-seed-foods.js` parses the extracted SR Legacy CSV dataset (public domain, download
URL in the script header) into `src/data/seed-foods.json` — 7,793 generic foods as compact tuples
(~860 KB): per-100 g core macros + fiber/sugar/satFat/sodium, plus the first household portion
("1 cup, chopped or diced" = 140 g) as the food's serving. Foods missing any core macro are
excluded outright (0 foods currently) — a seed DB must never smuggle incomplete macros past the
"never save silently" rule (§7). SR Legacy's final release was 2018 and it is frozen upstream, so
the script only reruns if we change what we extract; it then also regenerates
`src/data/seed-foods-version.ts` (a tiny constant module) so the app can version-check without
loading the big JSON. **Gotcha:** SR Legacy's `measure_unit` id 9999 is literally named
"undetermined" — the household-measure text for those rows lives in `food_portion.modifier`.

### Storage: seed_foods is a cache, not user data ✅
Migration v5 adds `seed_foods` (+ name index) and `seed_meta` (single row: imported bundle
version). `src/db/seed.ts#ensureSeedFoods` runs as part of the client.ts module side-effect: one
SELECT against the generated version constant on normal launches; on mismatch (first run / new
bundle) it require()s the JSON and rewrites the table wholesale in one transaction (prepared
statement, ~8K rows). The snapshot rule (§5) does not apply — like `health_days`, rows are
re-derivable — and both tables are deliberately **excluded from backups** (backup.ts): a restored
device rebuilds them from its own bundle.

### Search + logging flow ✅
`components/generic-food-results.tsx` renders a "GENERIC FOODS (USDA)" section in the add-food
screen and the recipe ingredient builder, **as you type** — it's purely local, so the "typing never
fires network requests" rule (§8) is untouched; OFF/proxy stay behind the explicit button.
`searchSeedFoods` (db/queries/seed-foods.ts) ANDs whitespace-split LIKE terms and orders shortest-
name-first (SR descriptions grow a clause per qualifier, so short ≈ canonical). Picking a hit
copies it into `foods` via `seedFoodToNewFood` (lib/seed-foods.ts) with `source='usda'` +
`sourceId=fdcId` — the exact contract of the proxy path, so the two dedupe to one row — and seed
hits already saved locally are hidden from the section. From there it's a normal local food:
serving picker, snapshots, history, recipes.

## Part 6 — Swipe fix + activity/workout presentation (added 2026-08-06)

Reported by Shaphen after living with Part 5: swiping a log row to reveal Delete also pushed the
entry editor, the Dashboard's activity strip was too small to read, and workouts were a plain text
list.

### 6.1 Swiping a log row no longer drills into the editor ✅
**The load-bearing detail:** anything tappable *inside* a `Swipeable` must use gesture-handler's
`Pressable`, not React Native's. RN's `Pressable` runs on the JS responder system, which does not
take part in gesture-handler's arbitration — the pan that opens the row never cancelled it, so
lifting your finger after a swipe still registered as a tap and pushed `/log-entry/[id]`.
Gesture-handler's `Pressable` is built on a tap gesture, so the parent pan wins and the press is
cancelled. Both the row and the Delete button in `renderRightActions` were converted; the screen's
other buttons (date arrows, add, undo) are outside any Swipeable and stay RN core. The Log screen
is currently the app's only Swipeable — apply this rule to any new one.
Long-press action sheet: "Duplicate…" → "Duplicate" (no ellipsis).

### 6.2 Dashboard ACTIVITY card carries real weight ✅
Was three `smallBold` values on one line. Now a 2×2 grid of display-size (20 pt) metrics — Steps,
Active energy, Exercise, Sleep — accent-coloured to the same families the Activity screen uses
(steps blue, energy/exercise orange, sleep purple), with the resting/total-burn line underneath
when Health has it and an explicit "Details →" affordance. Still one tap through to `/health`, and
still hidden entirely when HealthKit is unavailable.

### 6.3 Workouts are tiles, paginated ✅
`WorkoutsCard` renders a two-column tile grid: activity-coloured icon badge, activity name,
display-size duration, then energy/distance and the day. `workoutVisual()` (lib/activity-format.ts)
owns the icon + accent mapping, keyed by the humanized strings `workoutLabel()` emits and grouped
by effort family (cardio blue / strength orange / low-impact purple / other grey-blue), with a
generic badge fallback so an unmapped activity can never render a broken glyph. A unit test walks
every activity type the sync can produce, so renaming a label fails CI instead of silently
demoting real workouts.
Pagination is reveal-more, 6 at a time (`workoutsSince` is newest-first, so slicing from the head
is "most recent N"), with the remaining count spelled out and a Show less once fully expanded;
changing the range resets it.
**CSS gotcha:** the grid uses 50%-wide wrappers with inner padding, NOT `gap` — percentage widths
plus `gap` on the same row overflow, because the gap is added on top of the percentage rather than
divided out of it.

### 6.5 Weight-chart tooltip no longer clips at the right edge ✅
Scrubbing today/yesterday cut the tooltip off; the leftmost points were already fine.
**The load-bearing detail:** gifted-charts' `autoAdjustPointerLabelPosition` centres the label at
`-pointerLabelWidth/2 + 5` from the pointer but only flips it to the LEFT of the pointer once
`pointerX > totalWidth + 10 - pointerLabelWidth/2`. Solving those so the flip always beats the
overflow gives the invariant **`pointerLabelWidth >= renderedWidth + 15`**. Two things follow:
`pointerLabelWidth` is a *positioning input, not a size* (it never sizes the label), and the label
component must therefore have a **fixed width** — ours was auto-sized to its text, so the boundary
was computed against a width the label didn't have, and the newest points (the ones you scrub most)
overflowed. Now `TOOLTIP_WIDTH = 150` is pinned in `styles.tooltip` and `pointerLabelWidth` is
`TOOLTIP_WIDTH + 20`; change the two together. Verified across 375/390/430 pt widths: the flip
fires before overflow AND the flipped label still clears the left edge (18 pt spare on an SE).
The left edge needed nothing — its branch (`pointerX < pointerLabelWidth/2` → `left = 7`) already
worked, which is why only the right side misbehaved.

### 6.4 USDA proxy config is no longer in Settings ✅
It is a developer integration (you must deploy `macrochef-api` yourself), not something an app user
can act on — and since Part 5 generic-food search works offline out of the box. The
`settings.usda_proxy_url` column and `src/api/usda.ts` are unchanged and still honoured when set
directly in the DB; the Settings UI simply no longer renders the field, and `save()` deliberately
omits `usdaProxyUrl` from its update so saving can't clear a developer-configured proxy. The About
section now credits the bundled USDA SR Legacy data instead of describing the proxy as optional.

## 12. Handoff notes (if a different session implements)
- Read this doc top-to-bottom; §4–§7 are the contract. Keep every dependency Expo Go-compatible
  in v1 (no native modules beyond Expo SDK built-ins).
- Snapshot rule (§5) and barcode normalization (§7) are the two easiest things to get subtly
  wrong — both have unit-test fixtures specified in §10.
- OFF requires the custom User-Agent; without it you get throttled/blocked.
- Windows machine: use `npx expo start` from Git Bash or PowerShell; if Metro cache weirdness
  after dependency changes, `npx expo start --clear`.
