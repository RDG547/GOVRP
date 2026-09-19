import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, KeyRound, Loader2, Eye, EyeOff, ArrowRight, Receipt } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatCurrency } from '@/lib/utils';
import { motion } from 'framer-motion';
import useRpExchangeRates from '@/hooks/use-rp-exchange-rates';
import { formatExchangeRate, getExchangePair, getExchangeTrend } from '@/lib/currency';

const currencySymbols = {
  BRL: 'R$',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
};

const currencyFlags = {
  BRL: '🇧🇷',
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  JPY: '🇯🇵',
  CNY: '🇨🇳',
};

const BalanceCard = ({ account, onUpdate, onTransferClick, onPayClick }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [visibleCurrencies, setVisibleCurrencies] = useState(['BRL', 'USD', 'EUR', 'GBP', 'JPY', 'CNY']);
  const [isBalanceVisible, setIsBalanceVisible] = useState(true);
  const { baseCurrency, rates, loading: ratesLoading, error: ratesError } = useRpExchangeRates(user);

  useEffect(() => {
    if (user?.ui_preferences?.visibleCurrencies) {
      setVisibleCurrencies(user.ui_preferences.visibleCurrencies);
    }
  }, [user]);

  const handleCurrencyToggle = async (currency) => {
    const newVisibleCurrencies = visibleCurrencies.includes(currency)
        ? visibleCurrencies.filter(c => c !== currency)
        : [...visibleCurrencies, currency];
    
    setVisibleCurrencies(newVisibleCurrencies);

    const { error } = await supabase
      .from('profiles')
      .update({ ui_preferences: { ...user.ui_preferences, visibleCurrencies: newVisibleCurrencies } })
      .eq('id', user.id);

    if (error) {
      toast({ title: 'Erro ao salvar preferência', variant: 'destructive' });
      setVisibleCurrencies(visibleCurrencies);
    }
  };

  const copyToClipboard = (text, message) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast({ description: message });
  };
  
  const generateTransferKey = async () => {
    setIsGeneratingKey(true);
    const { data, error } = await supabase.rpc('generate_transfer_key_for_user');
    if (error || (data && !data.success)) {
      toast({ title: 'Erro ao gerar chave', description: data?.message || error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Sucesso!', description: data.message });
      onUpdate();
    }
    setIsGeneratingKey(false);
  };

  const allBalances = {
    BRL: account?.balance || 0,
    USD: account?.currency_balances?.USD || 0,
    EUR: account?.currency_balances?.EUR || 0,
    GBP: account?.currency_balances?.GBP || 0,
    JPY: account?.currency_balances?.JPY || 0,
    CNY: account?.currency_balances?.CNY || 0,
  };

  const displayedBalances = Object.entries(allBalances)
    .filter(([currency]) => visibleCurrencies.includes(currency));
    
  const accountInfoText = `Ag: ${account?.agency_number} / Cc: ${account?.account_number}`;

  const renderRate = (currency) => {
    const rate = rates[currency];
    if (ratesLoading && !rate) {
      return <span className="inline-flex items-center text-[11px] text-blue-200/60"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Atualizando câmbio</span>;
    }
    if (!rate) return <span className="text-[11px] text-blue-200/60">Cotação indisponível</span>;

    const trend = getExchangeTrend(rate.variation);
    const trendSymbol = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '—';
    const trendClass = trend === 'up' ? 'text-emerald-300' : trend === 'down' ? 'text-rose-300' : 'text-blue-200/70';
    return (
      <div className="shrink-0 border-l border-white/10 pl-2 text-right">
        <p className="text-[10px] uppercase tracking-wide text-blue-200/55">{getExchangePair(currency, baseCurrency)}</p>
        <p className="whitespace-nowrap text-xs font-semibold text-blue-50">{formatExchangeRate(rate.value, baseCurrency)}</p>
        <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold ${trendClass}`} title="Variação nas últimas 24 horas reais">
          <span aria-hidden="true">{trendSymbol}</span>
          {rate.variation == null ? 'Sem histórico de 24h' : `${rate.variation >= 0 ? '+' : ''}${Number(rate.variation).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
        </span>
      </div>
    );
  };

  return (
    <div className="relative rounded-2xl p-6 text-white overflow-hidden bg-gradient-to-br from-blue-900 via-slate-900 to-purple-900">
      <div className="absolute inset-0 bg-black/20"></div>
      <div className="relative z-10">
        <div className="flex justify-between items-start mb-4">
          <div className="text-left">
            <p className="text-sm text-blue-200/80"><span className="text-base">{currencyFlags.BRL}</span> Saldo principal · Real Brasileiro (BRL)</p>
            <div className="flex items-center gap-2">
              <p className="text-4xl font-bold">
                {isBalanceVisible ? formatCurrency(allBalances.BRL || 0) : 'R$ ••••••'}
              </p>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-200/80 hover:text-white hover:bg-white/10" onClick={() => setIsBalanceVisible(!isBalanceVisible)}>
                {isBalanceVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <div className="flex items-center text-blue-200/70 text-xs mt-1 font-mono">
              <span>{accountInfoText}</span>
               <Button variant="ghost" size="icon" className="h-6 w-6 text-blue-200/80 hover:text-white" onClick={() => copyToClipboard(accountInfoText, "Dados da conta copiados!")}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-200/80 hover:text-white hover:bg-white/10">
                 <Eye className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56">
              <div className="space-y-2">
                <p className="font-medium text-sm">Exibir Moedas</p>
                {Object.keys(currencySymbols).map(currency => (
                  <div key={currency} className="flex items-center space-x-2">
                    <Checkbox
                      id={`currency-${currency}`}
                      checked={visibleCurrencies.includes(currency)}
                      onCheckedChange={() => handleCurrencyToggle(currency)}
                    />
                    <Label htmlFor={`currency-${currency}`} className="text-sm font-normal">
                      <span className="text-base">{currencyFlags[currency]}</span> {currency} ({currencySymbols[currency]})
                    </Label>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        
        <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {displayedBalances.filter(([c]) => c !== 'BRL').map(([currency, balance], index) => (
            <motion.div 
              key={currency} 
              className="p-2 rounded-lg bg-white/5 backdrop-blur-sm"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-blue-200/70"><span className="text-base">{currencyFlags[currency]}</span> {currency}</p>
                  <p className="truncate text-lg font-bold">
                    {isBalanceVisible ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency, minimumFractionDigits: 2 }).format(balance || 0) : `${currencySymbols[currency]} ••••••`}
                  </p>
                </div>
                {renderRate(currency)}
              </div>
            </motion.div>
          ))}
        </div>

        {ratesError ? <p role="status" className="-mt-3 mb-4 text-xs text-amber-200">Os saldos continuam disponíveis; a cotação será atualizada automaticamente quando a conexão retornar.</p> : null}

        <div className="border-t border-white/10 pt-4 mt-4">
            <div className="flex gap-4">
                <Button onClick={onTransferClick} className="flex-1 bg-blue-500 hover:bg-blue-600 text-white">
                  <ArrowRight className="w-4 h-4 mr-2" />Transferir
                </Button>
                <Button onClick={onPayClick} className="flex-1" variant="secondary">
                  <Receipt className="w-4 h-4 mr-2" />Pagar
                </Button>
            </div>
            <div className="text-blue-200/80 text-sm space-y-2 mt-4">
              {account?.transfer_key ? (
                <div className="flex items-center justify-center gap-2 bg-black/20 p-2 rounded-md">
                  <p>Chave de Transferência: <span className="font-bold text-white tracking-widest">{account.transfer_key}</span></p>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-blue-200/80 hover:text-white" onClick={() => copyToClipboard(account?.transfer_key, "Chave de transferência copiada!")}>
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <Button onClick={generateTransferKey} disabled={isGeneratingKey} variant="outline" size="sm" className="w-full border-blue-400/50 text-blue-300 hover:bg-blue-400/20 hover:text-white">
                  {isGeneratingKey ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2"/>}
                  Gerar Chave de Transferência
                </Button>
              )}
            </div>
        </div>

      </div>
    </div>
  );
};

export default BalanceCard;
