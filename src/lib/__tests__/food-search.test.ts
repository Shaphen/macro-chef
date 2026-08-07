/**
 * Tolerant food matching (PLAN Part 7). The named regressions below are the
 * ones Shaphen actually hit — a whole-query substring match meant one
 * unanticipated word ("and") lost the result entirely.
 */

import {
  editDistanceWithin,
  normalizeText,
  parseQuery,
  prepareTarget,
  scoreMatch,
  searchWithFallback,
} from '../food-search';

/** Rank a small corpus the way the query layer does. */
function rank(names: string[], query: string): string[] {
  const parsed = parseQuery(query);
  if (!parsed) return [];
  return searchWithFallback(
    names.map((name) => ({ name, target: prepareTarget(name) })),
    parsed,
    (entry) => entry.target,
  )
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length)
    .map((hit) => hit.item.name);
}

describe('normalizeText', () => {
  it('folds case, punctuation and accents to comparable words', () => {
    expect(normalizeText('Garlic & Herb Cream-Cheese')).toBe('garlic herb cream cheese');
    expect(normalizeText('Cheese, cream')).toBe('cheese cream');
    expect(normalizeText('Jalapeño')).toBe('jalapeno');
  });

  it('is case-insensitive in both directions', () => {
    expect(normalizeText('Matcha')).toBe(normalizeText('matcha'));
  });
});

describe('parseQuery', () => {
  it('rejects queries too short to be meaningful', () => {
    expect(parseQuery('')).toBeNull();
    expect(parseQuery(' a ')).toBeNull();
    expect(parseQuery('!!')).toBeNull();
  });

  it('splits into tokens and keeps the whole phrase', () => {
    expect(parseQuery('Greek Yogurt')).toEqual({
      normalized: 'greek yogurt',
      tokens: ['greek', 'yogurt'],
    });
  });
});

describe('editDistanceWithin', () => {
  it('measures small edits', () => {
    expect(editDistanceWithin('chicken', 'chiken', 2)).toBe(1);
    expect(editDistanceWithin('broccoli', 'brocoli', 2)).toBe(1);
    expect(editDistanceWithin('abc', 'abc', 1)).toBe(0);
  });

  it('abandons once it provably exceeds the bound', () => {
    expect(editDistanceWithin('chicken', 'salmon', 2)).toBeGreaterThan(2);
    // Length gap alone exceeds the bound.
    expect(editDistanceWithin('rice', 'ricecakesandmore', 1)).toBe(2);
  });
});

describe('the reported regressions', () => {
  const corpus = [
    'Garlic and Herb Cream Cheese',
    'Cheese spread, cream cheese base',
    'Chicken breast, oven-roasted',
    'Quail, breast, meat only, raw',
    'Matcha',
    'Yogurt, Greek, plain, lowfat',
  ];

  it('finds "Garlic and Herb Cream Cheese" from "garlic herb cream cheese"', () => {
    // The whole-query LIKE this replaced returned nothing here.
    expect(rank(corpus, 'garlic herb cream cheese')[0]).toBe('Garlic and Herb Cream Cheese');
  });

  it('still finds it from a subset of its words', () => {
    expect(rank(corpus, 'cream cheese')).toContain('Garlic and Herb Cream Cheese');
  });

  it('matches "Matcha" regardless of the case typed', () => {
    expect(rank(corpus, 'Matcha')).toEqual(rank(corpus, 'matcha'));
    expect(rank(corpus, 'Matcha')[0]).toBe('Matcha');
  });

  it('ignores word order', () => {
    expect(rank(corpus, 'greek yogurt')[0]).toBe('Yogurt, Greek, plain, lowfat');
  });

  it('tolerates a typo, and still prefers the right animal', () => {
    // "breast" matches Quail exactly, so only scoring can put Chicken first.
    expect(rank(corpus, 'chiken breast')[0]).toBe('Chicken breast, oven-roasted');
  });

  it('tolerates a half-typed word', () => {
    expect(rank(corpus, 'chicken brea')[0]).toBe('Chicken breast, oven-roasted');
  });
});

describe('scoreMatch ranking', () => {
  const q = (s: string) => parseQuery(s)!;

  it('scores a contiguous phrase above scattered words', () => {
    const phrase = scoreMatch(prepareTarget('Cream cheese'), q('cream cheese'));
    const scattered = scoreMatch(prepareTarget('Cream of mushroom, cheese added'), q('cream cheese'));
    expect(phrase).toBeGreaterThan(scattered);
  });

  it('requires at least half the typed words to land', () => {
    // One word of four is noise, not a suggestion.
    expect(scoreMatch(prepareTarget('Cheddar cheese'), q('garlic herb cream cheese'))).toBe(0);
    // Two of four is a legitimate near-miss worth showing.
    expect(scoreMatch(prepareTarget('Cheese, cream'), q('garlic herb cream cheese'))).toBeGreaterThan(0);
  });

  it('never matches something unrelated', () => {
    expect(scoreMatch(prepareTarget('Broccoli, raw'), q('chicken breast'))).toBe(0);
  });

  it('ranks a typo match below a real substring match', () => {
    const real = scoreMatch(prepareTarget('Chicken'), q('chicken'));
    const typo = scoreMatch(prepareTarget('Chicken'), q('chiken'));
    expect(real).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThan(0);
  });
});

describe('searchWithFallback', () => {
  it('does not let plentiful weak matches suppress the typo pass', () => {
    // Every "breast" here matches exactly, which once satisfied a
    // count-only fallback threshold and hid the food actually being asked for.
    const corpus = [
      'Quail, breast, raw',
      'Pheasant, breast, raw',
      'Turkey breast, sliced',
      'Duck, breast, raw',
      'Goose, breast, raw',
      'Chicken breast, roasted',
    ];
    expect(rank(corpus, 'chiken breast')[0]).toBe('Chicken breast, roasted');
  });

  it('returns nothing for a term that simply is not present', () => {
    expect(rank(['Broccoli, raw', 'Rice, white'], 'matcha')).toEqual([]);
  });
});
