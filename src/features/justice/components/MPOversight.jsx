import React,{useCallback,useEffect,useState} from 'react';
import {useAuth} from '@/contexts/AuthContext';
import {supabase} from '@/lib/supabaseClient';
import {Button} from '@/components/ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {useToast} from '@/components/ui/use-toast';
import {formatDateTimeBR} from '@/lib/dateTime';
import {ShieldCheck,RefreshCw,FileText} from 'lucide-react';

const categories={corruption:'Suspeita de corrupção',abuse:'Abuso de poder',omission:'Omissão administrativa',public_funds:'Recursos públicos',legality:'Legalidade de atos administrativos',other:'Outra irregularidade'};
const statuses={submitted:'Aguardando análise',open:'Em fiscalização',rejected:'Não instaurada',closed:'Encerrada',referred_pic:'Encaminhada a PIC',referred_external:'Encaminhada a outro órgão',pending:'Aguardando resposta',answered:'Respondida',cancelled:'Cancelada'};
const kinds={requisition:'Requisição de informações',recommendation:'Recomendação administrativa',referral:'Encaminhamento a outro órgão'};
const actions={open:'Instaurar fiscalização',reject:'Não instaurar',note:'Registrar diligência ou informação',requisition:'Solicitar informações e documentos',recommendation:'Expedir recomendação',refer_pic:'Instaurar PIC vinculado',refer_external:'Encaminhar a outro órgão',close:'Encerrar procedimento',reply:'Responder comunicação',representation:'Enviar representação',direct:'Instaurar de ofício'};
const externalRoles=['Diretor-Geral de Polícia','Juiz Federal','Presidente do STF','Presidente da Câmara dos Deputados','Presidente do Senado','Presidente do Senado Federal'];
const legalActions=['direct','open','requisition','recommendation','refer_pic','refer_external'];
const timedActions=['requisition','recommendation','refer_external'];
const date=v=>v?formatDateTimeBR(v):'—';
const deadlineLabel=m=>m.status==='pending'&&new Date(m.due_at).getTime()<=Date.now()?'Prazo vencido':statuses[m.status]||m.status;
const brInput=v=>v?new Date(v+':00-03:00').toISOString():null;
const call=async(name,params)=>{const r=await supabase.rpc(name,params);if(r.error)throw r.error;return r.data;};
const blank={officials:[],cases:[],representations:[],messages:[],managed_messages:[],events:[]};

export default function MPOversight({management=false,previewOnly=false,onChange}){
 const {user}=useAuth();
 const {toast}=useToast();
 const [data,setData]=useState(blank),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[form,setForm]=useState(null);
 const roleKey=user?.id+'|'+user?.role+'|'+user?.admin_development?.mode;
 const load=useCallback(async()=>{if(previewOnly){setData({...blank,can_manage:true,preview_only:true});setError('');setLoading(false);return;}setLoading(true);try{setData(await call('get_mp_oversight',{}));setError('');}catch(e){setData(blank);setError(e.message||'Não foi possível consultar a fiscalização.');}finally{setLoading(false);}},[roleKey,previewOnly]);
 useEffect(()=>{setData(blank);setForm(null);void load();},[load]);
 const open=(action,item=null)=>setForm({action,item,reason:'',title:'',category:'legality',target:'',legalBasis:'',days:'7',recipient:'',factsAt:''});
 const update=patch=>setForm(f=>({...f,...patch}));
 const officials=data.officials||[];
 const creating=form&&['representation','direct'].includes(form.action);
 const needsLegal=form&&legalActions.includes(form.action);
 const needsDays=form&&timedActions.includes(form.action);
 const allowed=form&&form.reason.trim().length>=40&&form.reason.trim().length<=20000&&(!creating||(form.target&&form.title.trim().length>=5&&form.title.trim().length<=200))&&(!needsLegal||(form.legalBasis.trim().length>=10&&form.legalBasis.trim().length<=2000))&&(!needsDays||(Number.isInteger(Number(form.days))&&Number(form.days)>=1&&Number(form.days)<=30))&&(form.action!=='refer_external'||form.recipient)&&(form.action!=='refer_pic'||(form.factsAt&&new Date(brInput(form.factsAt)).getTime()<=Date.now()));
 const submit=async()=>{if(previewOnly){toast({title:'Pré-visualização',description:'Nenhuma ação real foi executada.'});return;}if(!allowed||busy)return;setBusy(true);try{
  if(creating)await call('create_mp_oversight',{p_target:form.target,p_title:form.title,p_description:form.reason,p_category:form.category,p_direct:form.action==='direct',p_legal_basis:form.legalBasis||null});
  else if(form.action==='reply')await call('reply_mp_oversight',{p_id:form.item.id,p_response:form.reason});
  else await call('move_mp_oversight',{p_id:form.item.id,p_action:form.action,p_reason:form.reason,p_legal_basis:form.legalBasis||null,p_days:needsDays?Number(form.days):null,p_recipient:form.recipient||null,p_facts_at:form.action==='refer_pic'?brInput(form.factsAt):null});
  setForm(null);toast({title:'Movimentação registrada'});await load();onChange?.();
 }catch(e){toast({title:'Ação não concluída',description:e.message,variant:'destructive'});}finally{setBusy(false);}};
 const renderMessage=(m,managed=false)=><article key={m.id} className="space-y-2 rounded-lg border p-3 text-sm">
  <div className="flex flex-wrap justify-between gap-2"><strong>{kinds[m.kind]}{m.protocol?' · '+m.protocol:''}</strong><Badge variant="outline">{deadlineLabel(m)}</Badge></div>
  {managed&&<p>Destinatário: {officials.find(o=>o.id===m.recipient_id)?.full_name||'Autoridade vinculada'}</p>}
  <p className="whitespace-pre-wrap break-words">{m.body}</p><p className="text-muted-foreground whitespace-pre-wrap">Fundamento: {m.legal_basis}</p>
  <p>Prazo: {date(m.due_at)} (tempo real)</p>
  {m.response&&<div className="rounded border p-2"><strong>Resposta · {date(m.answered_at)}{new Date(m.answered_at)>new Date(m.due_at)?' · Fora do prazo':''}</strong><p className="whitespace-pre-wrap break-words">{m.response}</p></div>}
  {!managed&&m.status==='pending'&&<Button size="sm" onClick={()=>open('reply',m)}>Responder</Button>}
 </article>;
 return <section className="space-y-4">
  <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-xl"><ShieldCheck className="h-5 w-5"/>Fiscalização de autoridades públicas</CardTitle><CardDescription className="mt-2">{management?'Procedimentos administrativos e representações do Ministério Público.':'Apresente uma representação e acompanhe comunicações dirigidas a você.'}</CardDescription></div><Button size="sm" variant="outline" onClick={load} disabled={loading||busy}><RefreshCw className="mr-2 h-4 w-4"/>Atualizar</Button></div></CardHeader><CardContent className="space-y-3">
   <p className="text-sm text-muted-foreground">Suspeitas não constituem culpa. Recomendações não anulam atos nem aplicam sanções. Devem ser respeitadas as competências e prerrogativas previstas nas normas do GOV.RP.</p>
   {data.preview_only&&<p className="text-sm text-amber-400">Pré-visualização: dados sigilosos e ações reais não estão disponíveis neste modo.</p>}
   {loading?<p role="status">Consultando fiscalização…</p>:error?<p role="alert" className="text-sm text-destructive">{error}</p>:<div className="flex flex-wrap gap-2">{management?data.can_manage&&<Button onClick={()=>open('direct')}><FileText className="mr-2 h-4 w-4"/>Instaurar de ofício</Button>:<Button onClick={()=>open('representation')}><FileText className="mr-2 h-4 w-4"/>Nova representação ao MP</Button>}</div>}
  </CardContent></Card>
  {!loading&&!error&&management&&data.can_manage&&<>
   <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Aguardando análise','submitted'],['Em fiscalização','open'],['Encerradas','closed'],['Encaminhadas','referred']].map(([label,status])=><div key={status} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{data.cases.filter(c=>status==='referred'?c.status.startsWith('referred'):c.status===status).length}</p></div>)}</div>
   {data.cases.length?data.cases.map(c=><Card key={c.id}><CardHeader><div className="flex flex-wrap justify-between gap-2"><div><CardTitle className="text-lg">{c.protocol} · {c.title}</CardTitle><CardDescription>{c.target_name} · {c.target_role} · {categories[c.category]}</CardDescription></div><Badge variant="outline">{statuses[c.status]}</Badge></div></CardHeader><CardContent className="space-y-3 text-sm">
    <p className="whitespace-pre-wrap break-words">{c.description}</p><p>Recebida em {date(c.created_at)} · {c.reporter_id?'Representação identificada sob sigilo':'De ofício'}</p>{c.legal_basis&&<p className="whitespace-pre-wrap">Base legal: {c.legal_basis}</p>}
    {c.outcome&&<p className="rounded border p-2 whitespace-pre-wrap">Resultado administrativo: {c.outcome}</p>}
    {c.investigation_id&&<p className="text-muted-foreground">PIC vinculado. Consulte a aba Investigações do MP.</p>}
    <div className="flex flex-wrap gap-2">{(c.status==='submitted'?['open','reject']:c.status==='open'?['requisition','recommendation','note','refer_pic','refer_external','close']:[]).map(a=><Button key={a} size="sm" variant={a==='open'?'default':'outline'} onClick={()=>open(a,c)}>{actions[a]}</Button>)}</div>
    <details className="rounded border p-3"><summary className="cursor-pointer font-medium">Comunicações e respostas ({data.managed_messages.filter(m=>m.case_id===c.id).length})</summary><div className="mt-2 space-y-2">{data.managed_messages.filter(m=>m.case_id===c.id).map(m=>renderMessage(m,true))}</div></details>
    <details className="rounded border p-3"><summary className="cursor-pointer font-medium">Histórico de movimentações</summary><div className="mt-2 space-y-2">{data.events.filter(e=>e.case_id===c.id).map(e=><div key={e.id} className="border-l pl-2"><p className="text-xs text-muted-foreground">{date(e.created_at)} · {actions[e.action]||e.action}</p><p className="whitespace-pre-wrap break-words">{e.description}</p></div>)}</div></details>
   </CardContent></Card>):<p className="rounded-lg border p-4 text-sm text-muted-foreground">Nenhum procedimento disponível.</p>}
  </>}
  {!loading&&!error&&!management&&<>
   <Card><CardHeader><CardTitle className="text-lg">Minhas representações</CardTitle></CardHeader><CardContent className="space-y-3">{data.representations.length?data.representations.map(c=><article key={c.protocol} className="rounded border p-3 space-y-2 text-sm"><div className="flex justify-between gap-2"><strong>{c.protocol} · {c.title}</strong><Badge variant="outline">{statuses[c.status]}</Badge></div><p>{c.target_name} · {c.target_role}</p><p className="whitespace-pre-wrap break-words">{c.description}</p><p className="text-muted-foreground">{date(c.created_at)}</p></article>):<p className="text-sm text-muted-foreground">Nenhuma representação enviada.</p>}</CardContent></Card>
   <Card><CardHeader><CardTitle className="text-lg">Comunicações recebidas do MP</CardTitle><CardDescription>Responda às solicitações que lhe foram encaminhadas. Atrasos ficam registrados, sem punição automática.</CardDescription></CardHeader><CardContent className="space-y-3">{data.messages.length?data.messages.map(m=>renderMessage(m)):<p className="text-sm text-muted-foreground">Nenhuma comunicação recebida.</p>}</CardContent></Card>
  </>}
  <Dialog open={Boolean(form)} onOpenChange={v=>{if(!v&&!busy)setForm(null);}}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{form?actions[form.action]:''}</DialogTitle><DialogDescription>{form?.item?.protocol||'Procedimento administrativo do GOV.RP. Não informe dados pessoais do mundo real.'}</DialogDescription></DialogHeader>{form&&<div className="space-y-3">
   {creating&&<><Label htmlFor="oversight-target">Autoridade pública</Label><select id="oversight-target" className="w-full rounded-md border bg-background p-2 text-sm" value={form.target} onChange={e=>update({target:e.target.value})}><option value="">Selecione autoridade</option>{officials.map(o=><option key={o.id} value={o.id}>{o.full_name} — {o.role}</option>)}</select><Label htmlFor="oversight-category">Categoria</Label><select id="oversight-category" className="w-full rounded-md border bg-background p-2 text-sm" value={form.category} onChange={e=>update({category:e.target.value})}>{Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><Label htmlFor="oversight-title">Assunto</Label><Input id="oversight-title" maxLength={200} value={form.title} onChange={e=>update({title:e.target.value})}/></>}
   {needsLegal&&<><Label htmlFor="oversight-basis">Fundamento legal do RP</Label><Textarea id="oversight-basis" rows={2} maxLength={2000} value={form.legalBasis} onChange={e=>update({legalBasis:e.target.value})}/></>}
   {form.action==='refer_external'&&<><Label htmlFor="oversight-recipient">Destinatário competente</Label><select id="oversight-recipient" className="w-full rounded-md border bg-background p-2 text-sm" value={form.recipient} onChange={e=>update({recipient:e.target.value})}><option value="">Selecione</option>{officials.filter(o=>externalRoles.includes(o.role)&&o.id!==form.item.target_id&&o.id!==form.item.reporter_id).map(o=><option key={o.id} value={o.id}>{o.full_name} — {o.role}</option>)}</select><p className="text-xs text-muted-foreground">O encaminhamento não instaura ação judicial, CPI ou impeachment automaticamente.</p></>}
   {needsDays&&<><Label htmlFor="oversight-days">Prazo de resposta (dias reais)</Label><Input id="oversight-days" type="number" min="1" max="30" value={form.days} onChange={e=>update({days:e.target.value})}/></>}
   {form.action==='refer_pic'&&<><Label htmlFor="oversight-facts">Data e hora dos fatos (Brasília)</Label><Input id="oversight-facts" type="datetime-local" value={form.factsAt} onChange={e=>update({factsAt:e.target.value})}/><p className="text-xs text-muted-foreground">O PIC será criado sob sigilo, sem condenação e sem converter automaticamente relatos em provas.</p></>}
   {['close','refer_pic','refer_external'].includes(form.action)&&<p className="text-xs text-amber-400">O encerramento cancela comunicações anteriores ainda sem resposta e preserva seu histórico.</p>}
   <Label htmlFor="oversight-reason">{form.action==='reply'?'Resposta':creating?'Descrição dos fatos':'Fundamentação ou conteúdo da comunicação'} (mínimo de 40 caracteres)</Label><Textarea id="oversight-reason" rows={5} maxLength={20000} value={form.reason} onChange={e=>update({reason:e.target.value})}/><p className="text-xs text-muted-foreground">{form.reason.trim().length}/40 caracteres mínimos</p>
   {form.action==='representation'&&<p className="text-xs text-muted-foreground">A autoria é identificada perante o MP e não é exibida à autoridade representada.</p>}
  </div>}<DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setForm(null)}>Cancelar</Button><Button disabled={busy||!allowed} onClick={submit}>{busy?'Registrando…':'Confirmar'}</Button></DialogFooter></DialogContent></Dialog>
 </section>;
}
