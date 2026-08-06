import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { clearHealthCache } from '@/db/queries/health';
import {
  healthAvailability,
  requestHealthPermission,
  syncHealth,
  type HealthSyncResult,
} from '@/lib/health';
import { useSettings } from '@/state/settings';

/** Don't re-sync more often than this on foreground/focus. */
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;

/**
 * A sync in flight, shared across every hook instance. The Dashboard and the
 * Activity screen both auto-sync, and HealthKit queries are slow enough that
 * two overlapping passes would double-write the same window.
 */
let inFlight: Promise<HealthSyncResult> | null = null;

export interface UseHealthSync {
  availability: ReturnType<typeof healthAvailability>;
  /** User has granted (or at least completed) the HealthKit prompt. */
  enabled: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  lastResult: HealthSyncResult | null;
  error: string | null;
  /** Show the permission sheet, then run a full backfill. */
  connect: () => Promise<HealthSyncResult | null>;
  /** Manual "Sync now". */
  sync: () => Promise<HealthSyncResult | null>;
  /** Stop syncing and drop the cached activity data (weigh-ins are kept). */
  disconnect: () => void;
}

/**
 * Apple Health connection state + sync actions (PLAN Part 3).
 *
 * `auto: true` syncs on mount and on app foreground when the last sync is
 * stale — that's what makes the Activity numbers current without the user
 * ever pressing anything.
 */
export function useHealthSync({ auto = false }: { auto?: boolean } = {}): UseHealthSync {
  const { settings, update } = useSettings();
  const availability = healthAvailability();
  const enabled = settings.healthSyncEnabled === 1;
  const lastSyncAt = settings.healthLastSyncAt ?? null;

  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<HealthSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Kept in refs so the auto-sync effect doesn't re-run (and re-sync) every
  // time a settings write changes the store identity.
  const stateRef = useRef({ enabled, lastSyncAt, available: availability.available });
  stateRef.current = { enabled, lastSyncAt, available: availability.available };

  const run = useCallback(
    async (from: number | null): Promise<HealthSyncResult | null> => {
      setError(null);
      setSyncing(true);
      try {
        inFlight = inFlight ?? syncHealth(from);
        const result = await inFlight;
        update({ healthLastSyncAt: Date.now() });
        setLastResult(result);
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Health sync failed.');
        return null;
      } finally {
        inFlight = null;
        setSyncing(false);
      }
    },
    [update],
  );

  const connect = useCallback(async () => {
    if (!availability.available) {
      setError(availability.reason);
      return null;
    }
    try {
      await requestHealthPermission();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open Apple Health.');
      return null;
    }
    update({ healthSyncEnabled: 1 });
    // null → full backfill, regardless of any stale timestamp from a
    // previous connection.
    return run(null);
  }, [availability.available, availability.reason, run, update]);

  const sync = useCallback(() => {
    if (!enabled || !availability.available) return Promise.resolve(null);
    return run(lastSyncAt);
  }, [availability.available, enabled, lastSyncAt, run]);

  const disconnect = useCallback(() => {
    // Imported weigh-ins stay: they're part of the weight history the trend
    // line is built from, and deleting them would silently rewrite the past.
    clearHealthCache();
    update({ healthSyncEnabled: 0, healthLastSyncAt: null });
    setLastResult(null);
  }, [update]);

  useEffect(() => {
    if (!auto) return;
    const maybeSync = () => {
      const s = stateRef.current;
      if (!s.enabled || !s.available || inFlight) return;
      if (s.lastSyncAt && Date.now() - s.lastSyncAt < AUTO_SYNC_INTERVAL_MS) return;
      void run(s.lastSyncAt);
    };
    maybeSync();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') maybeSync();
    });
    return () => sub.remove();
  }, [auto, run]);

  return {
    availability,
    enabled,
    syncing,
    lastSyncAt,
    lastResult,
    error,
    connect,
    sync,
    disconnect,
  };
}
