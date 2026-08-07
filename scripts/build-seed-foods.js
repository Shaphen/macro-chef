#!/usr/bin/env node
/**
 * Generates src/data/seed-foods.json — the bundled offline generic-food
 * database (PLAN Part 5) — from the USDA FoodData Central "SR Legacy" CSV
 * dataset. SR Legacy is public domain, ~7.8k generic foods ("Chicken,
 * broilers or fryers, breast, meat only, cooked, roasted"), and frozen: its
 * final release was April 2018, so this script only ever needs re-running if
 * we change what we extract, not to chase upstream updates.
 *
 * Usage:
 *   1. Download https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
 *   2. Extract it anywhere.
 *   3. node scripts/build-seed-foods.js <path-to-extracted-dir>
 *
 * Output format (kept compact — this ships inside the app bundle): a JSON
 * object { version, foods } where each food is a tuple
 *   [fdcId, name, kcal, protein, carbs, fat, fiber, sugar, satFat, sodiumMg,
 *    servingQty, servingName]
 * Nutrition is per 100 g. fiber..sodiumMg are null when USDA has no value.
 * servingQty (grams) + servingName ("1 cup") come from the food's first
 * household portion, null when it has none. Foods missing any of the four
 * core macros are excluded entirely — the app's rule is that incomplete
 * macro data must never be saved silently (see src/api/openfoodfacts.ts),
 * and a seed database is the definition of silent.
 */

const fs = require('fs');
const path = require('path');

const NUTRIENTS = {
  1008: 'calories', // Energy, KCAL
  1003: 'protein',
  1005: 'carbs', // Carbohydrate, by difference
  1004: 'fat', // Total lipid (fat)
  1079: 'fiber',
  2000: 'sugar', // Sugars, Total
  1258: 'satFat', // Fatty acids, total saturated
  1093: 'sodiumMg', // Sodium, Na — already in MG
};
const CORE = ['calories', 'protein', 'carbs', 'fat'];

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'food.csv'))) {
  console.error('Usage: node scripts/build-seed-foods.js <extracted SR Legacy csv dir>');
  console.error('(the directory must contain food.csv — see the header of this script)');
  process.exit(1);
}

/** Minimal RFC-4180 CSV row iterator (fields are quoted, quotes doubled). */
function* csvRows(file) {
  const text = fs.readFileSync(file, 'utf8');
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      yield row;
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    yield row;
  }
}

function readTable(name) {
  const rows = csvRows(path.join(dir, name));
  const header = rows.next().value;
  return { header, rows };
}

const round1 = (n) => Math.round(n * 10) / 10;

// food.csv → fdcId → description
const foods = new Map();
{
  const { rows } = readTable('food.csv');
  for (const r of rows) {
    if (r.length < 3 || !r[0]) continue;
    foods.set(Number(r[0]), r[2]);
  }
}

// food_nutrient.csv → fdcId → { calories, protein, ... }
const nutrition = new Map();
{
  const { rows } = readTable('food_nutrient.csv');
  for (const r of rows) {
    const key = NUTRIENTS[Number(r[2])];
    if (!key) continue;
    const fdcId = Number(r[1]);
    const amount = parseFloat(r[3]);
    if (!isFinite(amount)) continue;
    let n = nutrition.get(fdcId);
    if (!n) nutrition.set(fdcId, (n = {}));
    n[key] = amount;
  }
}

// measure_unit.csv → id → name ("cup"). Id 9999 is literally named
// "undetermined" — for those the household text lives in the portion's
// modifier column instead ("cup, chopped or diced").
const units = new Map();
{
  const { rows } = readTable('measure_unit.csv');
  for (const r of rows) {
    if (r[1] && r[1] !== 'undetermined') units.set(Number(r[0]), r[1]);
  }
}

// food_portion.csv → fdcId → first (seq_num 1) household portion
const portions = new Map();
{
  const { rows } = readTable('food_portion.csv');
  for (const r of rows) {
    const fdcId = Number(r[1]);
    if (portions.has(fdcId) && Number(r[2]) !== 1) continue;
    const amount = parseFloat(r[3]);
    const grams = parseFloat(r[7]);
    if (!isFinite(grams) || grams <= 0) continue;
    const unitName = units.get(Number(r[4]));
    const label = [isFinite(amount) ? String(amount) : null, unitName ?? r[6]]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!portions.has(fdcId) || Number(r[2]) === 1) {
      portions.set(fdcId, { grams: round1(grams), label: label || null });
    }
  }
}

const out = [];
let skippedIncomplete = 0;
for (const [fdcId, name] of foods) {
  const n = nutrition.get(fdcId);
  if (!n || CORE.some((k) => n[k] === undefined)) {
    skippedIncomplete++;
    continue;
  }
  const p = portions.get(fdcId);
  out.push([
    fdcId,
    name,
    round1(n.calories),
    round1(n.protein),
    round1(n.carbs),
    round1(n.fat),
    n.fiber !== undefined ? round1(n.fiber) : null,
    n.sugar !== undefined ? round1(n.sugar) : null,
    n.satFat !== undefined ? round1(n.satFat) : null,
    n.sodiumMg !== undefined ? Math.round(n.sodiumMg) : null,
    p ? p.grams : null,
    p && p.label ? p.label : null,
  ]);
}
out.sort((a, b) => a[0] - b[0]);

const VERSION = 1; // bump when changing what this script extracts

const outPath = path.join(__dirname, '..', 'src', 'data', 'seed-foods.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
// One food per line keeps the file diffable without costing much size.
const json = `{"version":${VERSION},"foods":[\n${out.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
fs.writeFileSync(outPath, json);

// The version also ships as a tiny standalone module so the app can decide
// whether a re-import is needed WITHOUT require()ing the big JSON above
// (see src/db/seed.ts). Generated together = the two can never drift.
fs.writeFileSync(
  path.join(path.dirname(outPath), 'seed-foods-version.ts'),
  `// Generated by scripts/build-seed-foods.js — do not edit.\nexport const SEED_FOODS_VERSION = ${VERSION};\n`,
);

console.log(
  `Wrote ${out.length} foods (${(json.length / 1024).toFixed(0)} KB) to ${path.relative(process.cwd(), outPath)}`,
);
console.log(`Skipped ${skippedIncomplete} foods with incomplete core macros.`);
