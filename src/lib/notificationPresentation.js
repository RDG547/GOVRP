import {formatCurrency} from './utils';
export function notificationText(notification){
 return String(notification?.content||'').replace(/R\$\s*([\d]+(?:[.,][\d]+)*)/g,(_,raw)=>{
  const value=raw.includes(',')?Number(raw.replaceAll('.','').replace(',','.')):Number(/\.\d{2}$/.test(raw)?raw:raw.replaceAll('.',''));
  return Number.isFinite(value)?formatCurrency(value):`R$ ${raw}`;
 });
}
export function notificationDestination(n){
 if(n?.metadata?.requires_response===true||(/invitation|invitation_received|convite/.test(n?.type||'')&&!/response|respond|cancel/.test(n?.type||'')))return `/dashboard?tab=invitations&invitation=${encodeURIComponent(n.metadata?.invitation_id||n.metadata?.invitationId||n.id)}`;
 return n?.link||'/dashboard';
}
