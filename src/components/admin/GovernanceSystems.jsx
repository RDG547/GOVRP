import React from 'react';
import { Activity, Gavel, Landmark, ShieldCheck } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EmbeddedEconomyPanel from '@/features/economy/components/EmbeddedEconomyPanel';
import AuthorityJusticeDashboard from '@/features/justice/pages/AuthorityJusticeDashboard';

const GovernanceSystems = () => (
  <Tabs defaultValue="economic-engine" className="space-y-6">
    <div className="rounded-xl border border-border/70 bg-muted/25 p-4">
      <h2 className="text-xl font-semibold">Justiça e Economia</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Operação, auditoria e decisões dos dois sistemas nacionais em uma única área administrativa.
      </p>
    </div>

    <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-muted/50 p-2 xl:grid-cols-4">
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
      <TabsTrigger value="justice">
        <Gavel className="mr-2 h-4 w-4" />
        Justiça
      </TabsTrigger>
    </TabsList>

    <TabsContent value="economic-engine">
      <EmbeddedEconomyPanel view="admin" />
    </TabsContent>
    <TabsContent value="government">
      <EmbeddedEconomyPanel view="government" />
    </TabsContent>
    <TabsContent value="central-bank">
      <EmbeddedEconomyPanel view="centralBank" />
    </TabsContent>
    <TabsContent value="justice">
      <AuthorityJusticeDashboard />
    </TabsContent>
  </Tabs>
);

export default GovernanceSystems;
