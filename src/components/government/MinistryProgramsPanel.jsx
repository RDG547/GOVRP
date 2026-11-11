import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Activity,ClipboardCheck,FilePlus2,Loader2,PlayCircle} from 'lucide-react';
import {supabase} from '@/lib/supabaseClient';
import {useDomainRealtime} from '@/hooks/use-domain-realtime';
import {useToast} from '@/components/ui/use-toast';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {formatCurrency} from '@/lib/economy/format';

/** Every ministry has its own concrete, funded economic-program actions.
 * Merged ministries remain separate program categories managed by one minister.
 */
export default function MinistryProgramsPanel({ministry,isAdmin=false}){
 const {toast}=useToast();
 const [options,setOptions]=useState([]),[projects,setProjects]=useState([]);
 const [programKey,setProgramKey]=useState(''),[name,setName]=useState(''),
       [description,setDescription]=useState(''),[budget,setBudget]=useState('10000');
 const [busy,setBusy]=useState(''),[loading,setLoading]=useState(false);
 const load=useCallback(async()=>{
  if(!ministry){setOptions([]);setProjects([]);return;}
  setLoading(true);
  const [catalog,ministries,programs]=await Promise.all([
   supabase.from('ministry_program_definitions').select('program_key,ministry_id,title,description,project_type').eq('is_active',true),
   supabase.from('government_ministries').select('id,name').eq('name',ministry).maybeSingle(),
   supabase.from('government_projects').select('id,name,description,ministry,status,approved_budget,spent_amount,progress,metadata,created_at')
    .eq('ministry',ministry).contains('metadata',{ministry_program:true}).order('created_at',{ascending:false}).limit(60),
  ]);
  if(catalog.error||ministries.error||programs.error){
   console.error('Programas ministeriais:',catalog.error||ministries.error||programs.error);
   toast({title:'Não foi possível atualizar programas',variant:'destructive'});
  }else{
   const list=(catalog.data||[]).filter(item=>item.ministry_id===ministries.data?.id);
   setOptions(list);setProjects(programs.data||[]);
   setProgramKey(previous=>list.some(item=>item.program_key===previous)?previous:list[0]?.program_key||'');
  }
  setLoading(false);
 },[ministry,toast]);
 useEffect(()=>{void load();},[load]);
 useDomainRealtime('ministry-programs',ministry,['government_projects','ministry_program_definitions'],load,Boolean(ministry));
 const selected=useMemo(()=>options.find(item=>item.program_key===programKey),[options,programKey]);
 const propose=async()=>{
  if(!selected||busy||description.trim().length<30)return;
  setBusy('propose');
  try{
   const {data,error}=await supabase.rpc('propose_ministry_program',{
    p_program_key:selected.program_key,p_name:name.trim()||selected.title,
    p_description:description.trim(),p_budget:Number(budget)
   });
   if(error||data?.success===false)throw error||new Error(data?.message);
   toast({title:'Programa proposto',description:'Encaminhado à Presidência. O orçamento será reservado somente após aprovação.'});
   setName('');setDescription('');await load();
  }catch(error){toast({title:'Proposta não registrada',description:error.message,variant:'destructive'});}
  finally{setBusy('');}
 };
 const execute=async id=>{
  if(busy)return;setBusy(id);
  try{
   const {data,error}=await supabase.rpc('execute_ministry_program',{p_project_id:id,p_installment:null});
   if(error||data?.success===false)throw error||new Error(data?.message);
   toast({title:'Etapa executada',description:'O gasto foi registrado no sistema econômico e a evolução do projeto atualizada.'});
   await load();
  }catch(error){toast({title:'Não foi possível executar',description:error.message,variant:'destructive'});}
  finally{setBusy('');}
 };
 if(!ministry)return null;
 return <Card className="glass-effect">
  <CardHeader>
   <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-5 w-5"/>Programas e ações da pasta</CardTitle>
   <p className="text-sm text-muted-foreground">
    {ministry}: propostas específicas, aprovação presidencial, execução com gasto real
    e efeitos econômicos e administrativos. Ministérios unificados continuam com suas competências.
   </p>
  </CardHeader>
  <CardContent className="space-y-5">
   {loading&&<p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Atualizando programas...</p>}
   {!isAdmin&&options.length>0&&<div className="space-y-3 rounded-xl border border-border/60 p-3">
    <h3 className="flex items-center gap-2 font-medium"><FilePlus2 className="h-4 w-4"/>Propor iniciativa</h3>
    <div className="space-y-1"><Label>Área de atuação</Label>
     <Select value={programKey||undefined} onValueChange={setProgramKey}><SelectTrigger><SelectValue placeholder="Selecione o programa"/></SelectTrigger>
      <SelectContent>{options.map(option=><SelectItem key={option.program_key} value={option.program_key}>{option.title}</SelectItem>)}</SelectContent></Select>
    </div>
    {selected&&<p className="text-xs text-muted-foreground">{selected.description}</p>}
    <div className="space-y-1"><Label htmlFor="ministry-program-title">Nome do projeto</Label><Input id="ministry-program-title" value={name} onChange={e=>setName(e.target.value)} placeholder={selected?.title||'Projeto ministerial'}/></div>
    <div className="space-y-1"><Label htmlFor="ministry-program-description">Plano de execução e justificativa</Label><Textarea id="ministry-program-description" rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Descreva o objetivo, as entregas e como a população será beneficiada (mínimo 30 caracteres)."/></div>
    <div className="space-y-1"><Label htmlFor="ministry-program-budget">Orçamento solicitado (R$)</Label><Input id="ministry-program-budget" type="number" min={100} max={500000000} step={1} value={budget} onChange={e=>setBudget(e.target.value)}/></div>
    <Button disabled={busy!==''||description.trim().length<30||Number(budget)<100||Number(budget)>500000000} onClick={()=>void propose()}>
     {busy==='propose'?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<FilePlus2 className="mr-2 h-4 w-4"/>}Solicitar aprovação presidencial
    </Button>
   </div>}
   <div className="space-y-2">
    <h3 className="flex items-center gap-2 font-medium"><ClipboardCheck className="h-4 w-4"/>Iniciativas registradas</h3>
    {!projects.length&&<p className="text-sm text-muted-foreground">Ainda não há programas registrados nesta pasta.</p>}
    {projects.map(project=><div key={project.id} className="rounded-lg border border-border/60 p-3">
     <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{project.name}</p><span className="text-xs text-muted-foreground">{project.status}</span></div>
     <p className="mt-1 text-xs text-muted-foreground">{project.description}</p>
     <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs"><span>Orçamento: {formatCurrency(Number(project.approved_budget||0))}</span><span>Executado: {formatCurrency(Number(project.spent_amount||0))}</span><span>Progresso: {Number(project.progress||0).toFixed(0)}%</span></div>
     {!isAdmin&&['funded','in_progress','delayed'].includes(project.status)&&<Button className="mt-2" variant="outline" size="sm" disabled={busy!==''} onClick={()=>void execute(project.id)}>
      {busy===project.id?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<PlayCircle className="mr-2 h-4 w-4"/>}Executar próxima etapa financiada
     </Button>}
     {project.status==='proposed'&&<p className="mt-2 text-xs text-amber-400">Aguardando análise e reserva de recursos pela Presidência.</p>}
    </div>)}
   </div>
  </CardContent>
 </Card>;
}
