import React, {useCallback,useEffect,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {Building2,Loader2,Search} from 'lucide-react';
import {supabase} from '@/lib/supabaseClient';
import {useDomainRealtime} from '@/hooks/use-domain-realtime';
import {usePublicCompanyChanges} from '@/hooks/use-public-company-changes';
import {usePublicProfileChanges} from '@/hooks/use-public-profile-changes';
import {BRAZIL_STATES,getStateName} from '@/lib/brazilianLocations';
import {SIZE_NAMES,COMPANY_STATUS,companyMoney} from '@/lib/companyEconomy';
import BrazilStateFlag from '@/components/onboarding/BrazilStateFlag';
import {Input} from '@/components/ui/input';
import {GovSelect} from '@/components/ui/gov-select';
import {Button} from '@/components/ui/button';

export default function CountryCompanies({types=[]}) {
 const [params,setParams]=useSearchParams(),[result,setResult]=useState({companies:[],total:0}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const sequence=useRef(0),query=params.toString(),offset=Math.min(2777,Math.max(0,Math.floor(Number(params.get('companyPage'))||0)))*36;
 const change=(key,value)=>setParams(current=>{const next=new URLSearchParams(current);next.set(key,value);if(key!=='companyPage')next.delete('companyPage');return next;},{replace:true});
 const load=useCallback(async()=>{
  const serial=++sequence.current,p=new URLSearchParams(query);setBusy(true);
  const r=await supabase.rpc('get_country_companies',{p_search:p.get('companySearch')||'',p_type:p.get('companyType')||'',p_state:p.get('companyState')||'',p_size:p.get('companySize')||'',p_product:p.get('companyProduct')||'',p_status:p.get('companyStatus')??'active',p_offset:offset});
  if(serial!==sequence.current)return;setBusy(false);
  if(r.error){console.error(r.error);setError('Não foi possível consultar as empresas.');return;}
  setResult(r.data);setError('');
 },[query,offset]);
 useEffect(()=>{const timer=setTimeout(load,180);return()=>{clearTimeout(timer);sequence.current++;};},[load]);
 usePublicCompanyChanges(load);usePublicProfileChanges(load);
 useDomainRealtime('country-companies','public',['products','business_inventory',{broadcast:'company-market-changed',topic:'company-market'}],load);
 return <section className="space-y-5" aria-label="Empresas do País">
  <h2 className="flex items-center gap-2 text-2xl font-semibold"><Building2/>Empresas do País</h2>
  <p className="text-muted-foreground">Conheça as empresas, seus produtos e fornecedores de insumos.</p>
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
   <Input aria-label="Buscar empresa" placeholder="Nome da empresa" value={params.get('companySearch')||''} onChange={e=>change('companySearch',e.target.value)}/>
   <Input aria-label="Buscar produto ou insumo" placeholder="Produto ou insumo" value={params.get('companyProduct')||''} onChange={e=>change('companyProduct',e.target.value)}/>
   <GovSelect aria-label="Tipo de empresa" value={params.get('companyType')||''} onChange={e=>change('companyType',e.target.value)}><option value="">Todos os tipos</option>{types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</GovSelect>
   <GovSelect aria-label="Estado da sede" value={params.get('companyState')||''} onChange={e=>change('companyState',e.target.value)}><option value="">Todos os estados</option>{BRAZIL_STATES.map(s=><option key={s.code} value={s.code}>{s.name}</option>)}</GovSelect>
   <GovSelect aria-label="Porte da empresa" value={params.get('companySize')||''} onChange={e=>change('companySize',e.target.value)}><option value="">Todos os portes</option>{Object.entries(SIZE_NAMES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</GovSelect>
   <GovSelect aria-label="Situação da empresa" value={params.get('companyStatus')??'active'} onChange={e=>change('companyStatus',e.target.value)}><option value="active">Ativas</option><option value="suspended">Suspensas</option><option value="closed">Encerradas</option><option value="">Todas as situações</option></GovSelect>
  </div>
  <p role="status" className="flex items-center gap-2 text-sm">{busy&&<Loader2 className="h-4 w-4 animate-spin"/>}{result.total} empresas encontradas</p>
  {error&&<p role="alert">{error}<Button onClick={load} variant="link">Tentar novamente</Button></p>}
  {!busy&&!error&&!result.companies.length&&<p className="flex items-center gap-2 py-10 text-muted-foreground"><Search/>Nenhuma empresa corresponde aos filtros.</p>}
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{result.companies.map(b=><Link key={b.id} to={`/services/companies/${b.id}`} className="min-w-0 space-y-3 rounded-xl border p-4 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring">
   <div className="flex items-center gap-3">{b.logo_url?<img src={b.logo_url} alt="" className="h-12 w-12 shrink-0 rounded object-contain"/>:<Building2 className="h-12 w-12 shrink-0 p-2 text-cyan-400"/>}<h3 className="break-words text-lg font-semibold">{b.name}</h3></div>
   <p className="text-sm">{b.activity} · {SIZE_NAMES[b.size_class]}</p><p className="break-words text-sm">Proprietário: {b.owner_name}</p>
   <p className="flex flex-wrap items-center gap-2 text-sm">Sede: {b.region_code&&<BrazilStateFlag code={b.region_code} className="h-5 w-7"/>}{getStateName(b.region_code)||'Não informada'}</p>
   <p>Valor: {companyMoney(b.market_value)}</p><p className="text-sm">{COMPANY_STATUS[b.operational_status]||({active:'Ativa',suspended:'Suspensa',closed:'Encerrada'})[b.status]}</p>
   <p className="text-sm text-muted-foreground">{b.products.length?b.products.slice(0,6).join(' · '):'Sem ofertas disponíveis no momento.'}</p>
  </Link>)}</div>
  <div className="flex items-center justify-center gap-3"><Button variant="outline" disabled={busy||offset===0} onClick={()=>change('companyPage',String(offset/36-1))}>Anterior</Button><span className="text-sm">Página {offset/36+1}</span><Button variant="outline" disabled={busy||offset+36>=result.total} onClick={()=>change('companyPage',String(offset/36+1))}>Próxima</Button></div>
 </section>;
}
