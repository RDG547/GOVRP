import React from 'react';
import { User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const getNestedProfile = (user) => user?.profile || user?.profiles || user || {};

const UserSelectOption = ({ user, label, detail }) => {
  const profile = getNestedProfile(user);
  const displayLabel = label || profile.full_name || profile.username || 'Usuário';

  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar className="h-7 w-7 border border-white/10 bg-slate-800">
        {profile.avatar_url ? (
          <AvatarImage src={profile.avatar_url} alt={`Foto de ${displayLabel}`} className="object-cover" />
        ) : null}
        <AvatarFallback className="bg-slate-800 text-slate-300">
          <User className="h-4 w-4" aria-hidden="true" />
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className="block truncate">{displayLabel}</span>
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </span>
  );
};

export default UserSelectOption;
