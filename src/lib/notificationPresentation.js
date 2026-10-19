import {formatCurrency} from './utils';
export function notificationText(notification){
 return String(notification?.content||'').replace(/R\$\s*([\d]+(?:[.,][\d]+)*)/g,(_,raw)=>{
  const value=raw.includes(',')?Number(raw.replaceAll('.','').replace(',','.')):Number(/\.\d{2}$/.test(raw)?raw:raw.replaceAll('.',''));
  return Number.isFinite(value)?formatCurrency(value):`R$ ${raw}`;
 });
}
export function notificationDestination(n){
 if(['minister_invitation','government_invitation','vice_candidacy_invitation'].includes(n?.type))return `/dashboard?tab=invitations&invitation=${encodeURIComponent(n.metadata?.invitation_id||n.id)}`;
 return n?.link||'/dashboard';
}
