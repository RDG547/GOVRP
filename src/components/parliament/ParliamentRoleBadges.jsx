import React from 'react';
import { Badge } from '@/components/ui/badge';
import { canonicalRole, officialRoleCapabilities, roleIcon } from '@/lib/roleIcons';

export default function ParliamentRoleBadges({ role }) {
  const current=canonicalRole(role), capabilities=officialRoleCapabilities(current);
  const base=capabilities.includes('Senador')?'Senador':capabilities.includes('Deputado')?'Deputado':null;
  if(!base)return null;
  return <span className="my-1 flex flex-wrap justify-inherit gap-1">{[base,...(current!==base?[current]:[])].map(label=>{const Icon=roleIcon(label);return <Badge variant="outline" key={label} className="whitespace-normal text-left"><Icon className="mr-1 h-3 w-3 shrink-0"/>{label}</Badge>;})}</span>;
}
