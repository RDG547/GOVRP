import React from 'react';
import PartyIdentity from './PartyIdentity';
export default function BillAuthorParty({ bill }) {
  const snapshot = bill.author_party_snapshot;
  const role = bill.author_identity_snapshot?.role || bill.author_role;
  const roleLabel = role ? <span className="block text-xs text-muted-foreground">{role} no protocolo</span> : null;
  if (!snapshot) return <span className="block text-xs text-muted-foreground">{roleLabel}Partido no protocolo: não registrado no histórico</span>;
  if (snapshot.unaffiliated) return <span className="block text-xs text-muted-foreground">{roleLabel}Sem partido no protocolo</span>;
  return <span className="block text-xs" title="Filiação registrada no protocolo da proposta">{roleLabel}<PartyIdentity party={snapshot}/></span>;
}
