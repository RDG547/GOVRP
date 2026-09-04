import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { calculateRpNow } from '@/lib/justice/time';
import {
  calculateExchangeVariation,
  getCitizenBaseCurrency,
  getCitizenCountryCode,
} from '@/lib/currency';

const rpDayKey = (settings, realTimestamp) => {
  const rpDate = calculateRpNow(settings, realTimestamp);
  return rpDate?.toISOString().slice(0, 10) || null;
};

export const useRpExchangeRates = (citizen) => {
  const countryCode = getCitizenCountryCode(citizen);
  const baseCurrency = getCitizenBaseCurrency(citizen);
  const [rateRows, setRateRows] = useState([]);
  const [historyRows, setHistoryRows] = useState([]);
  const [timeSettings, setTimeSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');

    let effectiveCountryCode = countryCode;
    let ratesResponse = await supabase
      .from('country_rp_exchange_rates')
      .select('country_code, currency_code, brl_per_unit, source, updated_at')
      .eq('country_code', effectiveCountryCode)
      .order('currency_code');

    if (!ratesResponse.error && !ratesResponse.data?.length && effectiveCountryCode !== 'BR') {
      effectiveCountryCode = 'BR';
      ratesResponse = await supabase
        .from('country_rp_exchange_rates')
        .select('country_code, currency_code, brl_per_unit, source, updated_at')
        .eq('country_code', effectiveCountryCode)
        .order('currency_code');
    }

    const [historyResponse, clockResponse] = await Promise.all([
      supabase
        .from('country_rp_exchange_history')
        .select('country_code, currency_code, brl_per_unit, recorded_at')
        .eq('country_code', effectiveCountryCode)
        .order('recorded_at', { ascending: false })
        .limit(1000),
      supabase.from('rp_time_settings').select('*').eq('id', true).maybeSingle(),
    ]);

    const queryError = ratesResponse.error || historyResponse.error || clockResponse.error;
    if (queryError) {
      setError(queryError.message || 'Não foi possível carregar o câmbio do RP.');
    } else {
      setRateRows(ratesResponse.data || []);
      setHistoryRows((historyResponse.data || []).slice().reverse());
      setTimeSettings(clockResponse.data || null);
    }
    setLoading(false);
  }, [countryCode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let refreshTimer;
    const refresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void load({ quiet: true }), 200);
    };
    const channel = supabase
      .channel(`rp-exchange-cards:${countryCode}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'country_rp_exchange_rates', filter: `country_code=eq.${countryCode}`,
      }, refresh)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'country_rp_exchange_history', filter: `country_code=eq.${countryCode}`,
      }, refresh)
      .subscribe();

    return () => {
      window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [countryCode, load]);

  const rates = useMemo(() => Object.fromEntries(rateRows.map((row) => {
    const current = Number(row.brl_per_unit || 0);
    const currencyHistory = historyRows.filter((history) => history.currency_code === row.currency_code);
    const currentRpDay = rpDayKey(timeSettings, Date.now());
    const sameDayHistory = currentRpDay
      ? currencyHistory.filter((history) => rpDayKey(timeSettings, new Date(history.recorded_at).getTime()) === currentRpDay)
      : [];
    const previousDayHistory = currentRpDay
      ? currencyHistory.filter((history) => {
        const historyDay = rpDayKey(timeSettings, new Date(history.recorded_at).getTime());
        return historyDay && historyDay < currentRpDay;
      })
      : [];
    const reference = Number(
      sameDayHistory[0]?.brl_per_unit
      || previousDayHistory[previousDayHistory.length - 1]?.brl_per_unit
      || current
    );

    return [row.currency_code, {
      ...row,
      value: current,
      referenceValue: reference,
      variation: calculateExchangeVariation(current, reference),
    }];
  })), [historyRows, rateRows, timeSettings]);

  return { baseCurrency, countryCode, rates, rateRows, historyRows, timeSettings, loading, error, refresh: load };
};

export default useRpExchangeRates;
