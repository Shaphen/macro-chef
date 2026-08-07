# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MacroChef is a local-first calorie/macro + weight-trend tracker (MacroFactor-style, minus
adaptive coaching/AI) for iOS. Expo **SDK 54** / React Native / TypeScript / Expo Router, with
on-device SQLite and no backend. The SDK is deliberately pinned to 54 — the App Store build of
Expo Go supports only SDK 54 (Apple approval backlog); do not bump the `expo` major until the
project moves to `eas go`/dev builds (see PLAN §2 "SDK pin"). **`planning/PLAN.md` is the living spec** — data-model,
nutrition-math, and barcode rules live there (§4–§7); update it as parts ship rather than
creating new planning files.

Also read `AGENTS.md` (Expo SDK 57 changed significantly — check versioned docs before
using Expo APIs from memory).

## Commands

```bash
npx expo start            # dev server — open in Expo Go on the iPhone (same Wi-Fi)
npx expo start --clear    # after dependency/metro config changes
npx tsc --noEmit          # typecheck
npm run lint              # expo lint
npm test                  # jest-expo unit tests (pure logic: nutrition/trend/dates/units/OFF mapping)
```

```bash
eas build --profile development --platform ios   # only for Apple Health work (see below)
# eas-cli is global; `npx eas` fails — the package is eas-cli, the binary is eas
```

The dev loop is **two-track** since Apple Health landed (PLAN Part 3). Everything except
HealthKit still runs in Expo Go, and keeping it that way is a deliberate constraint (PLAN §2) —
`@kingstinct/react-native-healthkit` is the *only* sanctioned native module outside the Expo SDK,
and it is loaded lazily so the Expo Go bundle keeps working. Don't add another native module
without flagging that it forces the EAS-build workflow, and after touching health code verify
Expo Go still bundles (`npx expo export --platform ios`). The camera (barcode scanning) requires
a real device, not the simulator.

## Architecture

- **Routes** live in `src/app/` (Expo Router, typed routes enabled). Tabs: Dashboard
  (`(tabs)/index`), Log, Foods, Settings. Modals declared in the root stack: `add-food`,
  `scan`, `weight`; `food/[id]` doubles as food creator (`id=new`), editor, and — with
  `?log=1&day=&meal=` — the serving-picker/logging screen that every add path funnels into.
  `recipe/[id]` mirrors that exactly for recipes (builder + `?log=1` servings picker);
  `log-entry/[id]` edits a logged entry (proportional snapshot rescale — it never re-reads
  current food macro values; it reads the food's serving SIZE only, to convert units);
  `onboarding` is gated by `settings.onboarded` in `(tabs)/_layout`.
- **Every logging path is meal-aware**: the meal comes from `src/lib/meals.ts`
  (`defaultMealForNow()` when the caller didn't say) and stays changeable at the moment of
  logging via `components/meal-picker.tsx`. Don't hard-default a new logging surface to
  `'snack'`. Amount + resulting macros are rendered by `components/macro-summary.tsx`.
- **Forms**: scrollable form screens set `automaticallyAdjustKeyboardInsets` +
  `keyboardDismissMode="interactive"` on the `ScrollView` so iOS lifts the focused input
  above the keyboard. Use that rather than adding `KeyboardAvoidingView`.
- **Anything tappable inside a `Swipeable` must use gesture-handler's `Pressable`**, not React
  Native's (PLAN Part 6.1). RN's runs on the JS responder system and never gets cancelled by the
  parent pan, so a swipe-to-reveal also fired the row's `onPress`. The Log screen is the only
  Swipeable today; buttons outside one stay RN core.
- **DB**: `src/db/client.ts` opens SQLite and runs hand-rolled append-only SQL migrations
  (tracked via `PRAGMA user_version`) as a module side-effect, so importing any query file
  guarantees the schema. Drizzle schema in `src/db/schema.ts`; all reads/writes go through
  `src/db/queries/*` (synchronous drizzle calls).
- **Snapshot rule (load-bearing)**: `log_entries` and `recipe_items` store computed macro
  totals at log time. Never recompute history from current `foods` rows; editing a food
  must not change past days. Foods are soft-deleted (`is_deleted`) for the same reason.
- **All serving/scaling math** is in `src/lib/nutrition.ts`; trend weight (EWMA, α=0.1) in
  `src/lib/trend.ts`; canonical units are grams / kg / local `YYYY-MM-DD` day keys
  (`src/lib/dates.ts`), converted for display per the single-row `settings` table
  (mirrored in the zustand store `src/state/settings.ts`).
- **Open Food Facts** (`src/api/openfoodfacts.ts`) is called directly from the device and
  requires the custom User-Agent header. Barcode lookups must go through
  `barcodeCandidates()` — iOS reports UPC-A as 13-digit EAN with a leading zero, so both
  forms are tried and the confirmed form is stored on the food. A lookup that is missing
  macros reports them in `missing`; such a product must NOT be auto-saved (the 0s in the
  NOT NULL columns are placeholders) — the scan flow hands it to `food/[id]` as a
  `prefill` param (`src/lib/food-prefill.ts`) with those fields blank. Online search UI is
  shared by the add flow and the recipe builder in `components/online-food-search.tsx`;
  network requests only ever fire on an explicit tap.
- **Food search is scored, not filtered** (`src/lib/food-search.ts`, PLAN Part 7): both
  `searchFoods` (saved foods) and `searchSeedFoods` normalize text and rank candidates, so word
  order, extra words and small typos all still match. Don't reintroduce `LIKE` matching — matching
  the whole query as one substring is the bug this replaced. Performance rules that matter if you
  touch it: the edit-distance DP rows are reused module-level buffers, the fuzzy pass only runs
  when the cheap exact pass comes back weak, and that trigger must key off match *quality* not
  result *count* (a count threshold is silently satisfied by weak matches on a common word).
- **Screen data reads** use `useDbData` (`src/hooks/use-db-data.ts`), which re-queries on
  screen focus — that's how tabs pick up writes made in modals. New screens reading the DB
  should use it rather than one-shot `useState` initializers.
- **USDA proxy (optional)**: `macrochef-api/` is a separate one-function Vercel project
  (see its README to deploy); the app reads the URL from `settings.usda_proxy_url` via
  `src/api/usda.ts`, and ANY failure must degrade silently to local + OFF search.
- **Bundled generic-food seed (Part 5)**: `src/data/seed-foods.json` (~860 KB, generated by
  `scripts/build-seed-foods.js` from USDA SR Legacy — public domain, frozen upstream) is
  imported into the `seed_foods` table by `src/db/seed.ts` as part of the client.ts side-effect;
  normal launches only compare `seed_meta` against the generated `seed-foods-version.ts`
  constant, never loading the JSON. It's a cache like `health_days`: no snapshot rule, excluded
  from backups. Search is offline and as-you-type (`components/generic-food-results.tsx` →
  `searchSeedFoods`); picking a hit copies it into `foods` with `source='usda'` +
  `sourceId=fdcId`, deduping with the proxy path. Don't hand-edit the generated files — rerun
  the script (download URL in its header) and bump its VERSION constant when changing extraction.
- **Apple Health (Part 3, read-only)**: `src/lib/health.ts` is the only file allowed to touch
  the native health module, and it must keep `require`-ing it **lazily** behind the Expo Go
  check — a top-level import would break the Expo Go bundle for the whole app. Weight lands via
  `importWeight()` (`weight_entries.source` enforces "manual weigh-ins are never overwritten by
  sync"); steps/energy/exercise/sleep/workouts land in `health_days` + `health_workouts`, which
  are a **re-syncable cache, not history** — the snapshot rule does not apply and rows are
  overwritten wholesale. Steps/energy must use HealthKit's statistics-collection query (it
  de-duplicates iPhone vs Watch); sleep must be interval-merged and attributed to the wake day.
  Sync state/actions come from `useHealthSync` (`src/hooks/use-health-sync.ts`).
- **Backups**: `src/lib/backup.ts` — JSON dump with raw snake_case rows + schema version;
  import is replace-all in one transaction and refuses newer-schema files.
