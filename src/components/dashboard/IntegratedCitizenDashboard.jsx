import {useInvitations} from '@/contexts/InvitationsContext';
import CitizenInvitations from './CitizenInvitations';
import CitizenFinancialSummary from './CitizenFinancialSummary';
import CitizenLegalSummary from './CitizenLegalSummary';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Package } from 'lucide-react';
import React, { lazy, Suspense } from 'react';
import { Building2, Landmark, LayoutDashboard, Loader2, Scale } from 'lucide-react';
import CitizenDashboard from '@/components/dashboard/CitizenDashboard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const EmbeddedEconomyPanel = lazy(
  () => import('@/features/economy/components/EmbeddedEconomyPanel')
);
const Products = lazy(() => import('@/components/dashboard/Products'));
const InventoryPage = lazy(() => import('@/pages/services/InventoryPage'));

const PanelFallback = () => (
  <div className="flex min-h-[320px] items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const IntegratedCitizenDashboard = () => {
  const [params, setParams] = useSearchParams();
  const {count:invitationCount=0}=useInvitations()||{};
  const selected = ['overview','inventory','economy','business','justice','invitations'].includes(params.get('tab')) ? params.get('tab') : 'overview';
  return (
  <div className="space-y-6">
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <p className="font-semibold text-cyan-100">Central do Cidadão</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Sua rotina, poder de compra, empresas e vida jurídica agora fazem parte do mesmo painel.
        </p>
      </div>
    </div>

    <Tabs value={selected} onValueChange={tab=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('tab',tab);return next;},{replace:true,preventScrollReset:true})} className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
      <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-muted/50 p-2 lg:grid-cols-6">
        <TabsTrigger value="overview">
          <LayoutDashboard className="mr-2 h-4 w-4" />
          Visão geral
        </TabsTrigger>
        <TabsTrigger value="invitations">Meus Convites{invitationCount>0&&<span className="ml-2 rounded-full bg-primary px-2 text-xs text-primary-foreground">{invitationCount}</span>}</TabsTrigger>
        <TabsTrigger value="inventory"><Package className="mr-2 h-4 w-4"/>Meu Inventário</TabsTrigger>
        <TabsTrigger value="economy">
          <Landmark className="mr-2 h-4 w-4" />
          Meu Financeiro
        </TabsTrigger>
        <TabsTrigger value="business">
          <Building2 className="mr-2 h-4 w-4" />
          Minhas Empresas
        </TabsTrigger>
        <TabsTrigger value="justice">
          <Scale className="mr-2 h-4 w-4" />
          Minha vida jurídica
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="-mx-4 mt-0 sm:-mx-6 lg:-mx-8">
        <CitizenDashboard />
      </TabsContent>
      <TabsContent value="invitations" className="mt-6"><CitizenInvitations/></TabsContent>
      <TabsContent value="inventory" className="mt-6"><Suspense fallback={<PanelFallback/>}><InventoryPage embedded/></Suspense></TabsContent>
      <TabsContent value="economy" className="mt-6">
        <Suspense fallback={<PanelFallback />}>
          <CitizenFinancialSummary />
        </Suspense>
      </TabsContent>
      <TabsContent value="business" className="mt-6"><Button asChild variant="outline" className="mb-4"><Link to="/services/entrepreneur-portal">Administrar minhas empresas</Link></Button>
        <Suspense fallback={<PanelFallback />}>
          <EmbeddedEconomyPanel view="business" />
          <div className="mt-8"><Products/></div>
        </Suspense>
      </TabsContent>
      <TabsContent value="justice" className="mt-6">
        <Suspense fallback={<PanelFallback />}>
          <CitizenLegalSummary />
        </Suspense>
      </TabsContent>
    </Tabs>
  </div>
);
};

export default IntegratedCitizenDashboard;
