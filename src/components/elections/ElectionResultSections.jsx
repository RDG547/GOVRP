import React from 'react';
import { Flag, Landmark, Users } from 'lucide-react';
import CandidateIdentity from './CandidateIdentity';
import { partyColor } from '@/lib/partyIdentity';
export default function ElectionResultSections({ sections = [] }) {
 return <div className="max-h-[55dvh] space-y-5 overflow-y-auto pr-1 text-left">{sections.map(section=>{
  const presidential=section.office==='Presidente',Icon=presidential?Flag:section.office==='Senador'?Landmark:Users;
  const groups=presidential?Object.values(section.winners.reduce((all,w)=>{(all[w.ticket_id]||=[]).push(w);return all;},{})):section.winners.map(w=>[w]);
  return <section key={section.id} className="space-y-3 border-t pt-3"><h3 className="flex items-center gap-2 font-semibold"><Icon className="h-5 w-5 shrink-0"/>{section.name}</h3>{!section.status?<p className="text-sm text-muted-foreground">Apuração em andamento. O resultado aparecerá automaticamente.</p>:!groups.length?<p className="text-sm">Não houve candidatura eleita nesta disputa.</p>:groups.map((group,index)=><article key={group[0].ticket_id||index} className="space-y-3 rounded-xl border bg-secondary/20 p-3">{presidential&&<h4 className="text-xs font-semibold uppercase tracking-wide text-primary">Chapa eleita</h4>}{group.map(w=><CandidateIdentity key={`${w.id}:${w.office_role}`} identity={w} label={w.office_role}/>)}<p className="text-sm">{group[0].votes} votos · {group[0].percentage||0}%</p><div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full" style={{width:`${group[0].percentage||0}%`,backgroundColor:partyColor(group[0].party?.color)}}/></div></article>)}</section>;
 })}</div>;
}
