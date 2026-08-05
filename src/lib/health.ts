import { Platform } from 'react-native';

import { importWeight } from '../db/queries/weight';
import { dayKey } from './dates';

/**
 * Health-platform adapter (PLAN Part 2.2).
 *
 * Design intent: this file is the ONLY place that will ever touch a native
 * health module. Everything else in the app (Settings toggle, weight
 * queries, trend math) is already wired against this interface, so when the
 * project moves to an EAS dev build (Phase 5 — the natural moment, since
 * HealthKit needs a native module that Expo Go cannot load), enabling the
 * integration means swapping the stub bodies below for real
 * `@kingstinct/react-native-healthkit` calls and nothing else.
 *
 * Why a stub rather than the real module today: PLAN §2's durable constraint
 * is that every dependency stays Expo Go-compatible until TestFlight. Even an
 * *unused* import of a native module breaks the Metro bundle in Expo Go, so
 * the availability gate has to be a hardcoded capability check, not a
 * try/require probe.
 */

export interface HealthWeightSample {
  /** Local day the sample belongs to ('YYYY-MM-DD'). */
  day: string;
  weightKg: number;
  /** Epoch ms of the sample, used to pick the latest sample per day. */
  sampledAt: number;
}

/**
 * Whether a health platform is actually usable in this build. Expo Go can
 * never satisfy this; a future dev build flips it by detecting the module.
 */
export function healthAvailability(): { available: boolean; reason: string } {
  if (Platform.OS === 'ios') {
    return {
      available: false,
      reason:
        'Apple Health needs a development build (HealthKit is a native module Expo Go can\u2019t load). It unlocks automatically with the TestFlight build.',
    };
  }
  return {
    available: false,
    reason: 'Health Connect arrives with the Android release.',
  };
}

/**
 * Request read access to body-mass samples. Stubbed to reject so any code
 * path that ignores `healthAvailability()` fails loudly instead of
 * pretending a connection happened.
 */
export async function requestHealthPermission(): Promise<boolean> {
  throw new Error('Health integration is not available in this build.');
}

/**
 * Fetch body-mass samples since `fromMs` (backfill passes 0). Real
 * implementation will query HealthKit and map each sample to local day keys
 * via `dayKey(new Date(sample.startDate))`.
 */
export async function fetchWeightSamples(_fromMs: number): Promise<HealthWeightSample[]> {
  throw new Error('Health integration is not available in this build.');
}

/**
 * Sync helper the Settings toggle / app-foreground hook will call. Pure over
 * its inputs so it is unit-testable today, before any native module exists:
 *   1. bucket samples by local day,
 *   2. keep only the latest sample per day ("latest sample of the day wins",
 *      PLAN Part 2.2),
 *   3. hand each winner to `importWeight`, which enforces manual-never-
 *      overwritten and returns whether it actually wrote.
 * Returns the number of imported days for a "Synced N weigh-ins" toast.
 */
export function applyWeightSamples(
  samples: HealthWeightSample[],
  source: 'healthkit' | 'healthconnect',
): number {
  const latestPerDay = new Map<string, HealthWeightSample>();
  for (const s of samples) {
    const current = latestPerDay.get(s.day);
    if (!current || s.sampledAt > current.sampledAt) latestPerDay.set(s.day, s);
  }
  let imported = 0;
  for (const s of latestPerDay.values()) {
    if (importWeight(s.day, s.weightKg, source)) imported++;
  }
  return imported;
}

/** Convenience for the future native mapping code (documented intent above). */
export function sampleDay(date: Date): string {
  return dayKey(date);
}
