import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const PanelLoading = ({ label = 'Calculando indicadores...' }) => (
  <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-border/70">
    <Loader2 className="h-7 w-7 animate-spin text-cyan-300" />
    <p className="text-sm text-muted-foreground">{label}</p>
  </div>
);

export const PanelError = ({ message, onRetry }) => (
  <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-8 text-center">
    <AlertTriangle className="h-8 w-8 text-rose-300" />
    <div>
      <h3 className="font-semibold">Não foi possível carregar este painel</h3>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">{message}</p>
    </div>
    {onRetry ? <Button variant="outline" onClick={onRetry}>Tentar novamente</Button> : null}
  </div>
);

