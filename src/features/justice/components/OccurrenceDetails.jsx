import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PoliceEvidenceFile } from './PoliceEvidenceFiles';

export default function OccurrenceDetails({ occurrence, showReporter = false }) {
  const [open, setOpen] = useState(false), [reporter, setReporter] = useState(null);
  const anonymous = occurrence.anonymous || occurrence.is_anonymous;
  useEffect(() => {
    if (!showReporter || !open || anonymous) return;
    let alive = true;
    void supabase.rpc('get_occurrence_reporter', { p_occurrence_id: occurrence.id }).then(result => { if (alive && !result.error) setReporter(result.data); });
    return () => { alive = false; };
  }, [showReporter, open, anonymous, occurrence.id]);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="space-y-3 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Pessoas envolvidas e provas</summary>{showReporter && <div className="mt-3">{anonymous ? <p className="text-sm">Denúncia anônima · identidade protegida</p> : reporter ? <div className="flex items-center gap-2"><Avatar><AvatarImage src={reporter.avatar_url} /><AvatarFallback>{reporter.full_name?.charAt(0)}</AvatarFallback></Avatar><p className="break-words text-sm">{reporter.full_name}<br /><span className="text-xs text-muted-foreground">@{reporter.username} · CPF RP: {reporter.cpf || 'Não informado'}</span></p></div> : <p className="text-sm text-muted-foreground">Consultando identificação do comunicante…</p>}</div>}{[['Envolvidos e suspeitos', occurrence.involved_people], ['Testemunhas', occurrence.witnesses]].map(([label, people]) => <div key={label}><h4 className="text-sm font-medium">{label}</h4><ul className="space-y-2">{(people || []).map((person, index) => <li key={person.profile_id || index} className="flex items-center gap-2 text-sm">{person.profile_id && <Avatar className="h-8 w-8"><AvatarImage src={person.avatar_url} /><AvatarFallback>{person.name?.charAt(0)}</AvatarFallback></Avatar>}<span className="break-words">{typeof person === 'string' ? person : person.name || person.description}{person.username && ` · @${person.username}`}{person.kind === 'suspect' && ' · Suspeito'}</span></li>)}</ul>{!people?.length && <p className="text-xs text-muted-foreground">Não informado.</p>}</div>)}<div className="flex flex-wrap gap-2">{(occurrence.evidence || []).map((item, index) => item.evidence_id ? <PoliceEvidenceFile key={item.evidence_id} id={item.evidence_id} name={item.name} /> : <p key={index} className="w-full break-words text-sm">{typeof item === 'string' ? item : item.reference}</p>)}</div></details>;
}
