import { useCallback, useEffect, useRef } from 'react';

// Serialize data reads and coalesce bursts. A final complete read covers changes
// received during an in-flight request, without losing events or racing snapshots.
export function useQueuedRefresh(load, trailingArgs = []) {
  const latest = useRef(load), trailing = useRef(trailingArgs), running = useRef(null), pending = useRef(false), mounted = useRef(true);
  latest.current = load; trailing.current = trailingArgs;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useCallback((...args) => {
    if (running.current) { pending.current = true; return running.current; }
    running.current = (async () => {
      try {
        await latest.current(...args);
        while (pending.current && mounted.current) {
          pending.current = false;
          await latest.current(...trailing.current);
        }
      } finally { running.current = null; }
    })();
    return running.current;
  }, []);
}
