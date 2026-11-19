import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useWorldRuntime } from '@/contexts/WorldRuntimeContext';
import { usePlatformAccess } from '@/contexts/PlatformAccessContext';
import { ServiceSuspensionContext } from '@/contexts/ServiceSuspensionContext';
import { resolveGlobalServiceMode } from '@/lib/serviceCatalog';
import ComingSoon from '@/pages/ComingSoon';
import MaintenanceMode from '@/pages/MaintenanceMode';
import { Button } from '@/components/ui/button';

const entryPaths=new Set(['/login','/auth/callback','/forgot-password','/update-password','/support','/terms','/privacy','/donation']);
export default function GlobalSiteAvailabilityGate({pathname='/',isAdmin=false,children}) {
 const runtime=useWorldRuntime(),access=usePlatformAccess(),[wasAvailable,setWasAvailable]=useState(false);
 const bypass=isAdmin||access?.bypass||entryPaths.has(pathname);
 const loading=!bypass&&access?.loading;
 const resetBlocked=runtime?.maintenance&&!isAdmin&&!entryPaths.has(pathname);
 const mode=resetBlocked?'maintenance':bypass?'active':resolveGlobalServiceMode(access?.settings);
 const available=!loading&&mode==='active'&&(!access?.error||bypass||access?.allowed);
 useEffect(()=>{if(available)setWasAvailable(true);},[available]);
 return <>
  {loading&&<p role="status" className="flex min-h-[60dvh] items-center justify-center gap-3"><Loader2 className="h-8 w-8 animate-spin"/>Verificando disponibilidade…</p>}
  {!loading&&!available&&(mode==='coming_soon'?<ComingSoon serviceName="GOV.RP" serviceDescription="Estamos preparando a próxima etapa do nosso mundo."/>:access?.error&&mode==='active'?<div className="mx-auto max-w-lg p-8 text-center" role="alert"><p>Não foi possível verificar a disponibilidade da plataforma.</p><Button onClick={access.refresh}>Tentar novamente</Button></div>:<MaintenanceMode serviceName="GOV.RP" serviceDescription={resetBlocked?'O universo está sendo preparado para uma nova geração. A reabertura ocorrerá após a verificação.':'Estamos realizando melhorias. O acesso será liberado automaticamente quando concluirmos.'}/>)}
  {(wasAvailable||available)&&<ServiceSuspensionContext.Provider value={!available}><div hidden={!available} inert={!available?'':undefined}>{children}</div></ServiceSuspensionContext.Provider>}
 </>;
}
