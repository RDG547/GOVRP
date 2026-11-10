import IntegratedUpdateGate from '@/components/IntegratedUpdateGate';
import React,{useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {GraduationCap,Loader2,ExternalLink} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {useToast} from '@/components/ui/use-toast';
import {formatDateTimeBR} from '@/lib/dateTime';
import {useOfficialSalaries,currentSalary} from '@/hooks/use-official-salaries';
import {usePublicCompetitions,useCompetitionClock,competitionRpc,COMPETITION_STATUS,APPLICATION_STATUS} from './usePublicCompetitions';

function CompetitionPortalContent(){
 const {id}=useParams();const state=usePublicCompetitions();const now=useCompetitionClock(state.competitions);const {roles}=useOfficialSalaries();
 const {toast}=useToast();const [busy,setBusy]=useState(false),[examLink,setExamLink]=useState(null);
 const selected=state.competitions.find(c=>c.id===id);
 const application=state.applications.find(a=>a.competition_id===id);
 const act=async(action)=>{if(busy)return;setBusy(true);try{
  if(action==='register'){await competitionRpc('register_public_competition',{p_id:id});await state.refresh();toast({title:'Inscrição confirmada'});}
  else {const link=await competitionRpc('get_public_competition_exam',{p_id:id});setExamLink({id,url:link});}
 }catch(error){toast({title:'Não foi possível concluir',description:error.message,variant:'destructive'});}finally{setBusy(false);}};
 const money=role=>{const salary=roles.find(r=>r.role===role);return salary?currentSalary(salary).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'Consultando catálogo…';};
 const examOpen=selected?.status==='published'&&now>=Date.parse(selected.exam_starts_at)&&now<Date.parse(selected.exam_ends_at);
 return <main className="mx-auto max-w-6xl space-y-6 px-3 py-8 sm:px-6">
  <PageHeader centered icon={GraduationCap} title="Concursos Públicos" description="Consulte os editais, participe das provas e acompanhe seu ingresso nas carreiras públicas."/>
  {state.error&&<p role="alert">{state.error}<Button variant="outline" onClick={state.refresh}>Tentar novamente</Button></p>}
  {state.loading?<Loader2 aria-label="Carregando concursos" className="mx-auto animate-spin"/>:id?selected?<>
   <Button asChild variant="outline"><Link to="/services/public-competitions">Todos os concursos</Link></Button>
   <Card><CardHeader><CardTitle>{selected.name}</CardTitle></CardHeader><CardContent className="space-y-2"><p>{selected.role} · {selected.vacancies} vagas · {COMPETITION_STATUS[selected.status]}</p><p>Remuneração semanal: {money(selected.role)}</p></CardContent></Card>
   <div className="grid gap-4 md:grid-cols-2">
    <Card><CardHeader><CardTitle>Edital</CardTitle></CardHeader><CardContent><Button asChild variant="outline"><a href={selected.notice_url} target="_blank" rel="noopener noreferrer">Consultar edital em PDF <ExternalLink className="ml-2 h-4 w-4"/></a></Button></CardContent></Card>
    <Card><CardHeader><CardTitle>Inscrição</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm">De {formatDateTimeBR(selected.registration_starts_at)} até {formatDateTimeBR(selected.registration_ends_at)}.</p>{application?<><p role="status">{APPLICATION_STATUS[application.status]}</p><p className="break-all text-xs text-muted-foreground">Identificação da inscrição: {application.id}</p></>:<Button disabled={busy||selected.status!=='published'||now<Date.parse(selected.registration_starts_at)||now>=Date.parse(selected.registration_ends_at)} onClick={()=>act('register')}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:null}Inscrever-se</Button>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Prova</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm">De {formatDateTimeBR(selected.exam_starts_at)} até {formatDateTimeBR(selected.exam_ends_at)}.</p><p className="text-sm text-muted-foreground">A prova é realizada no Google Forms. Informe a identificação da sua inscrição conforme o edital. A administração confere as respostas e registra a decisão no GOV.RP.</p>{application&&examOpen?<>{examLink?.id===id?<Button asChild><a href={examLink.url} target="_blank" rel="noopener noreferrer">Abrir Google Forms <ExternalLink className="ml-2 h-4 w-4"/></a></Button>:<Button disabled={busy} onClick={()=>act('exam')}>Acessar Prova</Button>}</>:<p className="text-sm">Acesso disponível aos inscritos durante o período da prova.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Resultados</CardTitle></CardHeader><CardContent>{selected.results_published_at&&selected.results_url?<Button asChild variant="outline"><a href={selected.results_url} target="_blank" rel="noopener noreferrer">Resultados oficiais em PDF</a></Button>:<p>Aguardando publicação dos resultados.</p>}</CardContent></Card>
   </div>
  </>:<p>Concurso não encontrado ou ainda não publicado.</p>:<div className="grid gap-4 md:grid-cols-2">{!state.competitions.length&&<p>Nenhum concurso publicado.</p>}{state.competitions.filter(c=>c.status!=='draft').map(c=><Card key={c.id}><CardHeader><CardTitle>{c.name}</CardTitle></CardHeader><CardContent className="space-y-3"><p>{c.role} · {c.vacancies} vagas</p><p>{money(c.role)} por semana</p><p className="text-sm">{COMPETITION_STATUS[c.status]} · Inscrições até {formatDateTimeBR(c.registration_ends_at)}</p><Button asChild><Link to={`/services/public-competitions/${c.id}`}>Consultar concurso</Link></Button></CardContent></Card>)}</div>}
 </main>;
}

export default function CompetitionPortal(props){return <IntegratedUpdateGate><CompetitionPortalContent {...props}/></IntegratedUpdateGate>;}
