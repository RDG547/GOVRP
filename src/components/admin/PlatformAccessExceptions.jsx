import { userErrorMessage } from '@/lib/userErrors';
import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { fetchPublicProfiles } from '@/lib/publicProfiles';
import { formatDateTimeBR } from '@/lib/dateTime';
import CitizenSelector from '@/components/CitizenSelector';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function PlatformAccessExceptions() {
 const [rows,setRows]=useState([]),[people,setPeople]=useState(new Map()),[person,setPerson]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=useCallback(async()=>{const result=await supabase.from('platform_access_exceptions').select('*').order('granted_at',{ascending:false});if(result.error){setError('Não foi possível consultar as autorizações.');return;}const profiles=await fetchPublicProfiles(result.data.flatMap(row=>[row.user_id,row.granted_by,row.revoked_by]).filter(Boolean));setPeople(profiles);setRows(result.data);},[]);
 useEffect(()=>{void load();},[load]);useDomainRealtime('platform-access-admin','admin',['platform_access_exceptions'],load);
 const change=async(id,allowed)=>{if(busy)return;setBusy(true);setError('');try{const result=await supabase.rpc('admin_set_platform_exception',{p_user_id:id,p_allowed:allowed,p_reason:reason.trim()});if(result.error)throw result.error;setPerson('');setReason('');await load();}catch(failure){console.error('Ação administrativa',failure);setError(userErrorMessage(failure));}finally{setBusy(false);}};
 return <section className="space-y-4 rounded-xl border p-4"><h3 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-emerald-400"/>Acesso durante manutenção e em breve</h3><p className="text-sm text-muted-foreground">Administradores têm acesso por padrão. Autorizações individuais não concedem privilégios administrativos e não liberam operações durante um Reset Geral em execução.</p><div><Label>Conta autorizada</Label><CitizenSelector value={person} onChange={setPerson} disabled={busy}/></div><div><Label htmlFor="exception-reason">Justificativa da concessão ou revogação</Label><Input id="exception-reason" minLength={5} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></div>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={busy||!person||reason.trim().length<5} onClick={()=>change(person,true)}>{busy&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Conceder acesso</Button><div className="space-y-3">{rows.map(row=><article key={row.user_id} className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm"><p className="font-semibold">{people.get(row.user_id)?.full_name||'Conta cadastrada'} · {row.revoked_at?'Revogado':'Autorizado'}</p><p className="text-xs text-muted-foreground">Concedido por {people.get(row.granted_by)?.full_name||'Administrador'} em {formatDateTimeBR(row.granted_at)}{row.revoked_at&&<> · Revogado por {people.get(row.revoked_by)?.full_name||'Administrador'} em {formatDateTimeBR(row.revoked_at)}</>}</p><p>{row.reason}</p>{!row.revoked_at&&<Button size="sm" variant="destructive" disabled={busy||reason.trim().length<5} onClick={()=>change(row.user_id,false)}>Revogar acesso</Button>}</article>)}</div></section>;
}
