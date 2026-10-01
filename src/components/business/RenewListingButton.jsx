import { marketplacePolicy } from '@/lib/marketplaceFees';
import React, { useRef, useState } from 'react';
import { Check, Loader2, RotateCw, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import ListingCosts from './ListingCosts';
export default function RenewListingButton({ product, enterprise: source, onRenewed }) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),{toast}=useToast(),key=useRef(null);
  const enterprise=marketplacePolicy(source,Boolean(product.business_id),true);
  const needsRenewal=product.listing_status==='awaiting_renewal'||(enterprise?.active_listing_fee_enabled&&Number(enterprise.active_listing_fee_amount)>0&&product.listing_paid_until&&Date.parse(product.listing_paid_until)<=Date.now());
  if(!needsRenewal)return product.listing_paid_until?<p className="mt-2 text-xs text-muted-foreground">Anúncio válido até {new Date(product.listing_paid_until).toLocaleString('pt-BR')}</p>:null;
  const renew=async()=>{if(busy||!enterprise)return;setBusy(true);const r=await supabase.rpc('renew_marketplace_listing',{p_product_id:product.id,p_confirmed_fee:enterprise.active_listing_fee_enabled?Number(enterprise.active_listing_fee_amount):0,p_period_days:enterprise.active_listing_fee_period,p_idempotency_key:key.current});setBusy(false);if(r.error)toast({title:'Renovação não concluída',description:r.error.message,variant:'destructive'});else{toast({title:'Anúncio renovado'});setOpen(false);onRenewed?.();}};
  return <div className="mt-3 space-y-2"><p className="text-sm text-amber-400">Aguardando renovação</p><Button size="sm" variant="outline" onClick={()=>{key.current=crypto.randomUUID();setOpen(true);}}><RotateCw className="mr-2 h-4 w-4"/>Renovar anúncio</Button><Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent><DialogHeader><DialogTitle>Renovar anúncio</DialogTitle><DialogDescription>{product.name}. {product.business_id?'A taxa será paga pela conta da empresa.':'A taxa será paga pela sua conta pessoal.'}</DialogDescription></DialogHeader><ListingCosts enterprise={source} business={Boolean(product.business_id)} renewal/><DialogFooter><Button disabled={busy} variant="outline" onClick={()=>setOpen(false)}><X className="mr-2 h-4 w-4"/>Cancelar</Button><Button disabled={busy||!enterprise} onClick={renew}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Check className="mr-2 h-4 w-4"/>}Confirmar e renovar</Button></DialogFooter></DialogContent></Dialog></div>;
}
