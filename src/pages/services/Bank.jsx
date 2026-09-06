import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { bankRealtimeTables } from '@/lib/bankRealtime';
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
    const request = useRef(0);
    const [bankData, setBankData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
    const [isPayBillDialogOpen, setIsPayBillDialogOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("overview");

    const fetchBankData = useCallback(async (preserveTab = true) => {
        if (!user) return;
        if (!preserveTab) {
            setLoading(true);
        }

        const targetUserId = user.id;
        const sequence = ++request.current;

        try {
            const { data: accountData, error: accountError } = await supabase
                .from('accounts')
                .select('*')
                .eq('user_id', targetUserId)
                .limit(1)
                .maybeSingle();
            let account = accountData;

            if (accountError && accountError.code !== 'PGRST116') {
                const { data: fallbackAccountData, error: fallbackAccountError } = await supabase.rpc('get_my_bank_account');
                const fallbackAccount = Array.isArray(fallbackAccountData)
                  ? fallbackAccountData[0]
                  : fallbackAccountData;

                if (fallbackAccountError || !fallbackAccount) {
                  throw accountError;
                }

                account = fallbackAccount;
            }

            if (!account) {
                const { data: fallbackAccountData } = await supabase.rpc('get_my_bank_account');
                const fallbackAccount = Array.isArray(fallbackAccountData)
                  ? fallbackAccountData[0]
                  : fallbackAccountData;

                if (fallbackAccount) {
                  account = fallbackAccount;
                }
            }

            if (sequence !== request.current) return;
            setLoadError('');
            if (!account) {
                setBankData(null);
                setLoading(false);
                return;
            }

            const [
              transactionsResponse,
              cardsResponse,
              investmentsResponse,
              loansResponse,
              investmentOptionsResponse,
              investmentOperationsResponse,
              portfolioSnapshotsResponse,
            ] = await Promise.all([
              supabase.rpc('get_user_transactions', { p_user_id: targetUserId }),
              supabase.from('cards').select('*').eq('user_id', targetUserId),
              supabase.from('user_investments').select('*, investment_option:investment_options(*)').eq('user_id', targetUserId).eq('is_active', true),
              supabase.from('loan_applications').select('*').eq('user_id', targetUserId).order('created_at', { ascending: false }),
              supabase.from('investment_options').select('*').order('annual_return_rate', { ascending: true }),
              supabase.from('investment_operations').select('*, investment_option:investment_options(name, asset_symbol)').eq('user_id', targetUserId).order('executed_at', { ascending: false }).limit(100),
              supabase.from('investment_portfolio_snapshots').select('*').eq('user_id', targetUserId).order('captured_at', { ascending: true }).limit(120),
            ]);

            const queryError =
              transactionsResponse.error ||
              cardsResponse.error ||
              investmentsResponse.error ||
              loansResponse.error ||
              investmentOptionsResponse.error ||
              investmentOperationsResponse.error ||
              portfolioSnapshotsResponse.error;

            if (queryError) {
              console.error("Error fetching complementary bank data:", queryError);
              toast({
                title: "Dados bancários parcialmente carregados",
                description: "Sua conta foi encontrada, mas alguns dados complementares não puderam ser carregados.",
                variant: "destructive",
              });
            }

            if (sequence !== request.current) return;
            setBankData(previous => ({
                account,
                ...Object.fromEntries(Object.entries({
                    transactions: transactionsResponse, cards: cardsResponse,
                    investments: investmentsResponse, loans: loansResponse,
                    investmentOptions: investmentOptionsResponse,
                    investmentOperations: investmentOperationsResponse,
                    portfolioSnapshots: portfolioSnapshotsResponse,
                }).map(([key, response]) => [key, response.error ? (previous?.[key] || []) : key === 'investmentOptions' ? (response.data || []).filter(option => option.is_active !== false) : response.data || []])),
            }));

        } catch (error) {
            if (sequence !== request.current) return;
            setLoadError('Não foi possível buscar os dados da sua conta bancária.');
            console.error("Error fetching bank data:", error);
            toast({
                title: "Erro ao carregar dados",
                description: "Não foi possível buscar os dados da sua conta bancária.",
                variant: "destructive",
            });
        } finally {
            if (sequence === request.current) setLoading(false);
        }
    }, [user?.id, toast]);

    useEffect(() => {
        if (user) {
            fetchBankData();
        }
    }, [fetchBankData, user?.id]);

    useDomainRealtime('bank', user?.id, bankRealtimeTables(user?.id), () => fetchBankData(true), Boolean(user?.id));

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
                    cards={bankData.cards}
                    investmentOptions={bankData.investmentOptions}
                    userInvestments={bankData.investments}
                    investmentOperations={bankData.investmentOperations}
                    portfolioSnapshots={bankData.portfolioSnapshots}
                    loanApplications={bankData.loans}
                    onUpdate={() => fetchBankData(true)}
                    onTransferClick={() => setIsTransferDialogOpen(true)}
                    onPayClick={() => setIsPayBillDialogOpen(true)}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                />
              </main>
            </div>
            <TransferDialog isOpen={isTransferDialogOpen} setIsOpen={setIsTransferDialogOpen} onTransferSuccess={() => fetchBankData(true)} />
            <PayBillDialog isOpen={isPayBillDialogOpen} setIsOpen={setIsPayBillDialogOpen} onPaymentSuccess={() => fetchBankData(true)} />
        </>
    );
};

export default Bank;
