import { barcodeCandidates, lookupBarcode } from '../openfoodfacts';

/**
 * Fixture-driven tests for the two things PLAN §12 flags as easiest to get
 * subtly wrong: barcode normalization (§7 — iOS reports UPC-A as 13-digit
 * EAN with a leading zero) and the OFF nutriments → Food mapping.
 */

describe('barcodeCandidates (PLAN §7)', () => {
  it('tries a zero-led 13-digit code as-is, then stripped to 12 digits', () => {
    expect(barcodeCandidates('0012345678905')).toEqual(['0012345678905', '012345678905']);
  });

  it('tries a 12-digit UPC-A as-is, then zero-padded to 13', () => {
    expect(barcodeCandidates('012345678905')).toEqual(['012345678905', '0012345678905']);
  });

  it('leaves other codes alone', () => {
    expect(barcodeCandidates('4012345678901')).toEqual(['4012345678901']); // EAN-13, no leading 0
    expect(barcodeCandidates('96385074')).toEqual(['96385074']); // EAN-8
  });
});

describe('lookupBarcode mapping (PLAN §7 fixtures)', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const ok = (body: unknown) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const notFound = () => Promise.resolve({ ok: false, status: 404 });

  const per100Product = {
    status: 1,
    product: {
      code: '0123456789012',
      product_name: 'Peanut Butter',
      brands: 'NutCo, Parent Brand',
      nutrition_data_per: '100g',
      serving_quantity: '32',
      serving_size: '2 tbsp (32 g)',
      nutriments: {
        'energy-kcal_100g': 588,
        proteins_100g: 25,
        carbohydrates_100g: 20,
        fat_100g: 50,
        fiber_100g: 6,
        sugars_100g: 9,
        'saturated-fat_100g': 10,
        sodium_100g: 0.4, // grams — must be stored as 400 mg
      },
    },
  };

  it('maps a per-100g product with the required User-Agent header', async () => {
    fetchMock.mockReturnValueOnce(ok(per100Product));
    const result = await lookupBarcode('0123456789012');

    expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toMatch(/MacroChef/);
    expect(result.found).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.food).toMatchObject({
      name: 'Peanut Butter',
      brand: 'NutCo', // first brand only
      source: 'off',
      perHundred: 1,
      calories: 588,
      protein: 25,
      sodiumMg: 400,
      servingQty: 32,
      servingUnit: 'g',
    });
  });

  it('retries the stripped 12-digit form on 404 and stores the confirmed code (§7)', async () => {
    fetchMock.mockReturnValueOnce(notFound()).mockReturnValueOnce(
      ok({ ...per100Product, product: { ...per100Product.product, code: '123456789012' } }),
    );
    const result = await lookupBarcode('0123456789012');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/product/123456789012');
    expect(result.code).toBe('123456789012');
    expect(result.food?.barcode).toBe('123456789012');
  });

  it('reports macros OFF had no value for, so the scan flow can leave them blank (§7)', async () => {
    fetchMock.mockReturnValueOnce(ok(per100Product));
    expect((await lookupBarcode('0123456789012')).missing).toEqual([]);

    // A tub of protein powder OFF only half-knows: the 0s in `food` are
    // placeholders for the NOT NULL columns, never measured values.
    fetchMock.mockReturnValueOnce(
      ok({
        status: 1,
        product: {
          code: '4012345678901',
          product_name: 'Whey Isolate',
          nutrition_data_per: '100g',
          nutriments: { 'energy-kcal_100g': 380, proteins_100g: 80 },
        },
      }),
    );
    const partial = await lookupBarcode('4012345678901');
    expect(partial.missing).toEqual(['carbs', 'fat']);
    expect(partial.food).toMatchObject({ calories: 380, protein: 80, carbs: 0, fat: 0 });
  });

  it('maps per-serving products with perHundred=0 and _serving fields', async () => {
    fetchMock.mockReturnValueOnce(
      ok({
        status: 1,
        product: {
          code: '4012345678901',
          product_name: 'Protein Bar',
          nutrition_data_per: 'serving',
          serving_quantity: '60',
          nutriments: { 'energy-kcal_serving': 220, proteins_serving: 20 },
        },
      }),
    );
    const result = await lookupBarcode('4012345678901');
    expect(result.food).toMatchObject({ perHundred: 0, calories: 220, protein: 20 });
  });

  it('falls back from kJ when kcal is missing and flags the food incomplete when both are', async () => {
    fetchMock.mockReturnValueOnce(
      ok({
        status: 1,
        product: {
          code: '4012345678901',
          product_name: 'kJ Only',
          nutrition_data_per: '100g',
          nutriments: { energy_100g: 418.4 },
        },
      }),
    );
    const kj = await lookupBarcode('4012345678901');
    expect(kj.food?.calories).toBeCloseTo(100, 1);
    expect(kj.complete).toBe(true);

    fetchMock.mockReturnValueOnce(
      ok({
        status: 1,
        product: {
          code: '4012345678901',
          product_name: 'No Energy',
          nutrition_data_per: '100g',
          nutriments: {},
        },
      }),
    );
    const none = await lookupBarcode('4012345678901');
    expect(none.food?.calories).toBe(0);
    expect(none.complete).toBe(false);
  });

  it('reports not-found after exhausting candidates', async () => {
    fetchMock.mockReturnValue(notFound());
    await expect(lookupBarcode('0123456789012')).resolves.toEqual({ found: false });
  });
});
