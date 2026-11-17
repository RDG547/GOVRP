import {businessTypeIcon} from '@/lib/commerceIcons';
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

 return (
  <section id="maiores-empresas" className="min-w-0 space-y-4 rounded-2xl border p-3 sm:p-6">
   <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <h2 className="flex min-w-0 items-center gap-2 text-xl font-bold sm:text-2xl"><Trophy className="h-6 w-6 shrink-0 text-amber-400"/>Maiores Empresas</h2>
    <label className="block min-w-0 text-sm">Ranking de Empresas
     <GovSelect aria-label="Ordenar ranking de empresas" value={sort} onChange={event=>setSort(event.target.value)}>
      {sorts.map(([value,label])=><option key={value} value={value}>{label}</option>)}
     </GovSelect>
    </label>
   </header>
   <p className="text-sm text-muted-foreground">Empresas listadas usam a cotação × ações emitidas. As demais usam a avaliação registrada pelo motor econômico. Receita, lucro e produção consideram os últimos sete dias reais.</p>
   {!user?<p>Entre na sua conta para consultar as empresas do RP.</p>:error?<p role="alert">{error}<Button variant="ghost" onClick={load}>Tentar novamente</Button></p>:!rows.length?<p>Nenhuma empresa ativa disponível.</p>:
    <ol tabIndex={0} aria-label="Ranking nacional de empresas" className="grid max-h-[560px] min-w-0 auto-rows-auto gap-3 overflow-y-auto overscroll-contain pr-1 sm:pr-2">
     {sorted.map((company,index)=><li key={company.id} className="min-w-0 rounded-xl border p-3 sm:p-4">
       <div className="flex min-w-0 items-start gap-3">
        <span className="w-8 shrink-0 pt-1 text-center font-bold text-amber-400">{index+1}º</span>
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg">
         {company.logo_url?<img src={company.logo_url} alt="" className="h-full w-full object-contain"/>:React.createElement(businessTypeIcon({id:company.business_type_id||company.type,name:company.activity,category:company.sector}),{className:'h-full w-full text-muted-foreground'})}
        </div>
        <div className="min-w-0 flex-1">
         <Link to={`/services/companies/${company.id}`} className="block break-words font-semibold leading-snug [overflow-wrap:anywhere] underline-offset-2 hover:underline">{company.name}</Link>
         <p className="mt-1 break-words text-xs text-muted-foreground">{company.sector} · {company.jobs} trabalhadores</p>
         <p className="mt-1 flex flex-wrap items-center gap-2 break-words text-xs">
          {company.region_code&&<BrazilStateFlag code={company.region_code} className="h-4 w-6 shrink-0"/>}{getStateName(company.region_code)||'Sede não informada'}
         </p>
        </div>
       </div>
       <div className="mt-3 flex min-w-0 flex-wrap items-end justify-between gap-2 border-t border-border/60 pt-3">
        <span className="text-xs text-muted-foreground">{sorts.find(([key])=>key===sort)?.[1]}</span>
        <div className="min-w-0 text-right">
         <strong className="block break-words text-base tabular-nums [overflow-wrap:anywhere]">{sort==='profit'?<SignedProfit value={company[sort]}/>:['jobs','production'].includes(sort)?Number(company[sort]).toLocaleString('pt-BR',{maximumFractionDigits:2}):companyMoney(company[sort])}</strong>
         <p className={`break-words text-xs ${Number(company.variation)>=0?'text-emerald-500':'text-rose-500'}`}>{company.variation===null||company.variation===undefined?'Sem cotação pública':`${Number(company.variation)>0?'+':''}${Number(company.variation).toFixed(2)}% no dia`}</p>
        </div>
       </div>
      </li>)}
    </ol>}
  </section>
 );
}
