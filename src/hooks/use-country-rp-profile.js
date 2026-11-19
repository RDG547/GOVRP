import { useEffect, useMemo, useState } from 'react';
import {
  loadCountryRpContext,
  mergeCountryRpProfile,
  subscribeToCountryRp,
} from '@/lib/countryRpProfile';

export const useCountryRpProfile = (country, realProfile) => {
  const alpha2 = country?.info?.alpha2 ?? null;
  const [loaded,setLoaded]=useState(null);
  const [requestState,setRequestState]=useState({alpha2:null,status:'idle'});
  const context=loaded?.alpha2===alpha2?loaded.context:null;
  const setContext=context=>setLoaded(context?{alpha2,context}:null);

  useEffect(() => {
    let active = true;

    if (!alpha2) {
      setContext(null);
      return undefined;
    }

    setContext(null);
    setRequestState({alpha2,status:'loading'});
    const refresh = () => {
      loadCountryRpContext(alpha2)
        .then((nextContext) => {
          if (active) {setContext(nextContext);setRequestState({alpha2,status:'ready'});}
        })
        .catch(() => {
          if (active) {setContext(null);setRequestState({alpha2,status:'error'});}
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

  return { profile, rpContext: context, loading:Boolean(alpha2)&&(requestState.alpha2!==alpha2||requestState.status==='loading'), error:requestState.alpha2===alpha2&&requestState.status==='error' };
};
