import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { partyColor } from '@/lib/partyIdentity';

export function candidateIdentity(candidate) {
  return candidate?.identity_snapshot || candidate?.identity || {name:candidate?.political_name,avatar_url:candidate?.campaign_photo_url,party:candidate?.party_snapshot || candidate?.political_parties};
}
export default function CandidateIdentity({ identity, label, compact=false }) {
  if (!identity) return null;
  return <div className="flex min-w-0 items-start gap-3">
    <Avatar className={compact?'h-9 w-9':'h-12 w-12'}><AvatarImage src={identity.avatar_url} alt=""/><AvatarFallback>{identity.name?.charAt(0)||'?'}</AvatarFallback></Avatar>
    <div className="min-w-0 break-words"><p className="text-xs opacity-75">{label}</p><p className="font-semibold">{identity.name} - {identity.party?.acronym || (identity.historical_party_unknown ? 'Filiação histórica não registrada' : 'Independente')}</p>
      <div className="mt-1 flex items-center gap-2 text-xs"><span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full ring-1 ring-foreground/20" style={{backgroundColor:partyColor(identity.party?.color)}}/>{identity.party?.logo_url&&<img src={identity.party.logo_url} alt="" className="h-5 w-5 rounded object-contain"/>}<span>{identity.party?.name || (identity.historical_party_unknown ? 'O registro original não guardou o partido do vice.' : 'Sem filiação partidária')}</span></div>
    </div>
  </div>;
}
