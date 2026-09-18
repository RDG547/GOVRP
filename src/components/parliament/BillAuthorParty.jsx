import React from 'react';
import PartyIdentity from './PartyIdentity';
export default function BillAuthorParty({ bill }) {
  const snapshot = bill.author_party_snapshot;
  if (!snapshot) return <span className="block text-xs text-muted-foreground">Partido no protocolo: não registrado no histórico</span>;
  if (snapshot.unaffiliated) return <span className="block text-xs text-muted-foreground">Sem partido no protocolo</span>;
  return <span className="block text-xs" title="Filiação registrada no protocolo da proposta"><PartyIdentity party={snapshot}/></span>;
}
