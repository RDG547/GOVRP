import React, { useEffect, useState } from 'react';
import { ShieldBan, ShieldCheck, AlertTriangle, Loader2, Monitor, Globe, Mail, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { fetchWithSessionAuth } from '@/lib/apiAuth';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

const defaultScope={email:true,username:true,citizen_name:true,ip:true,devices:true};
const options=[
  {key:'email',label:'E-mail da conta',icon:Mail,desc:'Bloquear novos cadastros usando este e-mail.'},
  {key:'username',label:'Nome de usuário',icon:UserRound,desc:'Impedir o uso do mesmo @username durante a criação do personagem.'},
  {key:'citizen_name',label:'Nome do cidadão',icon:UserRound,desc:'Impedir que outro personagem utilize o mesmo nome civil.'},
  {key:'ip',label:'IPs associados à conta',icon:Globe,desc:'Pode atingir outras pessoas que compartilham a mesma rede.'},
  {key:'devices',label:'Navegadores já vinculados',icon:Monitor,desc:'Identifica instalações do navegador, não o hardware físico.'}
];
export default function UserBanDialog({user,onFinish,onUpdate}){
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [context,setContext]=useState(null);
  const [reason,setReason]=useState('');
  const [scope,setScope]=useState(defaultScope);
  const {toast}=useToast();
  useEffect(()=>{
    let active=true;
    (async()=>{
      const {data,error}=await supabase.rpc('govrp_admin_ban_context',{p_user_id:user.id});
      if(active){
        if(error) toast({title:'Falha ao carregar histórico',description:error.message,variant:'destructive'});
        else setContext(data);
        setLoading(false);
      }
    })();
    return()=>{active=false;};
  },[user.id,toast]);
  const call=async action=>{
    if(busy)return;
    if(action==='ban' && reason.trim().length<10){
      toast({title:'Motivo obrigatório',description:'Descreva o motivo do banimento em pelo menos 10 caracteres.',variant:'destructive'});return;
    }
    setBusy(true);
    try{
      const response=await fetchWithSessionAuth('/api/admin/ban-user',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,userId:user.id,reason:reason.trim(),scope})
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.success)throw new Error(data.error||'Não foi possível alterar o banimento.');
      toast({title:action==='ban'?'Conta banida':'Banimento revogado',description:action==='ban'?'Os identificadores conhecidos foram adicionados à lista de restrições.':'O acesso foi restaurado e o registro de auditoria foi preservado.'});
      onUpdate?.();
      onFinish?.();
    }catch(error){
      toast({title:'Falha na moderação',description:error.message,variant:'destructive'});
    }finally{setBusy(false);}
  };
  if(loading)return <DialogContent className="max-w-xl"><Loader2 className="mx-auto my-10 h-7 w-7 animate-spin"/></DialogContent>;
  const active=context?.current_ban;
  const ips=context?.ips||[];
  const devices=context?.devices||[];
  return <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        {active?<ShieldBan className="h-5 w-5 text-red-400"/>:<ShieldCheck className="h-5 w-5 text-amber-400"/>}
        {active?'Banimento ativo':'Restringir acesso'} — {user.full_name||user.username}
      </DialogTitle>
      <DialogDescription>Medida administrativa da comunidade (OOC). Não constitui punição jurídica do personagem.</DialogDescription>
    </DialogHeader>
    <div className="space-y-4 py-2">
      {active ? <>
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3">
          <Badge variant="destructive">Banimento ativo</Badge>
          <p className="mt-2 whitespace-pre-wrap text-sm">{active.reason}</p>
          <p className="mt-2 text-xs text-muted-foreground">Aplicado: {new Date(active.created_at).toLocaleString('pt-BR')}</p>
          <p className="mt-1 text-xs text-muted-foreground">IPs incluídos: {active.ip_count} • Navegadores incluídos: {active.device_count}</p>
        </div>
      </> : <>
        <div className="space-y-1">
          <p className="text-sm font-semibold">Identificadores vinculados à conta</p>
          <p className="text-xs text-muted-foreground">E-mail: {context?.email||user.email||'—'} • Usuário: @{user.username||'—'} • Cidadão: {user.full_name||'—'}</p>
          <p className="text-xs text-muted-foreground">IPs conhecidos ({ips.length}): {ips.length?ips.join(' • '):'nenhum IP registrado'}</p>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Navegadores vinculados ({devices.length}):</p>
            {devices.length ? devices.slice(0,8).map((d,i)=>
              <div key={i} className="rounded-md border px-2 py-1 text-xs">
                <span className="font-medium">Identificador …{d.hash_suffix}</span> • {d.user_agent||'Navegador desconhecido'}
                <p className="text-muted-foreground">{d.last_ip||'IP desconhecido'} • {d.last_seen_at?new Date(d.last_seen_at).toLocaleString('pt-BR'):'Sem data'}</p>
              </div>
            ) : <p className="text-xs text-muted-foreground">A identificação começa após o próximo login registrado pelo novo sistema. Histórico de user-agent não permite reconhecer um dispositivo com segurança.</p>}
          </div>
        </div>
        <div className="space-y-3 rounded-lg border p-3">
          <p className="font-medium">O que deve continuar bloqueado após o banimento?</p>
          {options.map(({key,label,icon:Icon,desc})=>
            <div key={key} className="flex items-start gap-3">
              <Checkbox id={'security-'+key} checked={scope[key]} onCheckedChange={v=>setScope(prev=>({...prev,[key]:v===true}))}/>
              <div className="flex-1">
                <Label htmlFor={'security-'+key} className="flex cursor-pointer items-center gap-2"><Icon className="h-4 w-4"/>{label}</Label>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="security-reason">Motivo do banimento (obrigatório)</Label>
          <Textarea id="security-reason" rows={4} maxLength={1000} value={reason}
            onChange={e=>setReason(e.target.value)} placeholder="Informe a infração e os fundamentos da decisão administrativa."/>
          <p className="text-xs text-muted-foreground">{reason.length}/1000 caracteres</p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/>
          A conta será bloqueada no Supabase Auth. IPs compartilhados podem bloquear outras pessoas, e o navegador pode ser redefinido apagando cookies. Senhas nunca são rastreadas ou utilizadas como identificadores.
        </div>
      </>}
      {Array.isArray(context?.history)&&context.history.length>0&&
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Histórico administrativo ({context.history.length})</summary>
          <div className="mt-2 space-y-2 text-xs">{context.history.map((h,i)=>
            <div key={i} className="border-t pt-2">
              <p>{h.reason}</p>
              <p className="text-muted-foreground">{new Date(h.created_at).toLocaleString('pt-BR')} • {h.revoked_at?'Revogado: '+new Date(h.revoked_at).toLocaleString('pt-BR'):'Ativo'}</p>
            </div>)}</div>
        </details>}
    </div>
    <DialogFooter>
      <Button type="button" variant="outline" disabled={busy} onClick={onFinish}>Cancelar</Button>
      {active
        ? <Button variant="outline" disabled={busy} onClick={()=>call('unban')}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Revogar banimento</Button>
        : <Button variant="destructive" disabled={busy||reason.trim().length<10} onClick={()=>call('ban')}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Banir conta e identificadores selecionados</Button>}
    </DialogFooter>
  </DialogContent>;
}
