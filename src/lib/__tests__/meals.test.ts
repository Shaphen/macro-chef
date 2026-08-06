import { defaultMealForNow, mealLabel, MEALS } from '../meals';

const at = (hour: number) => new Date(2026, 7, 6, hour, 30);

describe('defaultMealForNow', () => {
  it('picks the meal the clock suggests', () => {
    expect(defaultMealForNow(at(6))).toBe('breakfast');
    expect(defaultMealForNow(at(10))).toBe('breakfast');
    expect(defaultMealForNow(at(11))).toBe('lunch');
    expect(defaultMealForNow(at(15))).toBe('lunch');
    expect(defaultMealForNow(at(16))).toBe('dinner');
    expect(defaultMealForNow(at(20))).toBe('dinner');
    expect(defaultMealForNow(at(21))).toBe('snack');
    expect(defaultMealForNow(at(23))).toBe('snack');
    expect(defaultMealForNow(at(0))).toBe('breakfast');
  });

  it('only ever returns a real meal key', () => {
    const keys = MEALS.map((m) => m.key);
    for (let hour = 0; hour < 24; hour++) {
      expect(keys).toContain(defaultMealForNow(at(hour)));
    }
  });
});

describe('mealLabel', () => {
  it('names every meal', () => {
    expect(mealLabel('breakfast')).toBe('Breakfast');
    expect(mealLabel('snack')).toBe('Snack');
  });
});
