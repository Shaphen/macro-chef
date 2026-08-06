import { computeTrend, downsample, latestTrendKg, rollingAverage } from '../trend';

describe('computeTrend (PLAN §6: EWMA, α=0.1, seed = first weigh-in)', () => {
  it('seeds the trend with the first weigh-in', () => {
    const points = computeTrend([{ day: '2026-01-01', weightKg: 80 }]);
    expect(points).toEqual([{ day: '2026-01-01', weightKg: 80, trendKg: 80 }]);
  });

  it('applies trend = trend + 0.1·(weight − trend) per entry', () => {
    const points = computeTrend([
      { day: '2026-01-01', weightKg: 100 },
      { day: '2026-01-02', weightKg: 90 },
    ]);
    expect(points[1].trendKg).toBe(99); // 100 + 0.1·(90 − 100)
  });

  it('applies a weigh-in after a gap exactly once (no interpolation)', () => {
    // Same weights with and without a calendar gap must produce the same
    // trend — missing days carry the trend forward unchanged.
    const gapped = computeTrend([
      { day: '2026-01-01', weightKg: 100 },
      { day: '2026-01-09', weightKg: 90 },
    ]);
    const consecutive = computeTrend([
      { day: '2026-01-01', weightKg: 100 },
      { day: '2026-01-02', weightKg: 90 },
    ]);
    expect(gapped.map((p) => p.trendKg)).toEqual(consecutive.map((p) => p.trendKg));
    expect(gapped).toHaveLength(2); // no fabricated in-between points
  });

  it('rounds trend to 2 decimals', () => {
    const points = computeTrend([
      { day: '2026-01-01', weightKg: 80 },
      { day: '2026-01-02', weightKg: 80.5 },
    ]);
    expect(points[1].trendKg).toBe(80.05);
  });

  it('latestTrendKg returns null with no entries', () => {
    expect(latestTrendKg([])).toBeNull();
  });
});

describe('downsample (PLAN §6: cap chart series, keep the last point)', () => {
  it('returns short series unchanged', () => {
    const input = [1, 2, 3];
    expect(downsample(input, 180)).toBe(input);
  });

  it('caps long series near max and always keeps first and last points', () => {
    const input = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsample(input, 180);
    expect(out.length).toBeLessThanOrEqual(181); // stride sample + kept last
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(999);
  });
});

describe('rollingAverage (trailing 7-day, short prefixes average what exists)', () => {
  it('averages the prefix before a full window exists', () => {
    expect(rollingAverage([1, 2, 3], 7)).toEqual([1, 1.5, 2]);
  });

  it('drops values that leave the trailing window', () => {
    const values = [700, 0, 0, 0, 0, 0, 0, 0];
    const out = rollingAverage(values, 7);
    expect(out[6]).toBe(100); // 700 across the first full 7-day window
    expect(out[7]).toBe(0); // the 700 has left the window
  });
});
