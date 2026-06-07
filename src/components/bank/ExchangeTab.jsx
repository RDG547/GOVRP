import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowRightLeft, CandlestickChart } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BANK_POLICY_SETTINGS_KEY, DEFAULT_BANK_POLICY, getExchangeFeeMode, normalizeBankPolicy } from './BankManagementPanel';

const allCurrencies = [
  { code: 'BRL', name: 'Real Brasileiro', symbol: 'R$', flag: '🇧🇷' },
  { code: 'USD', name: 'Dólar Americano', symbol: '$', flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  { code: 'GBP', name: 'Libra Esterlina', symbol: '£', flag: '🇬🇧' },
  { code: 'JPY', name: 'Iene Japonês', symbol: '¥', flag: '🇯🇵' },
  { code: 'CNY', name: 'Yuan Chinês', symbol: '¥', flag: '🇨🇳' },
];

const ExchangeTab = ({ onUpdate, account }) => {
  const [rates, setRates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [fromCurrency, setFromCurrency] = useState('BRL');
  const [toCurrency, setToCurrency] = useState('USD');
  const [result, setResult] = useState(null);
  const [isExchanging, setIsExchanging] = useState(false);
  const [bankPolicy, setBankPolicy] = useState(() => normalizeBankPolicy(DEFAULT_BANK_POLICY));
  const { toast } = useToast();

  const fetchRates = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-exchange-rates');
      if (error || !data.success) {
        throw new Error(error?.message || data?.error || 'Falha na comunicação com o serviço de câmbio.');
      }
      if (data.rates) {
        setRates(data.rates);
      } else {
        throw new Error(data.error || 'Resposta da API de câmbio inválida.');
      }
    } catch (error) {
      toast({ title: 'Erro ao buscar cotações', description: error.message, variant: 'destructive' });
      setRates({});
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchBankPolicy = useCallback(async () => {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', BANK_POLICY_SETTINGS_KEY)
      .maybeSingle();

    if (!error) {
      setBankPolicy(normalizeBankPolicy(data?.value));
    }
  }, []);

  useEffect(() => {
    fetchRates();
    fetchBankPolicy();
  }, [fetchRates, fetchBankPolicy]);

  useEffect(() => {
    if (!amount || !rates || !fromCurrency || !toCurrency || fromCurrency === toCurrency) {
      setResult(null);
      return;
    }

    const value = parseFloat(amount);
    if (isNaN(value)) return;
    
    const rateBRL = 1.0;
    const rateFrom = fromCurrency === 'BRL' ? rateBRL : rates[fromCurrency];
    const rateTo = toCurrency === 'BRL' ? rateBRL : rates[toCurrency];

    if (!rateFrom || !rateTo) {
      setResult(null);
      return;
    }

    const feeMode = getExchangeFeeMode(bankPolicy);
    const feeRate = feeMode === 'percentage' ? Number(bankPolicy.exchange_fee_rate || 0) / 100 : 0;
    const fixedFeeInSourceCurrency =
      feeMode === 'fixed'
        ? fromCurrency === 'BRL'
          ? Number(bankPolicy.exchange_fee_fixed_amount || 0)
          : Number(bankPolicy.exchange_fee_fixed_amount || 0) * rateFrom
        : 0;
    const feeAmount = Math.min(value, Math.max(0, feeMode === 'fixed' ? fixedFeeInSourceCurrency : value * feeRate));
    const netAmount = Math.max(0, value - feeAmount);
    const brlEquivalent = netAmount / rateFrom;
    const convertedAmount = brlEquivalent * rateTo;

    setResult({
      convertedAmount,
      feeAmount,
      netAmount,
      feeRate,
      feeMode,
    });
  }, [amount, fromCurrency, toCurrency, rates, bankPolicy]);

  const handleSwapCurrencies = () => {
    const temp = fromCurrency;
    setFromCurrency(toCurrency);
    setToCurrency(temp);
  };

  const handleExchange = async () => {
    setIsExchanging(true);
    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount <= 0) {
      toast({ title: "Valor inválido", description: "Por favor, insira um valor positivo para a troca.", variant: "destructive" });
      setIsExchanging(false);
      return;
    }

    const { data, error } = await supabase.rpc('execute_exchange', {
      p_from_currency: fromCurrency,
      p_to_currency: toCurrency,
      p_from_amount: numericAmount
    });

    if (error) {
      toast({ title: "Erro na transação", description: error.message, variant: "destructive" });
    } else if (data && !data.success) {
      toast({ title: "Erro na transação", description: data.message, variant: "destructive" });
    } else {
      toast({ title: "Sucesso", description: data.message });
      onUpdate();
      setAmount('');
      setResult(null);
    }
    setIsExchanging(false);
  };

  const handleSetMaxAmount = () => {
    let maxAmount = 0;
    if (fromCurrency === 'BRL') {
      maxAmount = account?.balance || 0;
    } else {
      maxAmount = account?.currency_balances?.[fromCurrency] || 0;
    }
    setAmount(String(maxAmount));
  };

  if (loading && !rates) {
    return <div className="flex justify-center items-center min-h-[200px]"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const availableCurrencies = ['BRL', ...Object.keys(account?.currency_balances || {})];

  const getCurrencySymbol = (code) => allCurrencies.find(c => c.code === code)?.symbol || '';
  const formatCurrencyAmount = (value, code) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: code === 'JPY' ? 0 : 2,
      maximumFractionDigits: code === 'JPY' ? 0 : 4,
    }).format(Number(value || 0));
  const exchangeFeeMode = getExchangeFeeMode(bankPolicy);
  const exchangeFeeDescription =
    exchangeFeeMode === 'free'
      ? 'gratuita'
      : exchangeFeeMode === 'fixed'
        ? `${formatCurrencyAmount(bankPolicy.exchange_fee_fixed_amount || 0, 'BRL')} por operação`
        : `${Number(bankPolicy.exchange_fee_rate || 0).toFixed(2)}%`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CandlestickChart /> Cotações em Tempo Real</CardTitle>
          <CardDescription>Cotações atualizadas diariamente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           {loading && <Loader2 className="w-4 h-4 animate-spin my-2" />}
           <div>
             <h4 className="font-semibold text-sm mb-2 text-muted-foreground">Valor de 1 unidade da moeda estrangeira em Reais (BRL)</h4>
             <ul className="space-y-2">
                {allCurrencies.filter(c => c.code !== 'BRL').map(currency => (
                  <li key={currency.code} className="flex justify-between items-center p-2 rounded-md hover:bg-white/5">
                    <span className="font-semibold text-foreground"><span className="text-lg">{currency.flag}</span> {currency.name} (1 {currency.code})</span>
                    <span className="font-mono text-primary">R$ {(rates?.[currency.code] ? 1 / rates[currency.code] : 0).toFixed(4)}</span>
                  </li>
                ))}
             </ul>
           </div>
           <div className="border-t border-border pt-4">
             <h4 className="font-semibold text-sm mb-2 text-muted-foreground">Valor de 1 Real (BRL) em moeda estrangeira</h4>
              <ul className="space-y-2">
                {allCurrencies.filter(c => c.code !== 'BRL').map(currency => (
                  <li key={currency.code} className="flex justify-between items-center p-2 rounded-md hover:bg-white/5">
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
          <CardDescription>
            Compre e venda moedas estrangeiras. Taxa do Banco Nacional: {exchangeFeeDescription}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label>De</Label>
              <Select value={fromCurrency} onValueChange={setFromCurrency}>
                <SelectTrigger><SelectValue placeholder="Moeda de Origem" /></SelectTrigger>
                <SelectContent>
                  {allCurrencies.filter(c => availableCurrencies.includes(c.code)).map(c => <SelectItem key={c.code} value={c.code}><span className="text-lg">{c.flag}</span> {c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="icon" onClick={handleSwapCurrencies} className="mb-1"><ArrowRightLeft className="w-5 h-5 text-primary" /></Button>
            <div className="flex-1">
              <Label>Para</Label>
              <Select value={toCurrency} onValueChange={setToCurrency}>
                <SelectTrigger><SelectValue placeholder="Moeda de Destino" /></SelectTrigger>
                <SelectContent>
                  {allCurrencies.map(c => <SelectItem key={c.code} value={c.code}><span className="text-lg">{c.flag}</span> {c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center">
              <Label htmlFor="amount">Valor a converter ({getCurrencySymbol(fromCurrency)})</Label>
              <Button variant="link" size="sm" className="p-0 h-auto text-primary" onClick={handleSetMaxAmount}>Converter Tudo</Button>
            </div>
            <Input id="amount" type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="text-lg" />
          </div>
          <div>
            <Label>Valor estimado ({getCurrencySymbol(toCurrency)})</Label>
            <Input readOnly value={result ? Number(result.convertedAmount || 0).toFixed(4) : '0.0000'} className="text-lg bg-secondary" />
            {result && getExchangeFeeMode(bankPolicy) !== 'free' ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Taxa estimada: {formatCurrencyAmount(result.feeAmount, fromCurrency)}. Valor convertido após taxa: {formatCurrencyAmount(result.netAmount, fromCurrency)}.
              </p>
            ) : (
              <p className="mt-2 text-xs text-emerald-300">Operação sem taxa de conversão no momento.</p>
            )}
          </div>
          <Button onClick={handleExchange} disabled={isExchanging || !result || Number(result.convertedAmount || 0) <= 0 || fromCurrency === toCurrency} className="w-full">
            {isExchanging ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowRightLeft className="w-4 h-4 mr-2" />}
            Realizar Câmbio
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ExchangeTab;
