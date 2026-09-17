import React from 'react';
import { Badge } from '@/components/ui/badge';
import { partyRoles, partyRoleIdentity } from '@/lib/partyIdentity';
export default function PartyRoleBadges({ party, userId }) {
  const roles=partyRoles(party,userId);
  return <span className="flex flex-wrap gap-1">{(roles.length?roles:['Membro']).map(role=>{const {icon:Icon,color}=partyRoleIdentity(role);return <Badge key={role} variant="outline" className={`gap-1 ${color}`}><Icon className="h-3 w-3"/>{role}</Badge>;})}</span>;
}
