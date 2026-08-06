import type { Food } from '../../db/schema';
import { amountToGrams, macrosMismatchCalories, scaleFood, sumTotals } from '../nutrition';

/** Minimal Food row; nutrition fields per 100 g unless perHundred=0. */
function makeFood(overrides: Partial<Food>): Food {
  return {
    id: 1,
    name: 'Test food',
    brand: null,
    barcode: null,
    source: 'custom',
    sourceId: null,
    perHundred: 1,
    calories: 100,
    protein: 10,
    carbs: 20,
    fat: 5,
    fiber: null,
    sugar: null,
    satFat: null,
    sodiumMg: null,
    servingQty: null,
    servingUnit: null,
    servingName: null,
    useCount: 0,
    lastUsedAt: null,
    isDeleted: 0,
    createdAt: 0,
    ...overrides,
  } as Food;
}

describe('amountToGrams', () => {
  it('passes grams through and converts oz', () => {
    const food = makeFood({});
    expect(amountToGrams(food, { unit: 'g', value: 150 })).toBe(150);
    expect(amountToGrams(food, { unit: 'oz', value: 1 })).toBeCloseTo(28.3495, 3);
  });

  it('resolves servings only when servingQty is in g/ml', () => {
    const scoops = makeFood({ servingQty: 30, servingUnit: 'g' });
    expect(amountToGrams(scoops, { unit: 'serving', value: 2 })).toBe(60);
    const units = makeFood({ servingQty: 2, servingUnit: 'unit' });
    expect(amountToGrams(units, { unit: 'serving', value: 2 })).toBeNull();
  });
});

describe('scaleFood (PLAN §5: entry macros = base × grams/100 when per_100, else × servings)', () => {
  it('scales a per-100g food by grams', () => {
    const food = makeFood({});
    expect(scaleFood(food, { unit: 'g', value: 50 })).toEqual({
      calories: 50,
      protein: 5,
      carbs: 10,
      fat: 2.5,
    });
  });

  it('scales a per-100g food by servings via servingQty grams', () => {
    const food = makeFood({ servingQty: 30, servingUnit: 'g' });
    const t = scaleFood(food, { unit: 'serving', value: 2 }); // 60 g
    expect(t.calories).toBeCloseTo(60, 1);
  });

  it('scales a per-serving food by serving count', () => {
    const food = makeFood({ perHundred: 0, calories: 250, protein: 20, carbs: 30, fat: 8 });
    expect(scaleFood(food, { unit: 'serving', value: 1.5 }).calories).toBe(375);
  });

  it('converts grams to servings for a per-serving food with a known serving weight', () => {
    const food = makeFood({ perHundred: 0, calories: 250, servingQty: 50, servingUnit: 'g' });
    expect(scaleFood(food, { unit: 'g', value: 100 }).calories).toBe(500);
  });

  it('yields zero when the conversion is unresolvable rather than guessing', () => {
    const per100NoServing = makeFood({});
    expect(scaleFood(per100NoServing, { unit: 'serving', value: 1 }).calories).toBe(0);
    const perServingNoQty = makeFood({ perHundred: 0, calories: 250 });
    expect(scaleFood(perServingNoQty, { unit: 'g', value: 100 }).calories).toBe(0);
  });
});

describe('sumTotals', () => {
  it('sums with 1-decimal rounding', () => {
    expect(
      sumTotals([
        { calories: 100.1, protein: 1, carbs: 2, fat: 3 },
        { calories: 100.2, protein: 1, carbs: 2, fat: 3 },
      ]),
    ).toEqual({ calories: 200.3, protein: 2, carbs: 4, fat: 6 });
  });
});

describe('macrosMismatchCalories (PLAN §5: hint when |4P+4C+9F − kcal| > 25% kcal)', () => {
  it('accepts labels that add up', () => {
    // 4·10 + 4·20 + 9·5 = 165
    expect(macrosMismatchCalories({ calories: 165, protein: 10, carbs: 20, fat: 5 })).toBe(false);
  });

  it('flags labels that disagree by more than 25%', () => {
    expect(macrosMismatchCalories({ calories: 400, protein: 10, carbs: 20, fat: 5 })).toBe(true);
  });

  it('never flags zero-calorie foods', () => {
    expect(macrosMismatchCalories({ calories: 0, protein: 10, carbs: 0, fat: 0 })).toBe(false);
  });
});
