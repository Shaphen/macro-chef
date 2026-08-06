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

/**
 * Chart timeframes shared by the dashboard cards (PLAN §6). Days are
 * approximate calendar spans — charts don't need calendar-exact month
 * arithmetic, and fixed day counts keep the "from" computation a single
 * addDays call. `null` = All.
 */
export const TIMEFRAMES = [
  { key: '1W', days: 7 },
  { key: '1M', days: 30 },
  { key: '3M', days: 91 },
  { key: '6M', days: 182 },
  { key: '1Y', days: 365 },
  { key: 'All', days: null },
] as const;

export type TimeframeKey = (typeof TIMEFRAMES)[number]['key'];

/**
 * Cap a series at `max` points for chart performance (PLAN §6: "downsample
 * >180 points"). Strategy: keep every nth point but ALWAYS keep the last
 * one — the most recent value is the one the user is actually looking for,
 * and a stride can otherwise drop it. Simple stride (vs. LTTB etc.) is
 * enough here: trend weight is already smoothed and calorie bars are
 * visually aggregated anyway at those densities.
 */
export function downsample<T>(points: T[], max = 180): T[] {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  const out: T[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

/**
 * Trailing 7-day rolling average for the calorie chart (PLAN §6). Window is
 * "the last `window` values up to and including today"; short prefixes
 * average what exists so the line starts at day one instead of appearing a
 * week in. Zero (untracked) days are averaged in as zeros — the input series
 * is calendar-filled, and pretending untracked days didn't happen would
 * bias the average upward.
 */
export function rollingAverage(values: number[], window = 7): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out.push(sum / Math.min(i + 1, window));
  }
  return out;
}
