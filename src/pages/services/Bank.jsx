import {usePhoneStep} from '@/hooks/use-phone-step';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { bankRealtimeTables } from '@/lib/bankRealtime';
import { BANK_SECTIONS, bankSectionsForEvents, fetchBankSections } from '@/lib/bankData';
import { useSectionLoader } from '@/hooks/use-section-loader';
import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Landmark, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import BankWelcome from '@/components/bank/BankWelcome';
import BankDashboard from '@/components/bank/BankDashboard';
import TransferDialog from '@/components/bank/TransferDialog';
import PayBillDialog from '@/components/bank/PayBillDialog';
import PageHeader from '@/components/layout/PageHeader';

const Bank = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [bankData, setBankData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
    const [isPayBillDialogOpen, setIsPayBillDialogOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("overview");
  usePhoneStep(activeTab,setActiveTab,'overview');

    const refreshSections = useSectionLoader(user?.id,
        sections => fetchBankSections(supabase, user.id, sections),
        ({ values, errors }, sections) => {
            setBankData(previous => ({ ...Object.fromEntries(BANK_SECTIONS.map(key => [key, key === 'account' ? null : []])), ...previous, ...values }));
            if (sections.includes('account')) setLoadError(errors.includes('account') ? 'Não foi possível buscar os dados da sua conta bancária.' : '');
            if (errors.length) toast({ title: 'Dados bancários parcialmente carregados', description: 'Não foi possível atualizar algumas informações. Tente novamente.', variant: 'destructive' });
            setLoading(false);
        },
        () => { setLoadError('Não foi possível buscar os dados da sua conta bancária.'); setLoading(false); },
    );
    const fetchBankData = useCallback((preserveTab = true, sections = BANK_SECTIONS) => {
        if (!preserveTab) setLoading(true);
        return refreshSections(sections);
    }, [refreshSections]);
    useEffect(() => {
        setBankData(null);
        setLoading(true);
        if (user?.id) void fetchBankData();
        else setLoading(false);
    }, [fetchBankData, user?.id]);
    useDomainRealtime('bank', user?.id, bankRealtimeTables(user?.id),
        events => refreshSections(bankSectionsForEvents(events)), Boolean(user?.id));

    if (loading && !bankData) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
            </div>
        );
    }

    if (loadError && !bankData?.account) {
        return <div className="mx-auto max-w-lg space-y-4 px-4 py-12" role="alert">
            <p>{loadError}</p>
            <Button onClick={() => fetchBankData(false)}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button>
        </div>;
    }

    if (!bankData?.account || bankData.account.bank_welcome_completed === false) {
        return <div className="px-4 py-8"><BankWelcome initialAccount={bankData?.account} onComplete={() => fetchBankData(true)} /></div>;
    }

    return (
        <>
            <Helmet>
                <title>Banco Nacional - GOV.RP</title>
                <meta name="description" content="Gerencie suas finanças, cartões e investimentos no Banco Nacional." />
            </Helmet>
            <div className="min-h-screen container mx-auto px-4 py-8">
              <main>
                <PageHeader
                    icon={Landmark}
                    title="Banco"
                    gradientText="Nacional"
                    description="Sua vida financeira, simplificada."
                    iconColor="text-green-400"
                    centered={true}
                />
                 <BankDashboard
                    account={bankData.account}
                    transactions={bankData.transactions}
                    investmentOptions={bankData.investmentOptions}
                    userInvestments={bankData.investments}
                    investmentOperations={bankData.investmentOperations}
                    portfolioSnapshots={bankData.portfolioSnapshots}
                    loanApplications={bankData.loans}
                    onUpdate={sections => refreshSections(sections || BANK_SECTIONS)}
                    onTransferClick={() => setIsTransferDialogOpen(true)}
                    onPayClick={() => setIsPayBillDialogOpen(true)}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                />
              </main>
            </div>

            <TransferDialog isOpen={isTransferDialogOpen} setIsOpen={setIsTransferDialogOpen} onTransferSuccess={() => refreshSections(['account', 'transactions'])} />
            <PayBillDialog isOpen={isPayBillDialogOpen} setIsOpen={setIsPayBillDialogOpen} onPaymentSuccess={() => refreshSections(['account', 'transactions'])} />
        </>
    );
};

export default Bank;
