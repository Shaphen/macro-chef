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
```

No EAS dev build is needed: every dependency is Expo Go-compatible, and keeping it that
way is a deliberate constraint (PLAN §2) — don't add native modules outside the Expo SDK
without flagging that it forces the EAS-build workflow. The camera (barcode scanning)
requires a real device, not the simulator.

## Architecture

- **Routes** live in `src/app/` (Expo Router, typed routes enabled). Tabs: Dashboard
  (`(tabs)/index`), Log, Foods, Settings. Modals declared in the root stack: `add-food`,
  `scan`, `weight`; `food/[id]` doubles as food creator (`id=new`), editor, and — with
  `?log=1&day=&meal=` — the serving-picker/logging screen that every add path funnels into.
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
  forms are tried and the confirmed form is stored on the food.
- **Screen data reads** use `useDbData` (`src/hooks/use-db-data.ts`), which re-queries on
  screen focus — that's how tabs pick up writes made in modals. New screens reading the DB
  should use it rather than one-shot `useState` initializers.
