import { useCallback, useEffect, useRef } from 'react';
import { createSectionLoader } from '@/lib/sectionLoader';

export function useSectionLoader(scope, load, apply, reportError) {
  const callbacks = useRef({ load, apply, reportError });
  callbacks.current = { load, apply, reportError };
  const instance = useRef(null);
  useEffect(() => {
    const loader = createSectionLoader(
      keys => callbacks.current.load(keys),
      (result, keys) => callbacks.current.apply(result, keys),
      error => callbacks.current.reportError?.(error),
    );
    instance.current = { scope, loader };
    return () => { loader.dispose(); if (instance.current?.loader === loader) instance.current = null; };
  }, [scope]);
  return useCallback(keys => instance.current?.scope === scope
    ? instance.current.loader.refresh(keys) : Promise.resolve(), [scope]);
}
