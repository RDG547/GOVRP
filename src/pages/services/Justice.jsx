import JudicialGovernance from '@/components/justice/JudicialGovernance';
import ServiceAccess from '@/components/ServiceAccess';
import { JUSTICE_AUTHORITY_ROLES, primaryJusticeRole } from '@/lib/justice/constants';
import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import { Gavel, Loader2, ShieldCheck, User } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import CitizenJusticeDashboard from '@/features/justice/pages/CitizenJusticeDashboard';
import AuthorityJusticeDashboard from '@/features/justice/pages/AuthorityJusticeDashboard';
import RpClock from '@/features/justice/components/RpClock';
import { fetchRpTimeSettings } from '@/lib/justice/api';
import { hasAnyJusticeRole } from '@/lib/justice/constants';

const Justice = ({ defaultView = 'citizen' }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [timeSettings, setTimeSettings] = useState(null);
  const [loadingClock, setLoadingClock] = useState(true);
  const [showGovernance, setShowGovernance] = useState(false);
  const hasAuthorityAccess = useMemo(() => hasAnyJusticeRole(user), [user]);
  const requestedView = searchParams.get('view') || defaultView;
  const activeView = requestedView === 'authority' && hasAuthorityAccess
    ? 'authority'
    : 'citizen';

  useEffect(() => {
    let mounted = true;

    fetchRpTimeSettings()
      .then((settings) => {
        if (mounted) setTimeSettings(settings);
      })
      .catch((error) => {
        toast({
          title: 'Relógio oficial indisponível',
          description: error.message,
          variant: 'destructive',
        });
      })
      .finally(() => {
        if (mounted) setLoadingClock(false);
      });

    return () => {
      mounted = false;
    };
  }, [toast]);

  const changeView = (view) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', view);
    setSearchParams(nextParams, { replace: true });
  };

  if (hasAuthorityAccess && !searchParams.has('view') && defaultView === 'citizen') {
    return <ServiceAccess requiredRoles={JUSTICE_AUTHORITY_ROLES} title="Como deseja acessar?" panelLabel={`Acessar como ${primaryJusticeRole(user)}`} citizenPath="/services/justice?view=citizen" panelPath="/services/justice?view=authority" />;
  }

  return (
    <>
      <Helmet>
        <title>Segurança e Justiça - GOV.RP</title>
        <meta
          name="description"
          content="Sistema jogável de ocorrências, investigações, processos, decisões e execução penal do GOV.RP."
        />
      </Helmet>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={Gavel}
          title="Segurança e"
          gradientText="Justiça"
          description="Denúncias viram missões, investigações viram processos e cada decisão deixa consequências no universo do GOVRP."
          iconColor="text-amber-300"
          centered
        />

        <div className="mb-8 space-y-4">
          {loadingClock ? (
            <div className="flex h-16 items-center justify-center rounded-xl border border-border/70">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <RpClock settings={timeSettings} />
          )}

          {hasAuthorityAccess ? (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/70 bg-muted/30 p-2">
              <Button
                variant={activeView === 'citizen' ? 'default' : 'ghost'}
                onClick={() => changeView('citizen')}
              >
                <User className="mr-2 h-4 w-4" />
                Minha vida jurídica
              </Button>
              <Button
                variant={activeView === 'authority' ? 'default' : 'ghost'}
                onClick={() => changeView('authority')}
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                Meu painel de trabalho
              </Button>
            </div>
          ) : null}
        </div>

        <div className="mb-6 space-y-3"><Button variant="outline" aria-expanded={showGovernance} onClick={() => setShowGovernance(current=>!current)}><Gavel className="mr-2 h-4 w-4"/>STF, sabatinas e mandatos</Button>{showGovernance&&<JudicialGovernance/>}</div>
        {activeView === 'authority'
          ? <AuthorityJusticeDashboard />
          : <CitizenJusticeDashboard />}
      </div>
    </>
  );
};

export default Justice;
