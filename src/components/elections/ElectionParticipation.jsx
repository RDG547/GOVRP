import React from 'react';
export default function ElectionParticipation({value}) {
 if(!value)return null;
 return <section className="space-y-2 rounded-xl border bg-secondary/20 p-3" aria-label="Participação dos jogadores">
  <h4 className="font-semibold">Participação dos jogadores</h4>
  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">{[['eligible','Eleitores elegíveis'],['participants','Participantes'],['valid_votes','Votos válidos'],['blank_votes','Votos em branco'],['null_votes','Votos nulos'],['abstentions','Abstenções']].filter(([key])=>value[key]!==undefined).map(([key,label])=><div key={key}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold">{Number(value[key]).toLocaleString('pt-BR')}</dd></div>)}</dl>
  {value.in_progress&&<p className="text-xs text-muted-foreground">Votação em andamento. A abstenção será apresentada ao encerrar.</p>}
  {value.legacy_eligible_estimate&&<p className="text-xs text-muted-foreground">Eleição anterior ao registro do eleitorado: elegíveis e abstenções estimados com os cadastros disponíveis. Votos preservados.</p>}
 </section>;
}
