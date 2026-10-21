import {justiceErrorMessage} from '@/lib/justice/errors';
import React,{useCallback,useEffect,useId,useRef,useState} from 'react';
import {BookOpen,CalendarClock,Gavel,Loader2,Search,Send,X} from 'lucide-react';
import {supabase} from '@/lib/supabaseClient';
import {fromBrasiliaInput,formatDateTimeBR} from '@/lib/dateTime';
import {formatCurrency} from '@/lib/utils';
import {useDomainRealtime} from '@/hooks/use-domain-realtime';
import {useToast} from '@/components/ui/use-toast';
import CitizenSelector from '@/components/CitizenSelector';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {GovSelect} from '@/components/ui/gov-select';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
const kindLabel={fine_fixed:'Multa fixa',fine_percentage:'Multa percentual',warning:'Advertência',regularization:'Regularização',business_suspension:'Suspensão empresarial'};
export default function LawSanctionDialog({cases=[],initialCaseId='',onApplied}){
 const id=useId(),intent=useRef(null),version=useRef(0); const {toast}=useToast();
 const [identity,setIdentity]=useState(null);
 const [open,setOpen]=useState(false),[caseId,setCaseId]=useState(initialCaseId),[laws,setLaws]=useState([]),[lawId,setLawId]=useState(''),[search,setSearch]=useState(''),[targetType,setTargetType]=useState(''),[targetId,setTargetId]=useState(''),[entities,setEntities]=useState([]),[linked,setLinked]=useState(false),[reason,setReason]=useState(''),[due,setDue]=useState(''),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const caseItem=cases.find(item=>item.id===caseId),law=laws.find(item=>item.id===lawId);
 const clear=()=>{setPreview(null);setError('');intent.current=null;};
 const load=useCallback(async()=>{
  if(!open||!caseId)return;const sequence=++version.current;setLoading(true);
  const result=await supabase.rpc('get_applicable_sanction_laws',{p_facts_at:caseItem?.facts_occurred_at||new Date().toISOString()});
  if(sequence!==version.current)return;setLoading(false);
  if(result.error){setError('Não foi possível consultar os dispositivos aplicáveis.');console.error('Catálogo judicial',result.error);return;}setLaws(result.data||[]);
 },[open,caseId,caseItem?.facts_occurred_at]);
 useEffect(()=>{void load();return()=>{version.current++;};},[load]);
 useDomainRealtime('judicial-laws','public',['government_rules','law_effects','bills'],load,open);
 useEffect(()=>{
  if(!open||!['business','party'].includes(targetType)){setEntities([]);return;}
  let cancelled=false;supabase.from(targetType==='business'?'businesses':'political_parties').select(targetType==='business'?'id,name,business_type_id':'id,name,acronym,logo_url').order('name').then(result=>{if(!cancelled){if(result.error)setError('Não foi possível consultar os alvos institucionais.');else setEntities(result.data||[]);}});return()=>{cancelled=true;};
 },[open,targetType]);
 useEffect(()=>{let cancelled=false;setIdentity(null);if(targetType==='business'&&targetId)supabase.rpc('get_company_page',{p_business_id:targetId}).then(result=>{if(!cancelled&&!result.error)setIdentity(result.data);});return()=>{cancelled=true;};},[targetType,targetId]);
 const prepare=async()=>{
  setBusy(true);setError('');
  try{
   if(!caseItem?.facts_occurred_at)throw new Error('O processo precisa registrar a data dos fatos antes da aplicação da lei.');
   if(linked){const result=await supabase.rpc('add_case_entity_party',{p_case_id:caseId,p_target_type:targetType,p_target_id:targetId});if(result.error)throw result.error;}
   const result=await supabase.rpc('preview_judicial_sanction',{p_case_id:caseId,p_effect_id:lawId,p_target_type:targetType,p_target_id:targetId});if(result.error)throw result.error;setPreview(result.data);
  }catch(failure){console.error('Prévia de sanção recusada',failure);setError(justiceErrorMessage(failure));}finally{setBusy(false);}
 };
 const apply=async()=>{
  if(busy)return;setBusy(true);setError('');
  if(!intent.current)intent.current=crypto.randomUUID();
  try{
   const result=await supabase.rpc('apply_judicial_sanction',{p_case_id:caseId,p_effect_id:lawId,p_target_type:targetType,p_target_id:targetId,p_reason:reason,p_due_date:fromBrasiliaInput(due),p_operation_key:intent.current});if(result.error)throw result.error;
   toast({title:'Sanção registrada',description:'A decisão, a obrigação e as notificações foram persistidas.'});setOpen(false);setPreview(null);setReason('');setDue('');intent.current=null;await onApplied?.();
  }catch(failure){console.error('Sanção judicial recusada',failure);setError(justiceErrorMessage(failure));}finally{setBusy(false);}
 };
 return <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogTrigger asChild><Button disabled={busy} variant="outline"><Gavel className="mr-2 h-4 w-4"/>Aplicar sanção prevista em lei</Button></DialogTrigger><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><Gavel className="mx-auto h-8 w-8 text-purple-400"/><DialogTitle>Aplicar sanção prevista em lei</DialogTitle><DialogDescription>A decisão exige processo, dispositivo vigente na data dos fatos, alvo vinculado e fundamentação da responsabilidade.</DialogDescription></DialogHeader>
  <div className="space-y-2"><Label htmlFor={`${id}-case`}>Processo</Label><GovSelect id={`${id}-case`} value={caseId} onChange={event=>{setCaseId(event.target.value);setLawId('');clear();}}><option value="">Selecione o processo</option>{cases.map(item=><option key={item.id} value={item.id}>{item.case_number||item.title||item.id}</option>)}</GovSelect>{caseItem&&<p className="text-xs text-muted-foreground">Data dos fatos: {caseItem.facts_occurred_at?formatDateTimeBR(caseItem.facts_occurred_at):'não registrada — aplicação bloqueada'}</p>}</div>
  <div className="space-y-2"><Label htmlFor={`${id}-search`} className="flex items-center gap-2"><Search className="h-4 w-4"/>Pesquisar norma, assunto ou sanção</Label><Input id={`${id}-search`} value={search} onChange={event=>setSearch(event.target.value)} placeholder="Número, título, infração, categoria ou sanção"/><GovSelect aria-label="Dispositivo legal" value={lawId} onChange={event=>{setLawId(event.target.value);clear();}}><option value="">Selecione o dispositivo aplicável</option>{laws.filter(item=>JSON.stringify(item).toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).map(item=><option key={item.id} value={item.id}>{item.number} · {item.name} · {kindLabel[item.definition.sanction_kind]}</option>)}</GovSelect>{loading&&<p className="text-xs">Consultando normas…</p>}</div>
  {law&&<section className="space-y-2 rounded-lg border p-3 text-sm"><h3 className="flex items-center gap-2 font-semibold"><BookOpen className="h-4 w-4"/>{law.title}</h3><p>{law.definition.infraction}</p><p className="text-muted-foreground">Condições: {law.definition.conditions}</p><p>Vigência: {formatDateTimeBR(law.valid_from)}{law.valid_until?` até ${formatDateTimeBR(law.valid_until)}`:' · sem término definido'}</p><details><summary className="min-h-11 cursor-pointer py-2">Texto e versão aplicável</summary><p className="whitespace-pre-wrap break-words">{law.text}</p><p className="text-xs">Versão publicada em {formatDateTimeBR(law.version)}</p></details></section>}
  <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`${id}-type`}>Tipo de alvo</Label><GovSelect id={`${id}-type`} value={targetType} onChange={event=>{setTargetType(event.target.value);setTargetId('');setLinked(false);clear();}}><option value="">Selecione</option>{Object.entries({citizen:'Cidadão',business:'Empresa',party:'Partido'}).filter(([type])=>!law||law.definition.audience==='all'||law.definition.audience===type).map(([value,label])=><option key={value} value={value}>{label}</option>)}</GovSelect></div><div className="space-y-2"><Label>Alvo da decisão</Label>{targetType==='citizen'?<CitizenSelector value={targetId} onChange={value=>{setTargetId(value);clear();}}/>:<GovSelect aria-label="Alvo institucional" value={targetId} onChange={event=>{setTargetId(event.target.value);clear();}}><option value="">Selecione</option>{entities.map(item=><option key={item.id} value={item.id}>{item.name}{item.acronym?` (${item.acronym})`:''}</option>)}</GovSelect>}</div></div>
  {targetType==='business'&&identity&&<section className="rounded-lg border p-3 text-sm"><strong>{identity.name}</strong><p>CNPJ: {identity.cnpjs?.map(document=>document.document_number||document.number).filter(Boolean).join(', ')||'não vinculado'}</p><p>Proprietário: {identity.owner?.full_name||identity.owner_name||'não informado'}</p></section>}
  {targetType==='party'&&targetId&&<section className="flex min-w-0 items-center gap-3 rounded-lg border p-3 text-sm">{entities.find(item=>item.id===targetId)?.logo_url&&<img src={entities.find(item=>item.id===targetId).logo_url} alt="Logo do partido" className="h-12 w-12 rounded-lg object-contain"/>}<strong className="min-w-0 break-words">{entities.find(item=>item.id===targetId)?.name} ({entities.find(item=>item.id===targetId)?.acronym})</strong></section>}
  {targetId&&<label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={linked} onChange={event=>{setLinked(event.target.checked);clear();}}/>Vincular este alvo como parte do processo, se ainda não estiver vinculado.</label>}
  <div className="space-y-2"><Label htmlFor={`${id}-reason`}>Fundamentação da responsabilidade (mínimo de 30 caracteres)</Label><Textarea id={`${id}-reason`} value={reason} onChange={event=>setReason(event.target.value)} rows={5}/></div>
  <div className="space-y-2"><Label htmlFor={`${id}-due`} className="flex items-center gap-2"><CalendarClock className="h-4 w-4"/>Prazo para pagamento ou cumprimento (Brasília)</Label><Input id={`${id}-due`} type="datetime-local" value={due} onChange={event=>setDue(event.target.value)}/></div>
  {error&&<p role="alert" className="rounded-lg border border-red-500/30 p-3 text-sm text-red-300">{error}</p>}
  {preview&&<section className="space-y-2 rounded-lg bg-secondary p-4 text-sm" aria-live="polite"><h3 className="font-semibold">Confirmação da sanção</h3><p>{kindLabel[preview.law.definition.sanction_kind]}</p>{preview.amount!=null&&<><p>Valor: <strong>{formatCurrency(preview.amount)}</strong></p>{preview.base_amount!=null&&<p>Base de cálculo registrada: {formatCurrency(preview.base_amount)}</p>}<p>Pagamento pelo {targetType==='business'?'caixa da empresa':targetType==='party'?'caixa do partido':'saldo pessoal do cidadão'}.</p></>}<p>Reincidências definitivas consideradas: {preview.recurrence_count}</p><p className="text-xs text-muted-foreground">A norma, a base e o valor serão preservados na decisão. Recursos financeiros podem suspender a cobrança ou gerar restituição ao caixa de origem.</p></section>}
  <DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}><X className="mr-2 h-4 w-4"/>Cancelar</Button>{preview?<Button disabled={busy||reason.trim().length<30||!due} onClick={apply}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Send className="mr-2 h-4 w-4"/>}Confirmar decisão</Button>:<Button disabled={busy||!caseId||!lawId||!targetType||!targetId} onClick={prepare}>{busy&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Conferir sanção</Button>}</DialogFooter>
 </DialogContent></Dialog>;
}
