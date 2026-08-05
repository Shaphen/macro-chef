/**
 * Trend weight: exponentially-weighted moving average over daily weigh-ins,
 * α = 0.1 per day (Hacker's Diet standard). Missing days carry the trend
 * forward unchanged — the next real weigh-in is applied once (no fabricated
 * interpolation). Seed = first weigh-in. See PLAN §6.
 */

const ALPHA = 0.1;

export interface TrendPoint {
  day: string;
  weightKg: number;
  trendKg: number;
}

/** `entries` must be sorted ascending by day and contain at most one entry per day. */
export function computeTrend(entries: { day: string; weightKg: number }[]): TrendPoint[] {
  const out: TrendPoint[] = [];
  let trend: number | null = null;
  for (const e of entries) {
    trend = trend === null ? e.weightKg : trend + ALPHA * (e.weightKg - trend);
    out.push({ day: e.day, weightKg: e.weightKg, trendKg: Math.round(trend * 100) / 100 });
  }
  return out;
}

export function latestTrendKg(entries: { day: string; weightKg: number }[]): number | null {
  const points = computeTrend(entries);
  return points.length ? points[points.length - 1].trendKg : null;
}
