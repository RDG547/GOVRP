import { useEffect, useMemo, useState } from 'react';
import {
  loadCountryRpContext,
  mergeCountryRpProfile,
  subscribeToCountryRp,
} from '@/lib/countryRpProfile';

export const useCountryRpProfile = (country, realProfile) => {
  const alpha2 = country?.info?.alpha2 ?? null;
  const [context, setContext] = useState(null);

  useEffect(() => {
    let active = true;

    if (!alpha2) {
      setContext(null);
      return undefined;
    }

    const refresh = () => {
      loadCountryRpContext(alpha2)
        .then((nextContext) => {
          if (active) setContext(nextContext);
        })
        .catch(() => {
          if (active) setContext(null);
        });
    };

    refresh();
    const unsubscribe = subscribeToCountryRp(alpha2, refresh);
    window.addEventListener('govrp:resume', refresh);

    return () => {
      active = false;
      window.removeEventListener('govrp:resume', refresh);
      unsubscribe();
    };
  }, [alpha2]);

  const profile = useMemo(
    () => mergeCountryRpProfile(realProfile, context),
    [context, realProfile],
  );

  return { profile, rpContext: context };
};
