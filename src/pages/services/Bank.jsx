import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Loader2, Landmark } from 'lucide-react';
import OpenAccount from '@/components/bank/OpenAccount';
import BankDashboard from '@/components/bank/BankDashboard';
import PageHeader from '@/components/layout/PageHeader';

const Bank = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [accountData, setAccountData] = useState({
    account: null,
    transactions: [],
    cards: [],
    investmentOptions: [],
    userInvestments: [],
    loanApplications: [],
  });
  const [loading, setLoading] = useState(true);

  const fetchBankData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (accountError && accountError.code !== 'PGRST116') throw accountError;
      
      const { data: cards, error: cardError } = await supabase
        .from('cards')
        .select('*, used_limit')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      
      if (cardError) throw cardError;
      
      const { data: investments, error: invError } = await supabase
        .from('investment_options')
        .select('*')
        .order('annual_return_rate', {ascending: false});
      
      if(invError) throw invError;
      
      const { data: loans, error: loanError } = await supabase
        .from('loan_applications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if(loanError) throw loanError;

      let transactions = [];
      let userInvestments = [];
      if (account) {
        const { data: transactionsData, error: transactionsError } = await supabase
          .from('transactions')
          .select('*, from_account:accounts!transactions_from_account_id_fkey(profiles(full_name)), to_account:accounts!transactions_to_account_id_fkey(profiles(full_name))')
          .or(`from_account_id.eq.${account.id},to_account_id.eq.${account.id}`)
          .order('created_at', { ascending: false })
          .limit(20);
        
        if (transactionsError) throw transactionsError;
        transactions = transactionsData;

        const { data: userInvestmentsData, error: userInvError } = await supabase
          .from('user_investments')
          .select('*, investment_option:investment_options(*)')
          .eq('user_id', user.id)
          .gt('amount_invested', 0)
          .order('updated_at', { ascending: false });
        
        if (userInvError) throw userInvError;
        userInvestments = userInvestmentsData;
      }
      
      setAccountData({
          account,
          transactions,
          cards: cards || [],
          investmentOptions: investments || [],
          userInvestments: userInvestments || [],
          loanApplications: loans || [],
      });

    } catch (error) {
      console.error("Error fetching bank data:", error);
      toast({ title: "Erro", description: "Não foi possível carregar os dados bancários.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    fetchBankData();
  }, [fetchBankData]);
  
  if (loading) return <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-blue-400" /></div>;

  if (!accountData.account) {
    return <OpenAccount onAccountCreated={fetchBankData} />;
  }

  return (
    <>
      <Helmet><title>Banco Nacional - GOV.RP</title><meta name="description" content="Seu centro financeiro completo no GOV.RP." /></Helmet>
       <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <PageHeader 
          icon={Landmark}
          title="Banco"
          gradientText="Nacional"
          description="Sua vida financeira, simplificada."
          iconColor="text-green-400"
        />
        <BankDashboard 
          account={accountData.account}
          transactions={accountData.transactions}
          cards={accountData.cards}
          investmentOptions={accountData.investmentOptions}
          userInvestments={accountData.userInvestments}
          loanApplications={accountData.loanApplications}
          onUpdate={fetchBankData}
        />
      </div>
    </>
  );
};

export default Bank;