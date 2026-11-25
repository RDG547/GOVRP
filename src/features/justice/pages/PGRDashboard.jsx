import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Scale,ShieldCheck,Search,Gavel,ClipboardList,FileText,CalendarClock,RefreshCw,LockKeyhole,Loader2,ArrowRight} from 'lucide-react';
import {useAuth} from '@/contexts/AuthContext';
import {supabase} from '@/lib/supabaseClient';
import {Button} from '@/components/ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {formatDateTimeBR} from '@/lib/dateTime';
import AuthorityJusticeDashboard from './AuthorityJusticeDashboard';

const modules=[
 {tab:'integrity',icon:ShieldCheck,title:'Integridade pública',description:'Analise remessas policiais, vincule denúncias e acompanhe resultados judiciais. O MP não condena nem absolve.',metrics:[['integrity_pending','Na etapa do MP']]},
 {tab:'investigations',icon:Search,title:'Investigações do MP',description:'Instaure PIC, vincule investigados e testemunhas, registre provas, solicite diligências e ofereça denúncias.',metrics:[['pic_active','PIC em instrução'],['pic_ready','PIC para denúncia'],['police_referred','Remessas policiais']]},
 {tab:'requests',icon:Gavel,title:'Pedidos judiciais',description:'Protocole medidas fundamentadas, vincule provas, acompanhe decisões e consulte extratos fictícios autorizados.',metrics:[['requests_pending','Pedidos do MP pendentes']]},
 {tab:'warrants',icon:ClipboardList,title:'Mandados',description:'Acompanhe expedição, vigência, revogação e cumprimento dos mandados. A execução compete à autoridade habilitada.',metrics:[['warrants_active','Mandados do MP vigentes']]},
 {tab:'oversight',icon:FileText,title:'Fiscalização e representações',description:'Receba representações, instaure procedimentos, solicite informações, expeça recomendações e encaminhe irregularidades.',metrics:[['representations_pending','Representações novas'],['oversight_open','Fiscalizações abertas'],['oversight_overdue','Respostas em atraso']]},
 {tab:'cases',icon:Scale,title:'Processos judiciais',description:'Acompanhe os processos aos quais o cargo já possui acesso. A competência de julgamento continua com o Judiciário.',metrics:[['cases_accessible','Processos acessíveis']]},
];
export default function PGRDashboard(){
 const {user}=useAuth();
 const key=[user?.id,user?.role,user?.admin_development?.mode,user?.admin_development?.simulated_role].join('|');
 const [summary,setSummary]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[tab,setTab]=useState('overview');
 const generation=useRef(0);
 const load=useCallback(async()=>{const seq=++generation.current;try{const r=await supabase.rpc('get_pgr_dashboard_summary');if(r.error)throw r.error;if(seq===generation.current){setSummary({key,data:r.data});setError('');}}catch(e){if(seq===generation.current){setSummary(null);setError(e.message||'Não foi possível verificar o acesso ao painel.');}}finally{if(seq===generation.current)setLoading(false);}},[key]);
 useEffect(()=>{setLoading(true);setTab('overview');setSummary(null);setError('');void load();const timer=window.setInterval(load,30000);return()=>{generation.current++;window.clearInterval(timer);};},[load]);
 const info=summary?.key===key?summary.data:null;
 if(!info)return <Card><CardContent className="p-6">{loading?<p role="status" className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin"/>Verificando acesso institucional…</p>:<div className="space-y-3"><p role="alert">{error||'Acesso não autorizado.'}</p><Button variant="outline" onClick={load}>Tentar novamente</Button></div>}</CardContent></Card>;
 const preview=info.preview_only===true;
 const counts=info.counts||{};
 const overview=<div className="space-y-4">
 <div className="flex flex-wrap justify-between items-center gap-3"><div><h3 className="text-lg font-semibold">Visão institucional</h3><p className="text-sm text-muted-foreground">Indicadores atualizados no servidor · {formatDateTimeBR(info.generated_at)}</p></div><Button size="sm" variant="outline" onClick={load}><RefreshCw className="mr-2 h-4 w-4"/>Atualizar indicadores</Button></div>
 <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{modules.map(m=><Card key={m.tab} className="glass-effect"><CardHeader><CardTitle className="flex gap-2 items-center text-base"><m.icon className="h-5 w-5 text-purple-400"/>{m.title}</CardTitle><CardDescription>{m.description}</CardDescription></CardHeader><CardContent className="space-y-3"><div className="space-y-2">{m.metrics.map(([k,label])=><div key={k} className="flex items-center justify-between gap-2 rounded border p-2"><span className="text-xs text-muted-foreground">{label}</span><strong className="text-xl tabular-nums">{preview?'—':counts[k]??'—'}</strong></div>)}</div><Button size="sm" variant="outline" className="w-full justify-between" onClick={()=>setTab(m.tab)}>Abrir área<ArrowRight className="h-4 w-4"/></Button></CardContent></Card>)}</div>
 <p className="text-xs text-muted-foreground">Os indicadores representam o escopo permitido ao cargo; listas operacionais exibem os registros recentes conforme seus limites atuais.</p>
 </div>;
 return <section className="space-y-5">
 <Card className="border-purple-500/30 bg-purple-500/5"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><Badge variant="outline" className="mb-3"><LockKeyhole className="mr-1 h-3 w-3"/>Acesso institucional restrito</Badge><CardTitle className="flex gap-3 items-center text-2xl"><Scale className="h-7 w-7 text-purple-400"/>Procuradoria-Geral da República</CardTitle><CardDescription className="mt-2">Central de trabalho do Procurador-Geral da República · Ministério Público</CardDescription></div><Badge variant="outline">{preview?'Simulação administrativa':'Em exercício'}</Badge></div></CardHeader><CardContent className="space-y-2 text-sm">{preview?<p className="text-amber-400">Pré-visualização: indicadores e registros sigilosos ocultos. Nenhuma ação real pode ser concluída.</p>:<><p>Titular: <strong>{info.holder}</strong></p><p className="text-muted-foreground">Posse: {formatDateTimeBR(info.term_start)} · {info.term_end?'Término: '+formatDateTimeBR(info.term_end):'Sem término registrado'}</p></>}<p className="text-muted-foreground">As funções de investigação, fiscalização e acusação não conferem poderes de julgamento, punição administrativa ou destituição.</p></CardContent></Card>
 <AuthorityJusticeDashboard pgrMode previewOnly={preview} activeTab={tab} onTabChange={setTab} overview={overview} onPgrRefresh={load}/>
 </section>;
}
