import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Landmark } from 'lucide-react';
import OpenAccount from '@/components/bank/OpenAccount';
import BankDashboard from '@/components/bank/BankDashboard';
import TransferDialog from '@/components/bank/TransferDialog';
import PayBillDialog from '@/components/bank/PayBillDialog';
import PageHeader from '@/components/layout/PageHeader';

const Bank = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [bankData, setBankData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
    const [isPayBillDialogOpen, setIsPayBillDialogOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("overview");

    const fetchBankData = useCallback(async (preserveTab = false) => {
        if (!user) return;
        if (!preserveTab) {
            setLoading(true);
        }

        const targetUserId = user.id;

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
            ] = await Promise.all([
              supabase.rpc('get_user_transactions', { p_user_id: targetUserId }),
              supabase.from('cards').select('*').eq('user_id', targetUserId),
              supabase.from('user_investments').select('*, investment_option:investment_options(*)').eq('user_id', targetUserId),
              supabase.from('loan_applications').select('*').eq('user_id', targetUserId).order('created_at', { ascending: false }),
              supabase.from('investment_options').select('*').order('annual_return_rate', { ascending: true })
            ]);

            const queryError =
              transactionsResponse.error ||
              cardsResponse.error ||
              investmentsResponse.error ||
              loansResponse.error ||
              investmentOptionsResponse.error;

            if (queryError) {
              console.error("Error fetching complementary bank data:", queryError);
              toast({
                title: "Dados bancários parcialmente carregados",
                description: "Sua conta foi encontrada, mas alguns dados complementares não puderam ser carregados.",
                variant: "destructive",
              });
            }
            
            setBankData({
                account,
                transactions: transactionsResponse.data || [],
                cards: cardsResponse.data || [],
                investments: investmentsResponse.data || [],
                loans: loansResponse.data || [],
                investmentOptions: (investmentOptionsResponse.data || []).filter((option) => option.is_active !== false),
            });

        } catch (error) {
            console.error("Error fetching bank data:", error);
            toast({
                title: "Erro ao carregar dados",
                description: "Não foi possível buscar os dados da sua conta bancária.",
                variant: "destructive",
            });
        } finally {
            if (!preserveTab) {
                setLoading(false);
            }
        }
    }, [user, toast]);

    useEffect(() => {
        if (user) {
            fetchBankData();
        }
    }, [fetchBankData, user]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
            </div>
        );
    }
    
    if (!bankData?.account) {
        return <OpenAccount onAccountCreated={() => fetchBankData(false)} />;
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
                    loanApplications={bankData.loans}
                    onUpdate={(preserveTab) => fetchBankData(preserveTab)}
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
