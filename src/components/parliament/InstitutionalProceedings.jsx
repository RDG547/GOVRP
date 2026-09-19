import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Landmark, Gavel, Vote, Archive, PlusCircle, Check, X, Loader2, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { formatDateTimeBR } from '@/lib/dateTime';
import { fetchPublicProfiles } from '@/lib/publicProfiles';
import { userErrorMessage } from '@/lib/userErrors';
import PartyIdentity from './PartyIdentity';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

export function ParliamentResignation({ houseId, member, hasLeadership = false, onUpdated }) {
  const [open, setOpen] = useState(false), [scope, setScope] = useState('mandate'), [reason, setReason] = useState(''), [busy, setBusy] = useState(false);
  const { toast } = useToast();
  if (!member) return null;
  const resign = async () => {
    setBusy(true);
    try {
      const result = await supabase.rpc('resign_parliament_position', { p_house_id: houseId, p_scope: scope, p_reason: reason });
      if (result.error) throw result.error;
      setOpen(false); setReason(''); onUpdated?.(); toast({ title: 'Renúncia registrada', description: 'Seus cargos e permissões foram atualizados.' });
    } catch (error) { console.error('Renúncia parlamentar', error); toast({ title: 'Renúncia não concluída', description: userErrorMessage(error), variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  return <><Button variant="outline" onClick={() => { setScope(hasLeadership ? 'leadership' : 'mandate'); setOpen(true); }}><LogOut className="mr-2 h-4 w-4"/>Renunciar ao Cargo</Button><Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="max-w-md text-center"><DialogHeader className="sm:text-center"><DialogTitle>Renúncia parlamentar</DialogTitle><DialogDescription>A saída será registrada no histórico. Ao renunciar à presidência da Casa, o vice assume automaticamente quando possuir mandato ativo.</DialogDescription></DialogHeader>{hasLeadership ? <><Label htmlFor="resignation-scope">O que deseja renunciar?</Label><Select value={scope} onValueChange={setScope}><SelectTrigger id="resignation-scope"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="leadership"><span className="flex items-center gap-2"><Landmark className="h-4 w-4"/>Mesa Diretora — manter mandato</span></SelectItem><SelectItem value="mandate"><span className="flex items-center gap-2"><LogOut className="h-4 w-4"/>Mandato Completo</span></SelectItem></SelectContent></Select></> : <p className="text-sm">Você renunciará ao mandato completo e deixará suas funções parlamentares.</p>}<Label htmlFor="resignation-reason">Motivo (mínimo de 20 caracteres)</Label><Textarea id="resignation-reason" value={reason} onChange={event => setReason(event.target.value)}/><DialogFooter className="gap-2 sm:justify-center sm:space-x-0"><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}><X className="mr-2 h-4 w-4"/>Cancelar</Button><Button variant="destructive" disabled={busy || reason.trim().length < 20} onClick={resign}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Check className="mr-2 h-4 w-4"/>}Confirmar renúncia</Button></DialogFooter></DialogContent></Dialog></>;
}

export default function InstitutionalProceedings({ houseId, memberId }) {
  const { user } = useAuth(); const { toast } = useToast();
  const [bills, setBills] = useState([]), [presidents, setPresidents] = useState([]), [rules, setRules] = useState(null), [chair, setChair] = useState(false);
  const [action, setAction] = useState(null), [form, setForm] = useState({ title:'', reason:'', facts:'', links:'', presidentId:'' }), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const sequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const canPropose = Boolean(memberId) && ['Deputado','Presidente da Câmara','Presidente da Câmara dos Deputados','Vice-Presidente da Câmara dos Deputados'].includes(user?.stored_role || user?.role);
  const load = useCallback(async () => {
    if (!houseId) return;
    const version = ++sequence.current;
    try {
      const [proposals, settings, leaders, candidates] = await Promise.all([
        supabase.from('bills').select('*').eq('house_id',houseId).eq('type','IMPEACHMENT').order('created_at',{ascending:false}),
        supabase.from('system_settings').select('value').eq('key','parliament_institutional_rules').maybeSingle(),
        supabase.from('parliament_leadership_terms').select('member_id,position').eq('house_id',houseId).eq('status','active').gte('term_end_date',new Date().toISOString().slice(0,10)),
        supabase.rpc('get_impeachment_presidents'),
      ]);
      if (proposals.error || settings.error || leaders.error || candidates.error) throw proposals.error || settings.error || leaders.error || candidates.error;
      const ids=(proposals.data || []).map(bill => bill.id);
      const votings=ids.length ? await supabase.from('parliament_votings').select('*,votes:parliament_voting_votes(member_id,vote)').eq('type','bill').in('related_id',ids) : {data:[]};
      if (votings.error) throw votings.error;
      const authors=await fetchPublicProfiles((proposals.data || []).map(bill => bill.author_id));
      if (version !== sequence.current) return;
      setBills((proposals.data || []).map(bill => ({...bill,author:authors.get(bill.author_id),voting:votings.data.find(v => v.related_id===bill.id)})));
      setRules(settings.data?.value);setChair(Boolean(memberId) && (user?.role === 'Presidente da Câmara dos Deputados' || (leaders.data || []).some(term => term.member_id===memberId && term.position==='president')));setPresidents(candidates.data || []);setError(false);
    } catch (failure) { console.error('Procedimentos institucionais',failure); if(version===sequence.current)setError(true); } finally { if(version===sequence.current)setLoading(false); }
  }, [houseId,memberId,user?.role]);
  useEffect(() => {void load(); return () => {sequence.current++;};},[load]);
  useDomainRealtime('parliament-institutional',houseId,['bills','parliament_votings','parliament_voting_votes','parliament_leadership_terms','parliament_members','system_settings'],load,Boolean(houseId));
  usePublicProfileChanges(load, Boolean(houseId));
  const perform = async (kind, bill, vote) => {
    if(busy)return;setBusy(true);
    try {
      let result;
      if(kind==='create') result=await supabase.rpc('propose_presidential_impeachment',{p_house_id:houseId,p_president_id:form.presidentId,p_title:form.title,p_reason:form.reason,p_facts:form.facts,p_evidence_links:form.links.split(/\n/).map(line=>line.trim()).filter(Boolean)});
      if(kind==='archive') result=await supabase.rpc('archive_presidential_impeachment',{p_bill_id:bill.id,p_reason:form.reason});
      if(kind==='start') result=await supabase.rpc('start_parliament_bill_voting',{p_bill_id:bill.id,p_house_id:houseId,p_title:bill.title,p_description:bill.summary});
      if(kind==='vote') result=await supabase.rpc('cast_parliament_vote',{p_voting_id:bill.voting.id,p_member_id:memberId,p_vote:vote});
      if(result.error)throw result.error;
      if(kind==='vote') { const finalized=await supabase.rpc('finalize_bill_voting',{p_voting_id:bill.voting.id}); if(finalized.error)console.error('Apuração institucional pendente',finalized.error); }
      setAction(null);await load();toast({title:kind==='vote'?'Voto registrado':'Procedimento atualizado'});
    } catch(failure){console.error('Ação institucional',failure);toast({title:'Ação não concluída',description:/^(Somente|O |A |Você|Preencha|Já |As |Seu )/.test(failure.message || '') ? failure.message : userErrorMessage(failure),variant:'destructive'});}
    finally{setBusy(false);}
  };
  const begin=(kind,bill=null)=>{setForm({title:'',reason:'',facts:'',links:'',presidentId:presidents[0]?.id || ''});setAction({kind,bill});};
  return <section className="space-y-5" aria-label="Procedimentos institucionais da Câmara"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5"/>Impeachment presidencial</CardTitle><CardDescription>Procedimento próprio do GOVRP, deliberado exclusivamente pela Câmara dos Deputados.</CardDescription></CardHeader><CardContent className="space-y-3"><p className="text-sm">A aprovação exige {rules?.impeachment_approval_numerator || 2}/{rules?.impeachment_approval_denominator || 3} dos Deputados ativos registrados na abertura. Prazo de {rules?.impeachment_duration_hours || 24} horas. A Presidência da Câmara pauta ou arquiva com justificativa. A aprovação destitui o Presidente e aplica a sucessão institucional, preservando o gabinete.</p><Button disabled={loading || error || !canPropose || !presidents.length} aria-describedby="impeachment-availability" onClick={()=>begin('create')}><PlusCircle className="mr-2 h-4 w-4"/>Protocolar Pedido de Impeachment</Button><p id="impeachment-availability" className="text-sm text-muted-foreground">{loading ? 'Verificando a Presidência…' : error ? 'Não foi possível verificar as condições. Tente carregar novamente.' : !canPropose ? 'Somente Deputados ativos podem protocolar.' : !presidents.length ? 'Não há Presidente em exercício elegível ao processo.' : 'Você pode protocolar um pedido para análise da Presidência da Câmara.'}</p></CardContent></Card>
    {error && <Button variant="outline" onClick={load}>Não foi possível carregar. Tentar novamente</Button>}
    {bills.map(bill=>{const data=bill.institutional_data || {}, voting=bill.voting, votes=voting?.votes || [], ownVote=votes.find(v=>v.member_id===memberId);const isOpen=voting?.status==='active' && new Date(voting.end_date).getTime()>Date.now();return <Card key={bill.id}><CardHeader><CardTitle className="break-words">{bill.title}</CardTitle><CardDescription>{bill.status} · Proposto em {formatDateTimeBR(bill.created_at)}</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex items-center gap-3"><Avatar><AvatarImage src={bill.author?.avatar_url}/><AvatarFallback>{bill.author?.full_name?.charAt(0)}</AvatarFallback></Avatar><div className="min-w-0"><p className="break-words">{bill.author?.full_name || 'Autor indisponível'}</p>{bill.author_party_snapshot?.unaffiliated ? <span className="text-xs">Sem partido no protocolo</span> : <PartyIdentity party={bill.author_party_snapshot}/>}</div></div><p>Presidente envolvido: <strong>{data.president_snapshot?.full_name}</strong></p><p className="whitespace-pre-wrap break-words">{bill.summary}</p><details><summary className="cursor-pointer text-primary">Fatos e provas</summary><p className="mt-2 whitespace-pre-wrap break-words">{bill.full_text}</p>{(data.evidence_links || []).map((url,index)=><a key={index} href={url} target="_blank" rel="noreferrer" className="my-2 block break-all text-primary underline">Prova {index+1}</a>)}</details>{data.archive_reason && <p>Arquivamento: {data.archive_reason}</p>}
      {voting && <div className="rounded-lg border p-3 text-sm"><p>Favoráveis: {votes.filter(v=>v.vote==='Aprovar').length} · Contrários: {votes.filter(v=>v.vote==='Rejeitar').length} · Abstenções: {votes.filter(v=>v.vote==='Abster').length}</p><p>Exigidos: {data.required_approvals} votos favoráveis de {data.eligible_seats} integrantes.</p><p>Prazo: {formatDateTimeBR(voting.end_date)}</p>{ownVote && <p>Seu voto: {ownVote.vote}</p>}</div>}
      {data.result && <p className="rounded-lg bg-muted p-3 text-sm">Decisão: {formatDateTimeBR(data.result.decided_at)} · {data.result.approved?'Pedido aprovado; sucessão registrada.':data.result.presidency_already_vacated?'Arquivado porque o Presidente já havia deixado o cargo.':'Pedido rejeitado; cargo presidencial preservado.'}</p>}
      <div className="flex flex-wrap gap-2">{chair && bill.status==='Protocolado' && <><Button disabled={busy} onClick={()=>begin('start',bill)}><Vote className="mr-2 h-4 w-4"/>Pautar votação</Button><Button variant="outline" disabled={busy} onClick={()=>begin('archive',bill)}><Archive className="mr-2 h-4 w-4"/>Arquivar</Button></>}{isOpen && memberId && !ownVote && (data.eligible_member_ids || []).includes(memberId) && ['Aprovar','Rejeitar','Abster'].map(choice=><Button key={choice} variant="outline" disabled={busy} onClick={()=>setAction({kind:'vote',bill,vote:choice})}><Vote className="mr-2 h-4 w-4"/>{choice}</Button>)}</div>
    </CardContent></Card>;})}
    {!error && !bills.length && <p className="text-sm text-muted-foreground">Nenhum pedido protocolado nesta Casa.</p>}
    <Dialog open={Boolean(action)} onOpenChange={open=>{if(!open&&!busy)setAction(null);}}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Gavel className="h-5 w-5"/>{({create:'Protocolar impeachment',archive:'Arquivar pedido',start:'Pautar impeachment',vote:'Confirmar voto'})[action?.kind]}</DialogTitle><DialogDescription>{action?.kind==='start'?'A votação registrará o quórum, os integrantes elegíveis e o prazo. A aprovação destitui o Presidente e aplica a sucessão.':action?.kind==='vote'?`Seu voto será ${action.vote}. Após registrado, ele não poderá ser alterado.`:'A ação ficará registrada no histórico público do Parlamento.'}</DialogDescription></DialogHeader>
      {action?.kind==='create' && <><Label htmlFor="impeachment-president">Presidente envolvido</Label><select id="impeachment-president" className="h-11 rounded border bg-background px-2" value={form.presidentId} onChange={e=>setForm({...form,presidentId:e.target.value})}>{presidents.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select><Label htmlFor="impeachment-title">Título (10 caracteres)</Label><Input id="impeachment-title" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></>}
      {['create','archive'].includes(action?.kind) && <><Label htmlFor="impeachment-reason">Justificativa (40 caracteres)</Label><Textarea id="impeachment-reason" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></>}
      {action?.kind==='create' && <><Label htmlFor="impeachment-facts">Fatos (40 caracteres)</Label><Textarea id="impeachment-facts" value={form.facts} onChange={e=>setForm({...form,facts:e.target.value})}/><Label htmlFor="impeachment-links">Provas — um link HTTPS por linha (opcional)</Label><Textarea id="impeachment-links" value={form.links} onChange={e=>setForm({...form,links:e.target.value})}/></>}
      <DialogFooter className="gap-2 sm:justify-center sm:space-x-0"><Button variant="outline" disabled={busy} onClick={()=>setAction(null)}><X className="mr-2 h-4 w-4"/>Cancelar</Button><Button disabled={busy || (['create','archive'].includes(action?.kind)&&form.reason.trim().length<40) || (action?.kind==='create'&&(!form.presidentId||form.title.trim().length<10||form.facts.trim().length<40))} onClick={()=>perform(action.kind,action.bill,action.vote)}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Check className="mr-2 h-4 w-4"/>}Confirmar</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
