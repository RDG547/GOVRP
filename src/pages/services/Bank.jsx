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
            const { data: account, error: accountError } = await supabase
                .from('accounts')
                .select('*')
                .eq('user_id', targetUserId)
                .single();

            if (accountError && accountError.code !== 'PGRST116') {
                throw accountError;
            }

            if (!account) {
                setBankData(null);
                setLoading(false);
                return;
            }
            
            const [{ data: transactions }, { data: cards }, { data: investments }, { data: loans }, { data: investmentOptions }] = await Promise.all([
              supabase.rpc('get_user_transactions', { p_user_id: targetUserId }),
              supabase.from('cards').select('*').eq('user_id', targetUserId),
              supabase.from('user_investments').select('*, investment_option:investment_options(*)').eq('user_id', targetUserId),
              supabase.from('loan_applications').select('*').eq('user_id', targetUserId).order('created_at', { ascending: false }),
              supabase.from('investment_options').select('*')
            ]);
            
            setBankData({
                account,
                transactions: transactions || [],
                cards: cards || [],
                investments: investments || [],
                loans: loans || [],
                investmentOptions: investmentOptions || [],
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