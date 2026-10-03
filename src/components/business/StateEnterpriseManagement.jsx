import { usePublicCompanyChanges } from '@/hooks/use-public-company-changes';
import React, { useCallback, useEffect, useState } from 'react';
import { Settings, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import MarketplaceManagement from './MarketplaceManagement';
import CitizenOfferManagement from './CitizenOfferManagement';
import HousingPolicy from './HousingPolicy';
import { EnterpriseDetailView } from './EnterpriseOperations';

export default function StateEnterpriseManagement({ enterpriseId, serviceKey, sector, open: controlledOpen, onOpenChange, onUpdated, showTrigger = false }) {
 const {user}=useAuth(); const [localOpen,setLocalOpen]=useState(false),[enterprise,setEnterprise]=useState(null),[allowed,setAllowed]=useState(false),[regions,setRegions]=useState([]),[failure,setFailure]=useState('');
 const open=controlledOpen===undefined?localOpen:controlledOpen;
 const setOpen=value=>{setLocalOpen(value);onOpenChange?.(value);};
 const load=useCallback(async()=>{
  if(!user?.id || (!enterpriseId&&!serviceKey&&!sector)){setAllowed(false);return;}
  let query=supabase.from('state_enterprises').select('*');
  query=enterpriseId?query.eq('id',enterpriseId):serviceKey?query.eq('service_key',serviceKey):query.eq('sector',sector);
  const result=await query.limit(1).maybeSingle();
  if(result.error){setAllowed(false);setFailure('Não foi possível consultar a gestão.');return;}
  setEnterprise(result.data);
  const access=result.data?await supabase.rpc('can_manage_state_enterprise',{p_enterprise_id:result.data.id}):{data:false};
  setAllowed(Boolean(access.data));setFailure('');
 },[enterpriseId,serviceKey,sector,user?.id,user?.role]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(open&&allowed&&enterprise?.service_key==='national_housing')supabase.from('economic_regions').select('code,name').order('name').then(result=>{if(!result.error)setRegions(result.data||[]);});},[open,allowed,enterprise?.service_key]);
 useDomainRealtime('state-enterprise-management',user?.id,['state_enterprises','profiles'],load,Boolean(user?.id));
 usePublicCompanyChanges(load,Boolean(user?.id));
 if(!allowed||!enterprise)return open&&failure?<p role="alert">{failure}</p>:null;
 const changed=()=>{void load();onUpdated?.();};
 return <>{(showTrigger||controlledOpen===undefined)&&<Button variant="outline" onClick={()=>setOpen(true)}><Settings className="mr-2 h-4 w-4"/>Gerenciar</Button>}{enterprise.service_key==='marketplace'?<MarketplaceManagement open={open} onOpenChange={setOpen}/>:<Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto [&>*]:min-w-0"><DialogHeader className="pr-5"><DialogTitle>Gerenciar {enterprise.name}</DialogTitle><DialogDescription>{enterprise.is_privatized?'Gestão da operadora privada':'Gestão institucional da estatal'}. As alterações valem para novas operações.</DialogDescription></DialogHeader>{open&&<div className="space-y-6">{enterprise.service_key==='national_housing'&&<HousingPolicy enterprise={enterprise} regions={regions} onSaved={changed}/ >}{['national_housing','national_market'].includes(enterprise.service_key)&&<CitizenOfferManagement enterprise={enterprise} regions={regions} onSaved={changed}/>}<EnterpriseDetailView key={enterprise.id} enterprise={enterprise} onBack={()=>setOpen(false)} onUpdate={changed}/></div>}</DialogContent></Dialog>}</>;
}
