import React from 'react';
import { Building2, Landmark, LayoutDashboard, Scale } from 'lucide-react';
import CitizenDashboard from '@/components/dashboard/CitizenDashboard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EmbeddedEconomyPanel from '@/features/economy/components/EmbeddedEconomyPanel';
import CitizenJusticeDashboard from '@/features/justice/pages/CitizenJusticeDashboard';

const IntegratedCitizenDashboard = () => (
  <div className="space-y-6">
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <p className="font-semibold text-cyan-100">Central do Cidadão</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Sua rotina, poder de compra, empresas e vida jurídica agora fazem parte do mesmo painel.
        </p>
      </div>
    </div>

    <Tabs defaultValue="overview" className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
      <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-muted/50 p-2 lg:grid-cols-4">
        <TabsTrigger value="overview">
          <LayoutDashboard className="mr-2 h-4 w-4" />
          Visão geral
        </TabsTrigger>
        <TabsTrigger value="economy">
          <Landmark className="mr-2 h-4 w-4" />
          Minha economia
        </TabsTrigger>
        <TabsTrigger value="business">
          <Building2 className="mr-2 h-4 w-4" />
          Empresas
        </TabsTrigger>
        <TabsTrigger value="justice">
          <Scale className="mr-2 h-4 w-4" />
          Justiça
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="-mx-4 mt-0 sm:-mx-6 lg:-mx-8">
        <CitizenDashboard />
      </TabsContent>
      <TabsContent value="economy" className="mt-6">
        <EmbeddedEconomyPanel view="citizen" />
      </TabsContent>
      <TabsContent value="business" className="mt-6">
        <EmbeddedEconomyPanel view="business" />
      </TabsContent>
      <TabsContent value="justice" className="mt-6">
        <CitizenJusticeDashboard />
      </TabsContent>
    </Tabs>
  </div>
);

export default IntegratedCitizenDashboard;
