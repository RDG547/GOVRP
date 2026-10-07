import React from 'react';
import { NEEDS } from '@/lib/citizenNeedsPresentation';
export default function NeedEffects({ effects = {}, className = '' }) {
  return <div className={`flex flex-wrap gap-x-3 gap-y-1 text-xs ${className}`}>{NEEDS.filter(need => Number(effects[need.key])).map(({key,name,icon:Icon,text}) => <span key={key} className={`inline-flex items-center gap-1 ${text}`}><Icon aria-hidden="true" className="h-3.5 w-3.5"/>{name} {Number(effects[key]) > 0 ? '+' : ''}{Number(effects[key])}</span>)}</div>;
}
