import { useEffect, useMemo, useState } from 'react';
import {
  loadCountryRpContext,
  mergeCountryRpProfile,
  subscribeToCountryRp,
} from '@/lib/countryRpProfile';

export const useCountryRpProfile = (country, realProfile) => {
  const alpha2 = country?.info?.alpha2 ?? null;
  const [loaded,setLoaded]=useState(null);
  const context=loaded?.alpha2===alpha2?loaded.context:null;
  const setContext=context=>setLoaded(context?{alpha2,context}:null);

  useEffect(() => {
    let active = true;

    if (!alpha2) {
      setContext(null);
      return undefined;
    }

    setContext(null);
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
