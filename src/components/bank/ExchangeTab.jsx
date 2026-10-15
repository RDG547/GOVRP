import {CurrencyInput} from '@/components/ui/currency-input';
import { formatLocaleBR } from '@/lib/dateTime';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowRightLeft, CandlestickChart, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BANK_POLICY_SETTINGS_KEY, DEFAULT_BANK_POLICY, getExchangeFeeMode, normalizeBankPolicy } from './BankManagementPanel';

const allCurrencies = [
  { code: 'BRL', name: 'Real Brasileiro', symbol: 'R$', flag: '🇧🇷' },
  { code: 'USD', name: 'Dólar Americano', symbol: '$', flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  { code: 'GBP', name: 'Libra Esterlina', symbol: '£', flag: '🇬🇧' },
  { code: 'JPY', name: 'Iene Japonês', symbol: '¥', flag: '🇯🇵' },
  { code: 'CNY', name: 'Yuan Chinês', symbol: '¥', flag: '🇨🇳' },
];

const foreignCurrencies = allCurrencies.filter((currency) => currency.code !== 'BRL');
const missingExchangeSchemaCodes = new Set(['42P01', 'PGRST200', 'PGRST205']);

const ExchangeTab = ({ onUpdate, account }) => {
  const { user } = useAuth();
  const [rates, setRates] = useState(null);
  const [rateRows, setRateRows] = useState([]);
  const [rateHistory, setRateHistory] = useState([]);
  const [chartCurrency, setChartCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [fromCurrency, setFromCurrency] = useState('BRL');
  const [toCurrency, setToCurrency] = useState('USD');
  const [result, setResult] = useState(null);
  const [isExchanging, setIsExchanging] = useState(false);
  const [bankPolicy, setBankPolicy] = useState(() => normalizeBankPolicy(DEFAULT_BANK_POLICY));
  const { toast } = useToast();
  const countryCode = user?.residence_country_code || user?.country_code || 'BR';

  const fetchRates = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      let effectiveCountryCode = countryCode;
      let currentResponse = await supabase
        .from('country_rp_exchange_rates')
        .select('country_code, currency_code, brl_per_unit, source, updated_at')
        .eq('country_code', effectiveCountryCode)
        .order('currency_code');

      if (!currentResponse.error && !currentResponse.data?.length && effectiveCountryCode !== 'BR') {
        effectiveCountryCode = 'BR';
        currentResponse = await supabase
          .from('country_rp_exchange_rates')
          .select('country_code, currency_code, brl_per_unit, source, updated_at')
          .eq('country_code', effectiveCountryCode)
          .order('currency_code');
      }

      if (currentResponse.error) throw currentResponse.error;
      if (!currentResponse.data?.length) throw new Error('As cotações oficiais do RP ainda não estão disponíveis.');

      const historyResponse = await supabase
        .from('country_rp_exchange_history')
        .select('currency_code, brl_per_unit, recorded_at')
        .eq('country_code', effectiveCountryCode)
        .gte('recorded_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('recorded_at', { ascending: false })
        .limit(1000);

      if (historyResponse.error && !missingExchangeSchemaCodes.has(historyResponse.error.code)) {
        throw historyResponse.error;
      }

      const quotes = await supabase.rpc('get_rp_exchange_quotes', { p_country_code: effectiveCountryCode });
      if (quotes.error) throw quotes.error;
      setRateRows(quotes.data || currentResponse.data);
      setRateHistory((historyResponse.data || []).slice().reverse());
      setRates(Object.fromEntries(currentResponse.data.map((row) => [
        row.currency_code,
        1 / Number(row.brl_per_unit),
      ])));
    } catch (error) {
      if (!silent) {
        toast({ title: 'Erro ao buscar cotações', description: error.message, variant: 'destructive' });
      }
      setRates((current) => current || {});
    } finally {
      setLoading(false);
    }
  }, [countryCode, toast]);

  const fetchBankPolicy = useCallback(async () => {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', BANK_POLICY_SETTINGS_KEY)
      .maybeSingle();

    if (!error) setBankPolicy(normalizeBankPolicy(data?.value));
  }, []);

  useEffect(() => {
    fetchRates();
    fetchBankPolicy();
  }, [fetchRates, fetchBankPolicy]);

  useDomainRealtime('bank-exchange', countryCode, ['country_rp_exchange_rates', 'country_rp_exchange_history'], () => fetchRates({ silent: true }));
  useDomainRealtime('bank-policy', 'public', [{ table: 'system_settings', filter: `key=eq.${BANK_POLICY_SETTINGS_KEY}` }], fetchBankPolicy);

  useEffect(() => {
    if (!amount || !rates || !fromCurrency || !toCurrency || fromCurrency === toCurrency) {
      setResult(null);
      return;
    }

    const value = parseFloat(amount);
    if (Number.isNaN(value)) return;
    const rateFrom = fromCurrency === 'BRL' ? 1 : rates[fromCurrency];
    const rateTo = toCurrency === 'BRL' ? 1 : rates[toCurrency];
    if (!rateFrom || !rateTo) {
      setResult(null);
      return;
    }

    const feeMode = getExchangeFeeMode(bankPolicy);
    const feeRate = feeMode === 'percentage' ? Number(bankPolicy.exchange_fee_rate || 0) / 100 : 0;
    const fixedFeeInSourceCurrency = feeMode === 'fixed'
      ? fromCurrency === 'BRL'
        ? Number(bankPolicy.exchange_fee_fixed_amount || 0)
        : Number(bankPolicy.exchange_fee_fixed_amount || 0) * rateFrom
      : 0;
    const feeAmount = Math.min(value, Math.max(0, feeMode === 'fixed' ? fixedFeeInSourceCurrency : value * feeRate));
    const netAmount = Math.max(0, value - feeAmount);
    const brlEquivalent = netAmount / rateFrom;
    const convertedAmount = brlEquivalent * rateTo;
    setResult({ convertedAmount, feeAmount, netAmount, feeRate, feeMode });
  }, [amount, fromCurrency, toCurrency, rates, bankPolicy]);

  const variations = useMemo(() => Object.fromEntries(rateRows.map(row => [row.currency_code, row.change_percent == null ? null : Number(row.change_percent)])), [rateRows]);

  const chartData = useMemo(() => {
    const points = rateHistory
      .filter((row) => row.currency_code === chartCurrency)
      .map((row) => ({
        timestamp: row.recorded_at,
        label: formatLocaleBR(new Date(row.recorded_at), 'toLocaleDateString', 'pt-BR', { day: '2-digit', month: '2-digit' }),
        value: Number(row.brl_per_unit),
      }));
    const current = rateRows.find((row) => row.currency_code === chartCurrency);
    if (current && (!points.length || points.at(-1).value !== Number(current.brl_per_unit))) {
      points.push({
        timestamp: current.updated_at,
        label: formatLocaleBR(new Date(current.updated_at), 'toLocaleDateString', 'pt-BR', { day: '2-digit', month: '2-digit' }),
        value: Number(current.brl_per_unit),
      });
    }
    return points;
  }, [chartCurrency, rateHistory, rateRows]);

  const handleSwapCurrencies = () => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
  };

  const handleExchange = async () => {
    setIsExchanging(true);
    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount <= 0) {
      toast({ title: 'Valor inválido', description: 'Por favor, insira um valor positivo para a troca.', variant: 'destructive' });
      setIsExchanging(false);
      return;
    }

    const { data, error } = await supabase.rpc('execute_exchange', {
      p_from_currency: fromCurrency,
      p_to_currency: toCurrency,
      p_from_amount: numericAmount,
    });

    if (error) {
      toast({ title: 'Erro na transação', description: error.message, variant: 'destructive' });
    } else if (data && !data.success) {
      toast({ title: 'Erro na transação', description: data.message, variant: 'destructive' });
    } else {
      toast({ title: 'Sucesso', description: data.message });
      onUpdate();
      setAmount('');
      setResult(null);
    }
    setIsExchanging(false);
  };

  const handleSetMaxAmount = () => {
    const maxAmount = fromCurrency === 'BRL'
      ? account?.balance || 0
      : account?.currency_balances?.[fromCurrency] || 0;
    setAmount(String(maxAmount));
  };

  if (loading && !rates) {
    return <div className="flex min-h-[200px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const availableCurrencies = allCurrencies.map((currency) => currency.code);
  const getCurrencySymbol = (code) => allCurrencies.find((currency) => currency.code === code)?.symbol || '';
  const formatCurrencyAmount = (value, code) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: code, minimumFractionDigits: code === 'JPY' ? 0 : 2, maximumFractionDigits: code === 'JPY' ? 0 : 4,
  }).format(Number(value || 0));
  const exchangeFeeMode = getExchangeFeeMode(bankPolicy);
  const exchangeFeeDescription = exchangeFeeMode === 'free'
    ? 'gratuita'
    : exchangeFeeMode === 'fixed'
      ? `${formatCurrencyAmount(bankPolicy.exchange_fee_fixed_amount || 0, 'BRL')} por operação`
      : `${Number(bankPolicy.exchange_fee_rate || 0).toFixed(2)}%`;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <Card className="glass-effect">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CandlestickChart /> Cotações do RP</CardTitle>
            <CardDescription>Valores oficiais persistidos e atualizados pela economia nacional.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading && <Loader2 className="my-2 h-4 w-4 animate-spin" />}
            <div>
              <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Valor de 1 unidade da moeda estrangeira em Real Brasileiro (BRL)</h4>
              <ul className="space-y-2">
                {foreignCurrencies.map((currency) => {
                  const row = rateRows.find((item) => item.currency_code === currency.code);
                  const variation = variations[currency.code];
                  const TrendIcon = variation < 0 ? TrendingDown : TrendingUp;
                  return (
                    <li key={currency.code} className="flex items-center justify-between gap-3 rounded-md p-2 hover:bg-white/5">
                      <span className="font-semibold text-foreground"><span className="text-lg">{currency.flag}</span> {currency.name} (1 {currency.code})</span>
                      <span className="text-right">
                        <span className="block font-mono text-primary">R$ {Number(row?.brl_per_unit || 0).toFixed(4)}</span>
                        <span className={`inline-flex items-center text-xs ${variation < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {variation == null ? 'Histórico de 24h indisponível' : <><TrendIcon className="mr-1 h-3 w-3" />{variation >= 0 ? '+' : ''}{variation.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% nas últimas 24h</>}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="border-t border-border pt-4">
              <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Valor de 1 Real Brasileiro (BRL) em moeda estrangeira</h4>
              <ul className="space-y-2">
                {foreignCurrencies.map((currency) => (
                  <li key={currency.code} className="flex items-center justify-between rounded-md p-2 hover:bg-white/5">
                    <span className="font-semibold text-foreground"><span className="text-lg">{currency.flag}</span> Real (1 BRL)</span>
                    <span className="font-mono text-primary">{(rates?.[currency.code] || 0).toFixed(4)} {currency.code}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-effect">
          <CardHeader>
            <CardTitle>Operação de Câmbio</CardTitle>
            <CardDescription>Compre e venda moedas estrangeiras. Taxa do Banco Nacional: {exchangeFeeDescription}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label>De</Label>
                <Select value={fromCurrency} onValueChange={setFromCurrency}>
                  <SelectTrigger><SelectValue placeholder="Moeda de Origem" /></SelectTrigger>
                  <SelectContent>{allCurrencies.filter((currency) => availableCurrencies.includes(currency.code)).map((currency) => <SelectItem key={currency.code} value={currency.code}><span className="text-lg">{currency.flag}</span> {currency.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button variant="ghost" size="icon" onClick={handleSwapCurrencies} className="mb-1" aria-label="Inverter moedas"><ArrowRightLeft className="h-5 w-5 text-primary" /></Button>
              <div className="flex-1">
                <Label>Para</Label>
                <Select value={toCurrency} onValueChange={setToCurrency}>
                  <SelectTrigger><SelectValue placeholder="Moeda de Destino" /></SelectTrigger>
                  <SelectContent>{allCurrencies.map((currency) => <SelectItem key={currency.code} value={currency.code}><span className="text-lg">{currency.flag}</span> {currency.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="amount">Valor a converter ({getCurrencySymbol(fromCurrency)})</Label>
                <Button variant="link" size="sm" className="h-auto p-0 text-primary" onClick={handleSetMaxAmount}>Converter Tudo</Button>
              </div>
              {fromCurrency==='BRL'?<CurrencyInput decimal id="amount" min="0" step="0.01" placeholder="0,00" value={amount} onChange={(event) => setAmount(event.target.value)} className="text-lg" />:<Input id="amount" type="number" min="0" step="0.01" placeholder="0,00" value={amount} onChange={(event) => setAmount(event.target.value)} className="text-lg" />}
            </div>
            <div>
              <Label>Valor estimado ({getCurrencySymbol(toCurrency)})</Label>
              {toCurrency==='BRL'?<CurrencyInput readOnly value={result?Number(result.convertedAmount||0).toFixed(2):'0.00'} className="bg-secondary text-lg"/>:<Input readOnly value={result ? Number(result.convertedAmount || 0).toFixed(4) : '0.0000'} className="bg-secondary text-lg" />}
              {result && getExchangeFeeMode(bankPolicy) !== 'free' ? (
                <p className="mt-2 text-xs text-muted-foreground">Taxa estimada: {formatCurrencyAmount(result.feeAmount, fromCurrency)}. Valor convertido após taxa: {formatCurrencyAmount(result.netAmount, fromCurrency)}.</p>
              ) : (
                <p className="mt-2 text-xs text-emerald-300">Operação sem taxa de conversão no momento.</p>
              )}
            </div>
            <Button onClick={handleExchange} disabled={isExchanging || !result || Number(result.convertedAmount || 0) <= 0 || fromCurrency === toCurrency} className="w-full">
              {isExchanging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}Realizar Câmbio
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-effect">
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Histórico de Cotações</CardTitle>
            <CardDescription>Evolução do valor oficial em BRL nos últimos 30 dias.</CardDescription>
          </div>
          <Select value={chartCurrency} onValueChange={setChartCurrency}>
            <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{foreignCurrencies.map((currency) => <SelectItem key={currency.code} value={currency.code}>{currency.flag} {currency.name}</SelectItem>)}</SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {chartData.length > 1 ? (
            <div className="h-72 w-full" aria-label={`Histórico da cotação de ${chartCurrency}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                  <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} domain={['auto', 'auto']} tickFormatter={(value) => `R$ ${Number(value).toFixed(2)}`} width={76} />
                  <Tooltip formatter={(value) => [`R$ ${Number(value).toFixed(4)}`, `1 ${chartCurrency}`]} contentStyle={{ background: '#0f172a', border: '1px solid rgba(148,163,184,.25)', borderRadius: 12 }} />
                  <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-white/10 px-6 text-center text-sm text-muted-foreground">O histórico começará a formar o gráfico conforme a economia do RP registrar novas cotações.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ExchangeTab;
