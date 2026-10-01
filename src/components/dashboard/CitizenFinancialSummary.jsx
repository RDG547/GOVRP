import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, PiggyBank, Wallet, Landmark } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
export default function CitizenFinancialSummary() {
  const { user } = useAuth(); const [data,setData] = useState(null), [error,setError]=useState('');
  const load=useCallback(async()=>{const [account,investments]=await Promise.all([supabase.rpc('get_my_bank_account'),supabase.rpc('get_my_investment_totals')]);if(account.error||investments.error)setError('Não foi possível consultar seu financeiro.');else {setData({balance:Number((Array.isArray(account.data)?account.data[0]:account.data)?.balance||0),investments:Number(investments.data?.market_value||0)});setError('');}},[user.id]);
  useEffect(()=>{void load();},[load]);
  useDomainRealtime('citizen-financial',user.id,[{table:'accounts',filter:`user_id=eq.${user.id}`},{table:'user_investments',filter:`user_id=eq.${user.id}`},'investment_options'],load);
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Meu Financeiro</h2>{error&&<p role="alert">{error}</p>}<div className="grid gap-4 sm:grid-cols-3">{[['Saldo em conta',data?.balance,Banknote],['Investimentos · valor atual',data?.investments,PiggyBank],['Patrimônio financeiro',data?data.balance+data.investments:null,Wallet]].map(([title,value,Icon])=><Card key={title}><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Icon className="h-5 w-5 text-emerald-400"/>{title}</CardTitle></CardHeader><CardContent className="font-semibold break-words text-xl">{value==null?'…':formatCurrency(value)}</CardContent></Card>)}</div><Button asChild><Link to="/services/bank"><Landmark className="mr-2 h-4 w-4"/>Abrir Banco e extrato</Link></Button></section>;
}
