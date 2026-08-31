import React, { lazy, Suspense } from 'react';
import { Gavel, Loader2 } from 'lucide-react';

const AuthorityJusticeDashboard = lazy(
  () => import('@/features/justice/pages/AuthorityJusticeDashboard')
);

const JusticeSystem = () => (
  <div className="space-y-6">
    <div className="rounded-xl border border-border/70 bg-muted/25 p-4">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <Gavel className="h-5 w-5 text-violet-300" /> Administração da Justiça
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Investigações, processos, audiências, decisões, recursos e cumprimento de penas em um fluxo único.
      </p>
    </div>
    <Suspense fallback={(
      <div className="flex min-h-[320px] items-center justify-center" role="status" aria-label="Carregando Justiça">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )}>
      <AuthorityJusticeDashboard />
    </Suspense>
  </div>
);

export default JusticeSystem;
