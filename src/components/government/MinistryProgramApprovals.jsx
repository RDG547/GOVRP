import React,{useCallback,useEffect,useState} from 'react';
import {ClipboardCheck,Loader2,ThumbsUp,ThumbsDown} from 'lucide-react';
import {supabase} from '@/lib/supabaseClient';
import {useDomainRealtime} from '@/hooks/use-domain-realtime';
import {useToast} from '@/components/ui/use-toast';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Textarea} from '@/components/ui/textarea';
import {formatCurrency} from '@/lib/economy/format';

/** All spending is approved explicitly by the head of government and reserved
 * from real treasury funds by approve_government_project. */
export default function MinistryProgramApprovals(){
 const {toast}=useToast(),[projects,setProjects]=useState([]),[review,setReview]=useState(null),
       [reason,setReason]=useState('Aprovado conforme competência ministerial e disponibilidade do Tesouro.'),
       [busy,setBusy]=useState(false);
 const load=useCallback(async()=>{
  const {data,error}=await supabase.from('government_projects')
    .select('id,name,description,ministry,approved_budget,status,created_at')
    .eq('status','proposed').contains('metadata',{ministry_program:true})
    .order('created_at',{ascending:true}).limit(100);
  if(error)console.warn('Programas aguardando análise:',error);
  else setProjects(data||[]);
 },[]);
 useEffect(()=>{void load();},[load]);
 useDomainRealtime('presidential-ministry-approval','pending',['government_projects'],load,true);
 const decide=async approved=>{
  if(busy||!review||reason.trim().length<10)return;setBusy(true);
  try{
   const {data,error}=await supabase.rpc('review_ministry_program',{
    p_project_id:review.id,p_approve:approved,p_reason:reason.trim()
   });
   if(error||data?.success===false)throw error||new Error(data?.message);
   toast({title:approved?'Programa aprovado e financiado':'Programa rejeitado',description:'O ministro responsável foi notificado.'});
   setReview(null);await load();
  }catch(error){toast({title:'Decisão não registrada',description:error.message,variant:'destructive'});}
  finally{setBusy(false);}
 };
 return <Card className="glass-effect">
  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-5 w-5"/>Programas ministeriais aguardando aprovação ({projects.length})</CardTitle>
   <p className="text-sm text-muted-foreground">Cada aprovação reserva recursos do Tesouro. A execução fica sob responsabilidade do ministério correspondente.</p>
  </CardHeader>
  <CardContent className="space-y-2">
   {!projects.length&&<p className="text-sm text-muted-foreground">Nenhuma proposta ministerial pendente.</p>}
   {projects.map(project=><div key={project.id} className="flex flex-col gap-2 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0"><p className="text-sm font-semibold">{project.name}</p>
     <p className="text-xs text-muted-foreground">{project.ministry} · {formatCurrency(Number(project.approved_budget||0))}</p>
     <p className="text-xs">{project.description}</p></div>
    <Button size="sm" variant="outline" onClick={()=>{setReview(project);setReason('Aprovado conforme competência ministerial e disponibilidade do Tesouro.');}}>Analisar</Button>
   </div>)}
   <Dialog open={Boolean(review)} onOpenChange={open=>{if(!open&&!busy)setReview(null);}}>
    <DialogContent><DialogHeader><DialogTitle>Analisar programa ministerial</DialogTitle>
     <DialogDescription>{review?.name} · {review?.ministry}. Aprovar reserva o orçamento integral no cofre.</DialogDescription>
    </DialogHeader>
    <Textarea aria-label="Justificativa da decisão presidencial" value={reason} rows={3} onChange={e=>setReason(e.target.value)}/>
    <div className="flex flex-wrap gap-2"><Button disabled={busy||reason.trim().length<10} onClick={()=>void decide(true)}>
     {busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<ThumbsUp className="mr-2 h-4 w-4"/>}Aprovar e financiar
    </Button><Button variant="destructive" disabled={busy||reason.trim().length<10} onClick={()=>void decide(false)}>
     <ThumbsDown className="mr-2 h-4 w-4"/>Rejeitar
    </Button></div>
   </DialogContent>
  </CardContent>
 </Card>;
}
