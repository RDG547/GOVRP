import React, { useState } from 'react';
import { Flag } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
export default function ReportProduct({ product }) {
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[saving,setSaving]=useState(false);const {toast}=useToast();
 const send=async()=>{setSaving(true);const {error}=await supabase.rpc('report_marketplace_product',{p_product_id:product.id,p_reason:reason});setSaving(false);if(error){console.error('product-report',error);toast({title:'Não foi possível enviar a denúncia',description:'Confira o motivo e sua conexão. Entre na conta para enviar.',variant:'destructive'});}else{toast({title:'Denúncia recebida',description:'A gestão do marketplace poderá analisar o anúncio.'});setOpen(false);setReason('');}};
 return <><Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={()=>setOpen(true)}><Flag className="h-4 w-4"/>Denunciar anúncio</Button><Dialog open={open} onOpenChange={value=>{if(!saving)setOpen(value);}}><DialogContent><DialogHeader><DialogTitle>Denunciar anúncio</DialogTitle><DialogDescription>{product.name}. Explique o problema para a moderação.</DialogDescription></DialogHeader><Textarea aria-label="Motivo da denúncia" minLength={20} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/><DialogFooter className="gap-2"><Button variant="outline" onClick={()=>setOpen(false)} disabled={saving}>Cancelar</Button><Button onClick={send} disabled={saving||reason.trim().length<20}>Enviar denúncia</Button></DialogFooter></DialogContent></Dialog></>;
}
