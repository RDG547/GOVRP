import React, { useMemo } from 'react';
import { citizenSignature } from '@/lib/citizenSignature';

export default function CitizenSignature({ user, className = '' }) {
  const { paths, viewBox } = useMemo(() => citizenSignature(user?.citizen_id || user?.id, user?.full_name), [user?.citizen_id, user?.id, user?.full_name]);
  return <div className={`w-2/5 min-w-0 ${className}`}><svg viewBox={viewBox} role="img" aria-label="Assinatura fictícia do cidadão" className="h-6 sm:h-9 w-full" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">{paths.map((path, i) => <path key={i} d={path.d} transform={path.transform} strokeWidth={path.width} />)}</svg><p className="text-center text-[0.4rem] sm:text-[8px]">ASSINATURA DO PORTADOR</p></div>;
}
