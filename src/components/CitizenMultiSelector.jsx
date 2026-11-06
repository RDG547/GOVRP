import React from 'react';
import { X } from 'lucide-react';
import CitizenSelector from './CitizenSelector';
import UserSelectOption from './UserSelectOption';
import { Button } from './ui/button';

export default function CitizenMultiSelector({ value = [], onChange, kind = 'involved', label = 'Adicionar cidadão' }) {
  return <div className="space-y-2"><CitizenSelector label={label} value="" onChange={() => {}} onSelect={person => {
    if (!value.some(item => item.profile_id === person.id)) onChange([...value, { profile_id: person.id, name: person.full_name, username: person.username, avatar_url: person.avatar_url, kind }]);
  }} /><ul className="space-y-2">{value.map(person => <li key={person.profile_id} className="flex min-w-0 items-center gap-2 rounded-lg border p-2"><UserSelectOption user={{ ...person, id: person.profile_id, full_name: person.name }} detail={`@${person.username || 'cidadão'}`} /><Button type="button" size="icon" variant="ghost" aria-label={`Remover ${person.name}`} onClick={() => onChange(value.filter(item => item.profile_id !== person.profile_id))}><X className="h-4 w-4" /></Button></li>)}</ul></div>;
}
