import React, { useState } from 'react';
import { Trash2, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export default function DeleteElectionButton({ election, onDeleted }) {
  const { toast } = useToast();
  const [open,setOpen]=useState(false),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const remove=async()=>{
    setBusy(true);setError('');
    const result=await supabase.rpc('admin_delete_election',{p_election_id:election.id,p_confirm_history:true});
    setBusy(false);
    if(result.error){console.error('Exclusão eleitoral',result.error);setError('Não foi possível excluir esta eleição. Confira sua permissão de administrador e tente novamente.');toast({title:'Não foi possível excluir a eleição.',variant:'destructive'});return;}
    toast({title:result.data?.archived?'Eleição arquivada com histórico preservado.':'Eleição excluída com sucesso.'});setOpen(false);onDeleted?.();
  };
  return <><Button variant="destructive" size="sm" onClick={()=>{setOpen(true);setConfirmation('');setError('');}}><Trash2 className="mr-2 h-4 w-4"/>Excluir</Button><Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="text-center"><DialogHeader className="sm:text-center"><DialogTitle>Excluir eleição</DialogTitle><DialogDescription>Uma eleição sem movimentação será excluída. Se houver candidaturas, votos, apuração ou auditoria, ela será arquivada e retirada do calendário, preservando o histórico e os mandatos já concedidos.</DialogDescription></DialogHeader><label className="text-sm">Digite o nome para confirmar: <strong className="break-words">{election.name}</strong><Input aria-label="Nome da eleição para confirmar exclusão" value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="off"/></label>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter className="gap-2 sm:justify-center"><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}><X className="mr-2 h-4 w-4"/>Cancelar</Button><Button variant="destructive" disabled={busy||confirmation!==election.name} onClick={remove}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Trash2 className="mr-2 h-4 w-4"/>}Confirmar exclusão</Button></DialogFooter></DialogContent></Dialog></>;
}
