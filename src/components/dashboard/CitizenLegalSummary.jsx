import { formatLocaleBR } from '@/lib/dateTime';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scale, Bell, Clock, Receipt, Gavel, FileText } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { justiceStatus, justiceDeadline, justiceRequest } from '@/lib/justice/constants';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card,CardHeader,CardTitle,CardContent } from '@/components/ui/card';
export default function CitizenLegalSummary() {
  const {user}=useAuth();const [data,setData]=useState(null),[error,setError]=useState('');
  const load=useCallback(async()=>{const result=await supabase.rpc('get_my_legal_summary');if(result.error)setError('Não foi possível consultar sua vida jurídica.');else {setData(result.data);setError('');}},[]);
  useEffect(()=>{void load();},[load]);
  useDomainRealtime('citizen-legal-summary',user.id,['criminal_cases','case_parties','justice_deadlines','police_fines','warrants',{table:'notifications',filter:`user_id=eq.${user.id}`}],load);
  const groups=[['Meus processos',Gavel,data?.cases,item=>`${item.case_number} · ${item.title} · ${justiceStatus(item.status)}`],['Meus prazos',Clock,data?.deadlines,item=>`${justiceDeadline(item.deadline_type)} · ${formatLocaleBR(new Date(item.real_due_at), 'toLocaleString', 'pt-BR')}`],['Minhas multas',Receipt,data?.fines,item=>`${formatCurrency(item.amount)} · ${justiceStatus(item.status)} · ${item.reason}`],['Intimações e avisos',Bell,data?.notices,item=>item.content],['Mandados comunicados',FileText,data?.security?.warrants,item=>`${item.number} · ${justiceRequest(item.type)} · ${justiceStatus(item.status)}`]];
  return <section className="space-y-4"><h2 className="flex items-center gap-2 text-xl font-semibold"><Scale className="h-6 w-6 text-violet-400"/>Minha vida jurídica</h2><p className="text-sm text-muted-foreground">Seus registros pessoais e próximos passos na Justiça.</p>{error&&<p role="alert">{error}</p>}<div className="flex flex-wrap gap-2"><Button asChild><Link to="/services/justice">Acompanhar caso ou apresentar defesa</Link></Button><Button asChild variant="outline"><Link to="/services/justice">Registrar ocorrência</Link></Button></div><div className="grid gap-4 md:grid-cols-2">{groups.map(([title,Icon,items,describe])=><Card key={title}><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Icon className="h-5 w-5 text-violet-400"/>{title}</CardTitle></CardHeader><CardContent className="space-y-3">{!data?<p>Carregando…</p>:!items?.length?<p className="text-sm text-muted-foreground">Nenhum registro disponível.</p>:items.map((item,index)=><p key={item.id||index} className="text-sm break-words border-b pb-2">{describe(item)}</p>)}</CardContent></Card>)}</div></section>;
}
