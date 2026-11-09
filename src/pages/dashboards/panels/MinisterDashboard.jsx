import React, { useEffect, useMemo, useState } from 'react';
import { Building, ClipboardList, Landmark, Loader2, Wallet } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '@/lib/economy/format';

const MinisterDashboard = () => {
  const { user } = useAuth();
  const isAdmin = user?.is_platform_admin === true || user?.role === 'Admin';
  const [portfolios, setPortfolios] = useState([]);
  const [selectedMinistry, setSelectedMinistry] = useState('');
  const [projects, setProjects] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  useEffect(() => {
    let current = true;
    const load = async () => {
      setLoading(true);
      setError('');
      const [ministerRes, projectsRes, policyRes] = await Promise.all([
        supabase.from('ministers').select('user_id,ministry,status').eq('status','active'),
        supabase.from('government_projects').select('id,name,ministry,status,approved_budget,spent_amount,progress,created_at').order('created_at',{ascending:false}).limit(150),
        supabase.from('economic_policy_decisions').select('id,authority_profile_id,policy_type,status,announced_at_real,justification').order('announced_at_real',{ascending:false}).limit(150),
      ]);
      if (!current) return;
      const failure=ministerRes.error || projectsRes.error || policyRes.error;
      if (failure) setError(failure.message || 'Falha ao consultar a gestão ministerial.');
      else {
        const active=ministerRes.data || [];
        const visible=isAdmin ? active : active.filter((m) => m.user_id === user?.id);
        setPortfolios(visible);
        setSelectedMinistry((before) => visible.some((m)=>m.ministry===before) ? before : (visible[0]?.ministry || ''));
        setProjects(projectsRes.data || []);
        setPolicies(policyRes.data || []);
      }
      setLoading(false);
    };
    void load();
    const channel = supabase.channel('minister-dashboard-'+(user?.id||'admin'))
      .on('postgres_changes',{event:'*',schema:'public',table:'government_projects'},()=>{void load();})
      .on('postgres_changes',{event:'*',schema:'public',table:'economic_policy_decisions'},()=>{void load();})
      .on('postgres_changes',{event:'*',schema:'public',table:'ministers'},()=>{void load();})
      .subscribe();
    return () => {current=false;void supabase.removeChannel(channel);};
  }, [isAdmin,user?.id]);

  const office = portfolios.find((m)=>m.ministry===selectedMinistry) || null;
  const relevantProjects=useMemo(()=>projects.filter((project)=>project.ministry===selectedMinistry),[projects,selectedMinistry]);
  const relevantPolicies=useMemo(()=>policies.filter((policy)=>policy.authority_profile_id===office?.user_id),[policies,office?.user_id]);
  const ongoing=relevantProjects.filter((project)=>['approved','in_progress','planned','analysis'].includes(project.status));
  const budget=relevantProjects.reduce((sum,project)=>sum+Number(project.approved_budget||0),0);
  const spent=relevantProjects.reduce((sum,project)=>sum+Number(project.spent_amount||0),0);

  return (
    <div className="space-y-6">
      {isAdmin && <div className="max-w-lg space-y-2">
        <p className="text-sm font-medium">Consultar pasta ministerial</p>
        <Select value={selectedMinistry || undefined} onValueChange={setSelectedMinistry}>
          <SelectTrigger><SelectValue placeholder="Selecione uma pasta ativa" /></SelectTrigger>
          <SelectContent>{portfolios.map((m)=><SelectItem key={m.ministry} value={m.ministry}>{m.ministry}</SelectItem>)}</SelectContent>
        </Select>
      </div>}
      {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Atualizando dados da gestão ministerial...</p>}
      {error && <p role="alert" className="rounded-lg border border-red-500/30 p-3 text-sm text-red-300">{error}</p>}
      {!loading && !error && !office && <p className="rounded-lg border p-4 text-sm text-muted-foreground">Não há pasta ministerial ativa vinculada a esta sessão.</p>}
      {!error && office && <>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h3 className="flex items-center gap-2 text-xl font-semibold"><Landmark className="h-5 w-5 text-sky-400"/>{office.ministry}</h3>
          <p className="mt-1 text-sm text-muted-foreground">Indicadores oficiais e projetos efetivamente registrados nesta pasta.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            {label:'Projetos em andamento',value:ongoing.length,icon:Building,detail:'Da pasta selecionada'},
            {label:'Decisões registradas',value:relevantPolicies.length,icon:ClipboardList,detail:'Histórico do titular'},
            {label:'Orçamento registrado',value:formatCurrency(budget),icon:Wallet,detail:'Total dos projetos desta pasta'},
            {label:'Despesa executada',value:formatCurrency(spent),icon:Landmark,detail:'Aplicado nos projetos'},
          ].map((entry)=><Card className="glass-effect" key={entry.label}><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">{entry.label}</CardTitle><entry.icon className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><p className="break-words text-2xl font-bold">{entry.value}</p><p className="mt-1 text-xs text-muted-foreground">{entry.detail}</p></CardContent></Card>)}
        </div>
        <Card className="glass-effect">
          <CardHeader><CardTitle className="text-base">Projetos da pasta</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {relevantProjects.length ? relevantProjects.slice(0,12).map((project)=><div key={project.id} className="rounded-lg border border-white/10 p-3"><div className="flex items-start justify-between gap-3"><p className="font-medium">{project.name}</p><span className="text-xs text-muted-foreground">{project.status}</span></div><p className="mt-1 text-xs text-muted-foreground">Execução: {formatCurrency(project.spent_amount)} de {formatCurrency(project.approved_budget)} · Progresso: {Number(project.progress||0).toLocaleString('pt-BR')}%</p></div>) : <p className="text-sm text-muted-foreground">Nenhum projeto registrado para esta pasta.</p>}
          </CardContent>
        </Card>
        {selectedMinistry === 'Ministério da Economia' && <Card className="glass-effect">
          <CardContent className="pt-6"><p className="text-sm text-muted-foreground">Os valores em vigor da Selic, meta de inflação e das últimas políticas fiscais, com suas competências de alteração, estão na aba <strong>Economia</strong> deste painel.</p></CardContent>
        </Card>}
      </>}
    </div>
  );
};
export default MinisterDashboard;
