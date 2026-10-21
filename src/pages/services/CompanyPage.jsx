import {businessTypeIcon} from '@/lib/commerceIcons';
import PublicCompanyOpportunities from '@/components/business/PublicCompanyOpportunities';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, FileText, Loader2, User, MapPin, Users, Coins, Calendar, Activity, Palette, Settings, ShoppingBag } from 'lucide-react';
import { usePublicCompanyChanges } from '@/hooks/use-public-company-changes';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import CompanyManagement from '@/components/business/CompanyManagement';
import CompanyBrandForm from '@/components/business/CompanyBrandForm';
import { brandBackground } from '@/components/business/BrandPalettePicker';
import BrazilStateFlag from '@/components/onboarding/BrazilStateFlag';
import { getStateName } from '@/lib/brazilianLocations';
import { COMPANY_STATUS, SIZE_NAMES, companyMoney } from '@/lib/companyEconomy';
import { GovSelect } from '@/components/ui/gov-select';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { brandFont } from '@/lib/brandFonts';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
export default function CompanyPage() {
  const {id}=useParams(),{user}=useAuth(),{toast}=useToast();
  const [params,setParams]=useSearchParams();const navigate=useNavigate();
  const [company,setCompany]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [documents,setDocuments]=useState([]),[selectedDoc,setSelectedDoc]=useState(''),[linking,setLinking]=useState(false);
  const request=useRef(0);
  const load=useCallback(async()=>{const sequence=++request.current;const r=await supabase.rpc('get_company_page',{p_business_id:id});if(sequence!==request.current)return;setLoading(false);if(r.error){console.error(r.error);setError('Não foi possível carregar a empresa.');return;}setCompany(r.data);setError('');},[id]);
  useEffect(()=>{setLoading(true);setSelectedDoc('');void load();return()=>{request.current++;};},[load,user?.admin_development?.mode]);
  useDomainRealtime('company-page',id,['businesses','documents','products','business_employees','business_role_templates','business_inventory','business_vacancies','business_applications',{broadcast:'company-market-changed',topic:'company-market'}],load);
  useEffect(()=>{if(company?.owner_id!==user?.id){setDocuments([]);return;}supabase.from('documents').select('id,document_number,metadata').eq('user_id',user.id).eq('type','CNPJ').eq('is_valid',true).then(r=>{if(!r.error)setDocuments((r.data||[]).filter(d=>!d.metadata?.business_id));});},[company?.owner_id,company?.cnpjs?.length,user?.id]);
  const linkDoc=async()=>{setLinking(true);const r=await supabase.rpc('link_company_cnpj',{p_business_id:id,p_document_id:selectedDoc});setLinking(false);if(r.error)toast({title:'Não foi possível vincular',description:r.error.message,variant:'destructive'});else{setSelectedDoc('');await load();toast({title:'CNPJ vinculado à empresa'});}};
  usePublicCompanyChanges(events=>{if(events.some(e=>e.eventType==='SYNC'||e.new?.id===id))void load();});
  usePublicProfileChanges(events=>{if(events.some(e=>e.eventType==='SYNC'||e.new?.id===company?.owner_id))void load();});
  if(loading)return <Loader2 className="m-10 animate-spin"/>;
  if(error||!company)return <p className="p-8" role="status">{error||'Empresa não encontrada.'}</p>;
  const requested=params.get('view');
  const tab=requested==='management'&&company.can_manage?'management':requested==='brand'?'brand':'public';
  return <main className="mx-auto max-w-5xl space-y-6 px-3 py-8 sm:px-6">
    <Button variant="outline" onClick={()=>window.history.state?.idx>0?navigate(-1):navigate('/services/entrepreneur-portal?tab=country')}><ArrowLeft className="mr-2 h-4 w-4"/>Voltar</Button>
    <header className="rounded-2xl border-t-4 bg-card p-6 text-center" style={{borderColor:company.brand_color}}>{company.logo_url?<img src={company.logo_url} alt="Logo da empresa" className="mx-auto mb-4 h-24 w-24 rounded-xl object-contain"/>:React.createElement(businessTypeIcon({id:company.business_type_id,name:company.activity,category:company.sector}),{className:'mx-auto mb-4 h-16 w-16'})}<div aria-hidden="true" className="mb-4 h-3 rounded-full" style={{background:brandBackground(company.brand_color,company.brand_palette)}}/><h1 className="break-words text-3xl font-bold" style={{fontFamily:brandFont(company.font_key)}}>{company.name}</h1><p>{company.activity} · {({active:'Ativa',closed:'Encerrada',suspended:'Suspensa'})[company.status]||company.status}</p><p className="mt-3 whitespace-pre-wrap break-words">{company.description}</p></header>
    <Tabs value={tab} onValueChange={value=>setParams(current=>{const next=new URLSearchParams(current);next.set('view',value);return next;},{replace:true})}>
      <TabsList className="flex h-auto flex-wrap justify-center gap-1"><TabsTrigger value="public"><Building2 className="mr-2 h-4 w-4"/>Dados Empresariais</TabsTrigger><TabsTrigger value="brand"><Palette className="mr-2 h-4 w-4"/>Personalização</TabsTrigger>{company.can_manage&&<TabsTrigger value="management"><Settings className="mr-2 h-4 w-4"/>Gestão</TabsTrigger>}</TabsList>
      <TabsContent value="public" className="space-y-6 pt-3">
        <section className="space-y-3 rounded-xl border p-5"><h2 className="font-semibold">Dados públicos</h2><div className="flex items-center gap-3">{company.owner?.avatar_url?<img src={company.owner.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover"/>:<User className="h-10 w-10 rounded-full bg-secondary p-2"/>}<p>Proprietário: {company.owner?.full_name||'Capital da população'}</p></div>
          <p className="flex flex-wrap items-center gap-2"><MapPin className="h-4 w-4 shrink-0"/>Sede: {company.region_code?<><BrazilStateFlag code={company.region_code} className="h-5 w-7"/><span>{getStateName(company.region_code)||company.region_code}</span></>:'Estado ainda não informado'}</p>
          <p className="flex flex-wrap items-center gap-2"><Building2 className="h-4 w-4"/>Porte: {SIZE_NAMES[company.size_class]}</p><p className="flex items-center gap-2"><Users className="h-4 w-4"/>{company.employees} trabalhadores</p>
          <p className="flex items-center gap-2"><Coins className="h-4 w-4"/>Valor: {companyMoney(company.market_value)}</p><p className="flex items-center gap-2"><Activity className="h-4 w-4"/>{COMPANY_STATUS[company.operational_status]}</p><p className="flex items-center gap-2"><Calendar className="h-4 w-4"/>Fundação: {new Date(company.created_at).toLocaleDateString('pt-BR')}</p>
        </section>
        <section className="space-y-3"><h2 className="flex gap-2 text-xl font-semibold"><FileText/>CNPJs e atividades</h2>{company.cnpjs.map(d=><article key={d.id} className="rounded-xl border p-4"><p className="font-semibold">{d.number}</p><p>{d.activity||'Atividade histórica não informada'} · {d.is_valid?'Ativo':'Encerrado'}</p><p className="text-sm">Abertura: {new Date(d.issued_at).toLocaleDateString('pt-BR')}</p></article>)}{company.regularization_required&&<p className="text-sm text-amber-400">Empresa anterior ao cadastro por atividade. Acesso preservado; regularização do CNPJ pendente.</p>}</section>
        {company.products?.length>0&&<section className="space-y-3"><h2 className="flex gap-2 text-xl font-semibold"><ShoppingBag/>Produtos e serviços</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{company.products.map(p=><Link key={p.id} to={`/services/business/product/${p.id}`} className="space-y-2 rounded-xl border p-3 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring">{p.image_url&&<img src={p.image_url} alt="" className="h-28 w-full rounded object-cover"/>}<p className="break-words font-semibold">{p.name}</p><p>{companyMoney(p.price)}</p></Link>)}</div></section>}
        <PublicCompanyOpportunities company={company} onChanged={load}/>
      </TabsContent>
      <TabsContent value="brand" className="space-y-4 pt-3">
        {user?.id===company.owner_id?<CompanyBrandForm company={company} onSaved={load}/>:<section className="space-y-3 rounded-xl border p-5"><h2 className="font-semibold">Identidade visual</h2><p className="text-sm text-muted-foreground">Marca e aparência definidas pelo proprietário da empresa.</p>{company.logo_url&&<img src={company.logo_url} alt={`Marca de ${company.name}`} className="h-24 w-24 object-contain"/>}<p className="break-words text-2xl" style={{fontFamily:brandFont(company.font_key)}}>{company.name}</p><div role="img" aria-label="Paleta de cores da empresa" className="h-16 rounded-xl" style={{background:brandBackground(company.brand_color,company.brand_palette)}}/></section>}
      </TabsContent>
      {company.can_manage&&<TabsContent value="management" className="space-y-5 pt-3">
        {user?.id===company.owner_id&&<section className="space-y-3 rounded-xl border p-4"><h2 className="font-semibold">Vincular CNPJ</h2><label className="block text-sm">CNPJ disponível<GovSelect aria-label="CNPJ disponível" className="mt-1 h-11 w-full rounded border bg-background p-2" value={selectedDoc} onChange={e=>setSelectedDoc(e.target.value)}><option value="">Selecione um CNPJ</option>{documents.map(d=><option key={d.id} value={d.id}>{d.document_number} · {d.metadata?.activity_name||d.metadata?.business_type_id||'Atividade histórica'}</option>)}</GovSelect></label><p className="text-xs text-muted-foreground">O primeiro CNPJ deve corresponder à atividade principal. Outros CNPJs podem identificar atividades adicionais.</p><Button disabled={linking||!selectedDoc} onClick={linkDoc}>{linking?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<FileText className="mr-2 h-4 w-4"/>}Vincular à empresa</Button><Button asChild variant="link"><Link to="/services/dic">Emitir CNPJ no DIC</Link></Button></section>}
        <CompanyManagement key={company.id} companyId={company.id} onChanged={load}/>
      </TabsContent>}
    </Tabs>
  </main>;
}
