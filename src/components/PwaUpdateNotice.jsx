import React from 'react';
// eslint-disable-next-line import/no-unresolved
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PwaUpdateNotice() {
  const { needRefresh: [ready, setReady], updateServiceWorker } = useRegisterSW();
  if (!ready) return null;
  return <aside role="status" className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-xl border bg-background p-4 shadow-xl">
    <p className="font-semibold">Uma nova versão do GOVRP está disponível.</p>
    <p className="mt-1 text-sm text-muted-foreground">Finalize o que está fazendo antes de atualizar.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button size="sm" onClick={() => updateServiceWorker(true)}><RefreshCw className="mr-2 h-4 w-4" />Atualizar agora</Button>
      <Button size="sm" variant="ghost" onClick={() => setReady(false)}><X className="mr-2 h-4 w-4" />Mais tarde</Button>
    </div>
  </aside>;
}
