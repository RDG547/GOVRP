import ProfessionalActivities from '@/components/business/ProfessionalActivities';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, GraduationCap, MapPin, Loader2, Search, Send, X, Check, LogOut, Building2, Cpu, Utensils, Truck, BadgeCheck, ShoppingBag, Package, HeartPulse, Coins, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { SKILL_NAMES, companyMoney as money } from '@/lib/companyEconomy';
import { userErrorMessage } from '@/lib/userErrors';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/layout/PageHeader';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

const skills = {
 management: [Users, 'text-purple-400', 'accent-purple-500'], technology: [Cpu, 'text-cyan-400', 'accent-cyan-500'],
 food: [Utensils, 'text-orange-400', 'accent-orange-500'], transport: [Truck, 'text-blue-400', 'accent-blue-500'],
 quality: [BadgeCheck, 'text-teal-400', 'accent-teal-500'], sales: [ShoppingBag, 'text-pink-400', 'accent-pink-500'],
 logistics: [Package, 'text-indigo-400', 'accent-indigo-500'], health: [HeartPulse, 'text-rose-400', 'accent-rose-500'],
 finance: [Coins, 'text-amber-400', 'accent-amber-500'],
};
const tabs = [['work','Meu Emprego',Briefcase],['experience','Minha Experiência',GraduationCap],['jobs','Encontrar uma Vaga',Search]];
const statusNames = {pending:'Aguardando análise',accepted:'Contratado',rejected:'Não selecionado',withdrawn:'Retirada'};
export default function MyWork() {
 const {user}=useAuth(),{toast}=useToast();
 const [work,setWork]=useState(null),[jobs,setJobs]=useState([]),[tab,setTab]=useState('work'),[search,setSearch]=useState('');
 const [selected,setSelected]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef(0);
 const load=useCallback(async()=>{
   const sequence=++request.current;
   const [mine,available]=await Promise.all([supabase.rpc('get_my_work'),supabase.rpc('get_company_jobs')]);
   if(sequence!==request.current)return;
   if(mine.error||available.error){console.error('Mercado de trabalho',mine.error||available.error);setError('Não foi possível atualizar o mercado de trabalho.');return;}
   setWork(mine.data);setJobs(available.data||[]);setError('');
 },[]);
 useEffect(()=>{void load();return()=>{request.current++;};},[load]);
 useDomainRealtime('my-work',user.id,['business_employees','business_vacancies','business_applications','citizen_professional_experience',{broadcast:'public-company-changed',topic:'company-public-identity'}],load);
 const active=work?.employments.find(item=>!item.fired_at);
 const submit=async()=>{
   if(busy||!selected)return;setBusy(true);
   try{
     const result=selected.kind==='quit'
       ? await supabase.rpc('manage_company_workforce',{p_business_id:selected.business_id,p_action:'quit',p_data:{employee_id:selected.id},p_idempotency_key:selected.key})
       : selected.kind==='withdraw' ? await supabase.rpc('withdraw_company_application',{p_application_id:selected.id})
       : await supabase.rpc('apply_company_vacancy',{p_vacancy_id:selected.id,p_message:message});
     if(result.error)throw result.error;
     const title=selected.kind==='quit'?'Vínculo encerrado':selected.kind==='withdraw'?'Candidatura retirada':'Candidatura enviada';
     setSelected(null);setMessage('');await load();toast({title});
   }catch(failure){console.error('Ação profissional',failure);toast({title:'Não foi possível concluir',description:userErrorMessage(failure),variant:'destructive'});}
   finally{setBusy(false);}
 };
 const visible=jobs.filter(job=>`${job.role} ${job.company_name} ${job.region_code}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
 return <main className="mx-auto max-w-5xl space-y-6 px-3 py-8 sm:px-6">
   <PageHeader centered icon={Briefcase} iconColor="text-amber-400" title="Portal do Trabalhador" description="Construa sua carreira, acompanhe remuneração e experiência ou encontre uma vaga."/>
   <nav aria-label="Área profissional" className="flex flex-wrap justify-center gap-2">{tabs.map(([value,label,Icon])=><Button key={value} variant={tab===value?'default':'outline'} aria-pressed={tab===value} onClick={()=>setTab(value)}><Icon className="mr-2 h-4 w-4"/>{label}</Button>)}</nav>
   {error&&<p role="alert">{error}<Button onClick={load} variant="ghost">Tentar novamente</Button></p>}
   {!work&&!error&&<p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin"/>Consultando sua carreira…</p>}
   {tab==='work'&&work&&<div className="space-y-4">
     {active?<article className="space-y-3 rounded-2xl border p-5"><h2 className="text-xl font-semibold">{active.role}</h2><Link className="underline" to={`/services/companies/${active.business_id}`}>{active.company_name}</Link><p>{money(active.salary)} por 7 dias reais · Nível {active.qualification_level}</p><p className="text-sm">Valores trabalhados e ainda devidos: {money(active.wage_due)}</p><p className="text-sm text-muted-foreground">O empregador paga pelo caixa da empresa. Um atraso fica registrado até a regularização.</p><Button variant="outline" onClick={()=>setSelected({...active,kind:'quit',key:crypto.randomUUID()})}><LogOut className="mr-2 h-4 w-4"/>Pedir demissão</Button></article>:<div className="space-y-3 rounded-2xl border p-5"><p>Você não possui um vínculo empresarial ativo.</p><Button onClick={()=>setTab('jobs')}><Search className="mr-2 h-4 w-4"/>Encontrar uma vaga</Button></div>}
     {active&&<ProfessionalActivities companyId={active.business_id} onCompleted={load}/>}
     <h2 className="font-semibold">Minhas candidaturas</h2>
     {!work.applications.length&&<p className="text-sm text-muted-foreground">Você ainda não se candidatou a uma vaga.</p>}
     {work.applications.map(application=><article key={application.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><p>{application.role} · {application.company_name}</p><p className="text-sm text-muted-foreground">{statusNames[application.status]||'Em análise'}</p></div>{application.status==='pending'&&<Button variant="outline" onClick={()=>setSelected({...application,kind:'withdraw'})}><X className="mr-2 h-4 w-4"/>Retirar candidatura</Button>}</article>)}
     <h2 className="font-semibold">Histórico profissional</h2>
     {work.employments.filter(item=>item.fired_at).map(item=><article key={item.id} className="rounded-xl border p-4"><p>{item.role} · {item.company_name}</p><p className="text-sm text-muted-foreground">{new Date(item.hired_at).toLocaleDateString('pt-BR')} a {new Date(item.fired_at).toLocaleDateString('pt-BR')}</p>{Number(item.wage_due)>0&&<p className="text-sm">Pagamento pendente: {money(item.wage_due)}</p>}</article>)}
   </div>}
   {tab==='jobs'&&<div className="space-y-4">
     <Input aria-label="Buscar vaga" placeholder="Função, empresa ou estado" value={search} onChange={event=>setSearch(event.target.value)}/>
     {active&&<p className="text-sm">Cada cidadão pode ter um emprego empresarial principal. A propriedade de empresas pode ser mantida enquanto você trabalha.</p>}
     <div className="grid gap-4 sm:grid-cols-2">{visible.map(job=><article key={job.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border p-4">
       <div className="flex items-center gap-3">{job.logo_url?<img src={job.logo_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-contain"/>:<Building2 aria-hidden="true" className="h-12 w-12 shrink-0 rounded-xl bg-secondary p-2 text-amber-400"/>}<div className="min-w-0"><h2 className="break-words font-semibold">{job.role}</h2><Link className="break-words text-sm underline" to={`/services/companies/${job.business_id}`}>{job.company_name}</Link></div></div>
       <p className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4"/>{job.region_code||'Sede não informada'}</p><p>{money(job.salary)} / semana</p><p className="text-sm">{SKILL_NAMES[job.skill_area]} · Nível mínimo {job.min_level} · {job.positions} vagas</p><p className="flex-1 break-words text-sm text-muted-foreground">{job.description}</p>
       <Button disabled={Boolean(active)||job.applied} onClick={()=>{setMessage('');setSelected({...job,kind:'apply'});}}><Send className="mr-2 h-4 w-4"/>{job.applied?'Candidatura registrada':'Candidatar-me'}</Button>
     </article>)}</div>{!visible.length&&<p>{search?'Nenhuma vaga corresponde à busca.':'Nenhuma vaga aberta no momento.'}</p>}
   </div>}
   {tab==='experience'&&<section className="space-y-4"><h2 className="flex items-center gap-2 font-semibold"><GraduationCap className="h-5 w-5"/>Experiência por área</h2><p className="text-sm text-muted-foreground">Atividades profissionais validadas aumentam a experiência. A evolução melhora a produtividade de forma limitada e não substitui a equipe mínima.</p><div className="grid gap-3 sm:grid-cols-2">{Object.entries(SKILL_NAMES).map(([key,label])=>{const skill=work?.experience.find(item=>item.skill_area===key);const [Icon,color,accent]=skills[key];return <article key={key} className="rounded-xl border p-4"><h3 className={`flex items-center gap-2 font-semibold ${color}`}><Icon className="h-5 w-5"/>{label}</h3><p>Nível {skill?.level||1} · {skill?.experience||0} XP</p><progress aria-label={`Experiência em ${label}`} max="100" value={(skill?.experience||0)%100} className={`experience-progress mt-2 h-2.5 w-full overflow-hidden rounded-full ${accent}`}/></article>;})}</div></section>}
   <Dialog open={Boolean(selected)} onOpenChange={open=>{if(!open&&!busy)setSelected(null);}}><DialogContent>
     <DialogHeader className="items-center text-center sm:text-center"><DialogTitle>{selected?.kind==='quit'?'Confirmar pedido de demissão':selected?.kind==='withdraw'?'Retirar candidatura':'Candidatar-se à vaga'}</DialogTitle><DialogDescription>{selected?.kind==='quit'?'Seu vínculo será encerrado. O histórico profissional e os valores já trabalhados serão preservados.':selected?.kind==='withdraw'?`Retirar sua candidatura para ${selected.role} em ${selected.company_name}? Você poderá se candidatar novamente se a vaga continuar aberta.`:`${selected?.role||''} · ${selected?.company_name||''}`}</DialogDescription></DialogHeader>
     {selected?.kind==='apply'&&<label className="text-sm">Mensagem para a empresa<Input value={message} maxLength={2000} onChange={event=>setMessage(event.target.value)}/></label>}
     <DialogFooter className="sm:justify-center"><Button variant="outline" disabled={busy} onClick={()=>setSelected(null)}><X className="mr-2 h-4 w-4"/>Cancelar</Button><Button disabled={busy} onClick={submit}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Check className="mr-2 h-4 w-4"/>}Confirmar</Button></DialogFooter>
   </DialogContent></Dialog>
 </main>;
}
