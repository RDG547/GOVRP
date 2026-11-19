import {formatCurrency} from './utils';
export function notificationText(notification){
 return String(notification?.content||'').replace(/R\$\s*([\d]+(?:[.,][\d]+)*)/g,(_,raw)=>{
  const value=raw.includes(',')?Number(raw.replaceAll('.','').replace(',','.')):Number(/\.\d{2}$/.test(raw)?raw:raw.replaceAll('.',''));
  return Number.isFinite(value)?formatCurrency(value):`R$ ${raw}`;
 });
}
export function notificationDestination(n){
 if(n?.type==='judicial_hearing_required')return `/services/parliament/panel?section=appointments&nomination=${encodeURIComponent(n.metadata?.invitation_id||'')}`;
 if(n?.metadata?.requires_response===true||(/invitation|convite/.test(n?.type||'')&&!/response|respond|cancel/.test(n?.type||'')))return `/dashboard/citizen?tab=invitations&invitation=${encodeURIComponent(n.metadata?.invitation_id||n.metadata?.invitationId||n.id)}`;
 if (/^\/dashboard\?/.test(n?.link||'') && /(?:tab=invitations|invitation=)/.test(n.link)) return n.link.replace('/dashboard?', '/dashboard/citizen?');
 return n?.link||'/dashboard';
}
