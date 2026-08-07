import { SEED_FOODS_VERSION } from '../../data/seed-foods-version';
import type { SeedFood } from '../../db/schema';
import { searchTerms, seedFoodToNewFood, type SeedData } from '../seed-foods';

// The real bundled asset — the contract tests below run against what
// actually ships, so a bad regeneration fails CI instead of the app.
const seedData = require('../../data/seed-foods.json') as SeedData;

describe('searchTerms', () => {
  it('splits on whitespace and drops empties', () => {
    expect(searchTerms('chicken breast roast')).toEqual(['chicken', 'breast', 'roast']);
    expect(searchTerms('  rice   white ')).toEqual(['rice', 'white']);
  });

  it('returns [] for blank input', () => {
    expect(searchTerms('')).toEqual([]);
    expect(searchTerms('   ')).toEqual([]);
  });
});

describe('seedFoodToNewFood', () => {
  const row: SeedFood = {
    fdcId: 171477,
    name: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted',
    calories: 165,
    protein: 31,
    carbs: 0,
    fat: 3.6,
    fiber: 0,
    sugar: 0,
    satFat: 1,
    sodiumMg: 74,
    servingQty: 140,
    servingName: '1 cup, chopped or diced',
  };

  it('maps to a per-100g usda food keyed by fdcId (dedupes with the proxy path)', () => {
    const food = seedFoodToNewFood(row);
    expect(food).toMatchObject({
      source: 'usda',
      sourceId: '171477',
      perHundred: 1,
      barcode: null,
      calories: 165,
      protein: 31,
      servingQty: 140,
      servingUnit: 'g',
      servingName: '1 cup, chopped or diced',
    });
  });

  it('omits the serving unit when there is no portion', () => {
    const food = seedFoodToNewFood({ ...row, servingQty: null, servingName: null });
    expect(food.servingQty).toBeNull();
    expect(food.servingUnit).toBeNull();
    expect(food.servingName).toBeNull();
  });
});

describe('bundled seed-foods.json contract', () => {
  it('version matches the generated constant', () => {
    expect(seedData.version).toBe(SEED_FOODS_VERSION);
  });

  it('has thousands of foods with unique fdcIds', () => {
    expect(seedData.foods.length).toBeGreaterThan(7000);
    const ids = new Set(seedData.foods.map((f) => f[0]));
    expect(ids.size).toBe(seedData.foods.length);
  });

  it('every tuple matches the seeder INSERT layout', () => {
    for (const f of seedData.foods) {
      expect(f).toHaveLength(12);
      const [fdcId, name, calories, protein, carbs, fat] = f;
      expect(typeof fdcId).toBe('number');
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
      // Core macros are required — the generator excludes incomplete foods.
      for (const v of [calories, protein, carbs, fat]) {
        expect(typeof v).toBe('number');
        expect(v).toBeGreaterThanOrEqual(0);
      }
      // Optional fields are number-or-null; serving name is string-or-null.
      for (const v of f.slice(6, 11)) {
        expect(v === null || typeof v === 'number').toBe(true);
      }
      expect(f[11] === null || typeof f[11] === 'string').toBe(true);
    }
  });
});
