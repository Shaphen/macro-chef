import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/**
 * Read synchronous SQLite data and re-read whenever the screen regains focus
 * (entries added from modals show up on return). `deps` should include
 * anything the query closes over (e.g. the selected day).
 */
export function useDbData<T>(query: () => T, deps: unknown[] = []): { data: T; refresh: () => void } {
  const [data, setData] = useState<T>(query);

  const refresh = useCallback(() => {
    setData(query());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return { data, refresh };
}
