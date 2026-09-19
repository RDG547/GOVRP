import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from './use-domain-realtime';
import { getCitizenBaseCurrency, getCitizenCountryCode } from '@/lib/currency';

// Both bank views read the same server-calculated, real 24-hour quotation.
export const useRpExchangeRates = (citizen) => {
  const countryCode = getCitizenCountryCode(citizen);
  const baseCurrency = getCitizenBaseCurrency(citizen);
  const [rateRows, setRateRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const load = useCallback(async ({ quiet = false } = {}) => {
    const version = ++sequence.current;
    if (!quiet) setLoading(true);
    const result = await supabase.rpc('get_rp_exchange_quotes', { p_country_code: countryCode });
    if (version !== sequence.current) return;
    setError(result.error ? 'Não foi possível consultar as cotações.' : '');
    if (!result.error) setRateRows(result.data || []);
    setLoading(false);
  }, [countryCode]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  // An unsupported country uses BR; its updates also have to reach this view.
  useDomainRealtime('bank-exchange', countryCode, ['country_rp_exchange_rates', 'country_rp_exchange_history'], () => load({ quiet: true }));
  const rates = useMemo(() => Object.fromEntries(rateRows.map(row => [row.currency_code, {
    ...row,
    value: Number(row.brl_per_unit),
    referenceValue: row.day_open_rate == null ? null : Number(row.day_open_rate),
    variation: row.change_percent == null ? null : Number(row.change_percent),
  }])), [rateRows]);
  return { baseCurrency, countryCode, rates, rateRows, loading, error, refresh: load };
};
export default useRpExchangeRates;
