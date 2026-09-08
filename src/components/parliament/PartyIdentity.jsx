import React from 'react';
export default function PartyIdentity({ party, className = '' }) {
 if (!party?.name) return <span className={`text-muted-foreground ${className}`}>Sem partido</span>;
 return <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
   {party.logo_url ? <img src={party.logo_url} alt="" className="h-6 w-6 shrink-0 rounded object-contain" /> : <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-secondary text-xs">{party.acronym?.[0] || 'P'}</span>}
   <span className="break-words">{party.name}{party.acronym ? ` (${party.acronym.trim()})` : ''}</span>
 </span>;
}
