import React, { useState } from 'react';
import { Crown, Shield, UserCheck, UserMinus, MoreHorizontal, Loader2, X, Check, UserCog } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

export default function PartyMemberActions({ party, memberId, onChange }) {
  const { user } = useAuth(); const { toast } = useToast();
  const [action,setAction] = useState(null),[reason,setReason] = useState(''),[busy,setBusy] = useState(false);
  const owner = user?.id === party.owner_id || user?.role === 'Admin';
  const president = user?.id === party.president_id;
  if ((!owner&&!president)||party.status==='Encerrado') return null;
  const canExpel=memberId!==user.id&&memberId!==party.owner_id&&(owner||memberId!==party.president_id);
  const save = async () => {
    if(busy)return;setBusy(true);
    const result=action==='expel'?await supabase.rpc('expel_party_member',{p_party_id:party.id,p_member_id_to_expel:memberId,p_reason:reason}):await supabase.rpc('set_party_leadership',{p_party_id:party.id,p_member_id:memberId,p_role:action});
    setBusy(false);
    if(result.error||!result.data?.success){toast({title:'Ação não concluída',description:result.data?.message||'Confira sua permissão e a função escolhida.',variant:'destructive'});return;}
    setAction(null);setReason('');void onChange?.();toast({title:'Estrutura partidária atualizada'});
  };
  return <><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Gerenciar integrante" className="h-10 w-10 shrink-0"><MoreHorizontal className="h-5 w-5"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{[[owner && memberId !== party.owner_id && memberId !== user.id,'Dono','Transferir propriedade',Crown],[(owner||president) && memberId !== party.president_id,'Presidente','Nomear presidente',Shield],[(owner||president) && memberId !== party.vice_president_id,'Vice-Presidente','Nomear vice-presidente',UserCheck]].filter(([allowed])=>allowed).map(([,role,label,Icon])=><DropdownMenuItem key={role} onClick={()=>setAction(role)}><Icon className="mr-2 h-4 w-4"/>{label}</DropdownMenuItem>)}{memberId!==party.owner_id&&[party.president_id,party.vice_president_id].includes(memberId)&&<DropdownMenuItem onClick={()=>setAction('Membro')}><UserMinus className="mr-2 h-4 w-4"/>Retirar função de liderança</DropdownMenuItem>}{canExpel&&<DropdownMenuItem className="text-destructive" onClick={()=>setAction('expel')}><UserMinus className="mr-2 h-4 w-4"/>Expulsar integrante</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
    <Dialog open={Boolean(action)} onOpenChange={open=>{if(!open&&!busy)setAction(null);}}><DialogContent><DialogHeader className="text-center sm:text-center"><DialogTitle className="flex items-center justify-center gap-2"><UserCog className="h-5 w-5 shrink-0"/>{action==='expel'?'Expulsar integrante':'Atualizar liderança partidária'}</DialogTitle><DialogDescription>{action==='expel'?'Informe o motivo. O integrante será notificado.':`Confirme a função de ${action} para este integrante. As permissões serão atualizadas imediatamente.`}</DialogDescription></DialogHeader>{action==='expel'&&<Textarea aria-label="Motivo da expulsão" value={reason} onChange={event=>setReason(event.target.value)}/>}<DialogFooter className="gap-2 sm:justify-center sm:space-x-0"><Button variant="outline" disabled={busy} onClick={()=>setAction(null)}><X className="mr-2 h-4 w-4"/>Cancelar</Button><Button disabled={busy||(action==='expel'&&reason.trim().length<10)} onClick={save}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Check className="mr-2 h-4 w-4"/>}Confirmar</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
