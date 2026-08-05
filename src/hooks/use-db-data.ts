import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/**
 * Read synchronous SQLite data and re-read whenever the screen regains focus
 * (entries added from modals show up on return). `deps` should include
 * anything the query closes over (e.g. the selected day); a deps change
 * re-runs the query via the focus effect re-subscribing.
 */
export function useDbData<T>(query: () => T, deps: unknown[] = []): { data: T; refresh: () => void } {
  const [data, setData] = useState<T>(query);
  const depsKey = JSON.stringify(deps);

  const refresh = useCallback(() => {
    setData(() => query());
    // `query` is intentionally excluded — callers pass inline closures whose
    // meaningful inputs are captured in `deps`/`depsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return { data, refresh };
}
