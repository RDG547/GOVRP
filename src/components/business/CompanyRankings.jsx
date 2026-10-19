import SignedProfit from './SignedProfit';
import { usePublicCompanyChanges } from '@/hooks/use-public-company-changes';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Building2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useAuth } from '@/contexts/AuthContext';
import { getStateName } from '@/lib/brazilianLocations';
import BrazilStateFlag from '@/components/onboarding/BrazilStateFlag';
import { companyMoney } from '@/lib/companyEconomy';
import { Button } from '@/components/ui/button';
import { GovSelect } from '@/components/ui/gov-select';
const sorts=[['market_value','Mais Valiosas'],['revenue','Maior Receita'],['profit','Maior Lucro'],['jobs','Maiores Empregadoras'],['production','Maior Produção']];
export default function CompanyRankings(){
 const {user}=useAuth();const [rows,setRows]=useState([]),[sort,setSort]=useState('market_value'),[error,setError]=useState('');
 const load=useCallback(async()=>{if(!user)return;const result=await supabase.rpc('get_company_rankings');if(result.error){setError('Não foi possível atualizar o ranking.');return;}setRows(result.data||[]);setError('');},[user]);
 useEffect(()=>{void load();},[load]);
 useDomainRealtime('company-rankings','BR',['investment_options','business_daily_operations','business_balance_cycles',{broadcast:'company-market-changed',topic:'company-market'}],load,Boolean(user));
 usePublicCompanyChanges(load,Boolean(user));
 const sorted=[...rows].sort((a,b)=>Number(b[sort])-Number(a[sort])||a.id.localeCompare(b.id));
 return <section id="maiores-empresas" className="space-y-4 rounded-2xl border p-4 sm:p-6"><header className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-2xl font-bold"><Trophy className="h-6 w-6 text-amber-400"/>Maiores Empresas</h2><label className="text-sm">Ranking de Empresas<GovSelect aria-label="Ordenar ranking de empresas" value={sort} onChange={event=>setSort(event.target.value)}>{sorts.map(([value,label])=><option key={value} value={value}>{label}</option>)}</GovSelect></label></header><p className="text-sm text-muted-foreground">Empresas listadas usam a cotação × ações emitidas. As demais usam a avaliação registrada pelo motor econômico. Receita, lucro e produção consideram os últimos sete dias reais.</p>{!user?<p>Entre na sua conta para consultar as empresas do RP.</p>:error?<p role="alert">{error}<Button variant="ghost" onClick={load}>Tentar novamente</Button></p>:!rows.length?<p>Nenhuma empresa ativa disponível.</p>:<ol tabIndex={0} aria-label="Ranking nacional de empresas" className="grid max-h-[560px] auto-rows-[100px] gap-3 overflow-y-auto overscroll-contain pr-2">{sorted.map((company,index)=><li key={company.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border p-3"><span className="w-8 shrink-0 text-center font-bold text-amber-400">{index+1}º</span>{company.logo_url?<img src={company.logo_url} alt="" className="h-10 w-10 rounded-lg object-contain"/>:<Building2 className="h-10 w-10 shrink-0 text-muted-foreground"/>}<div className="min-w-0 flex-1"><Link to={`/services/companies/${company.id}`} className="break-words font-semibold underline-offset-2 hover:underline">{company.name}</Link><p className="text-xs text-muted-foreground">{company.sector} · {company.jobs} trabalhadores</p><p className="mt-1 flex items-center gap-2 text-xs">{company.region_code&&<BrazilStateFlag code={company.region_code} className="h-4 w-6"/>}{getStateName(company.region_code)||'Sede não informada'}</p></div><div className="min-w-0 text-right"><p className="text-xs text-muted-foreground">{sorts.find(([key])=>key===sort)?.[1]}</p><strong className="break-words">{sort==='profit'?<SignedProfit value={company[sort]}/>:['jobs','production'].includes(sort)?Number(company[sort]).toLocaleString('pt-BR',{maximumFractionDigits:2}):companyMoney(company[sort])}</strong><p className={`text-xs ${Number(company.variation)>=0?'text-emerald-500':'text-rose-500'}`}>{company.variation===null||company.variation===undefined?'Sem cotação pública':`${Number(company.variation)>0?'+':''}${Number(company.variation).toFixed(2)}% no dia`}</p></div></li>)}</ol>}</section>;
}
