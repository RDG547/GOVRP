import { useEffect, useRef } from 'react';
import { subscribeToDomain } from '@/lib/realtime';

export function useDomainRealtime(domain, scope, tables, onChange, enabled = true) {
  const callback = useRef(onChange);
  callback.current = onChange;
  const signature = JSON.stringify(tables);
  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeToDomain(domain, scope || 'public', JSON.parse(signature), (events) => callback.current(events));
  }, [domain, scope, signature, enabled]);
}
