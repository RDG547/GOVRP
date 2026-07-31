import React, { lazy, Suspense } from 'react';
import { Activity, CreditCard, Gavel, Landmark, Loader2, ShieldCheck } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const EmbeddedEconomyPanel = lazy(
  () => import('@/features/economy/components/EmbeddedEconomyPanel')
);
const AuthorityJusticeDashboard = lazy(
  () => import('@/features/justice/pages/AuthorityJusticeDashboard')
);
const BankManagementPanel = lazy(
  () => import('@/components/bank/BankManagementPanel')
);

const PanelFallback = () => (
  <div className="flex min-h-[320px] items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const GovernanceSystems = () => (
  <Tabs defaultValue="economic-engine" className="space-y-6">
    <div className="rounded-xl border border-border/70 bg-muted/25 p-4">
      <h2 className="text-xl font-semibold">Justiça e Economia</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Operação, auditoria e decisões dos sistemas nacionais em uma única área administrativa. A disponibilidade do portal e de cada rota permanece em Sistema e Serviços.
      </p>
    </div>

    <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-muted/50 p-2 lg:grid-cols-3 xl:grid-cols-5">
      <TabsTrigger value="economic-engine">
        <Activity className="mr-2 h-4 w-4" />
        Motor econômico
      </TabsTrigger>
      <TabsTrigger value="government">
        <Landmark className="mr-2 h-4 w-4" />
        Governo
      </TabsTrigger>
      <TabsTrigger value="central-bank">
        <ShieldCheck className="mr-2 h-4 w-4" />
        Banco Central
      </TabsTrigger>
      <TabsTrigger value="national-bank">
        <CreditCard className="mr-2 h-4 w-4" />
        Banco Nacional
      </TabsTrigger>
      <TabsTrigger value="justice">
        <Gavel className="mr-2 h-4 w-4" />
        Justiça
      </TabsTrigger>
    </TabsList>

    <TabsContent value="economic-engine">
      <Suspense fallback={<PanelFallback />}>
        <EmbeddedEconomyPanel view="admin" />
      </Suspense>
    </TabsContent>
    <TabsContent value="government">
      <Suspense fallback={<PanelFallback />}>
        <EmbeddedEconomyPanel view="government" />
      </Suspense>
    </TabsContent>
    <TabsContent value="central-bank">
      <Suspense fallback={<PanelFallback />}>
        <EmbeddedEconomyPanel view="centralBank" />
      </Suspense>
    </TabsContent>
    <TabsContent value="national-bank">
      <Suspense fallback={<PanelFallback />}>
        <BankManagementPanel />
      </Suspense>
    </TabsContent>
    <TabsContent value="justice">
      <Suspense fallback={<PanelFallback />}>
        <AuthorityJusticeDashboard />
      </Suspense>
    </TabsContent>
  </Tabs>
);

export default GovernanceSystems;
