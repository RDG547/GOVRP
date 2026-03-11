import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditCard, PiggyBank, HeartHandshake as Handshake, Landmark, CandlestickChart } from 'lucide-react';
import BalanceCard from './BalanceCard';
import TransactionsTab from './TransactionsTab';
import CardsTab from './CardsTab';
import InvestmentsTab from './InvestmentsTab';
import LoansTab from './LoansTab';
import ExchangeTab from './ExchangeTab';

const BankDashboard = ({ account, transactions, cards, investmentOptions, userInvestments, loanApplications, onUpdate, onTransferClick, onPayClick, activeTab, setActiveTab }) => {

  return (
    <div className="space-y-6">
      <BalanceCard account={account} onUpdate={onUpdate} onTransferClick={onTransferClick} onPayClick={onPayClick} />
      <Tabs value={activeTab} className="w-full" onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1 sm:gap-2 h-auto">
          <TabsTrigger value="overview" className="text-xs sm:text-sm"><Landmark className="w-4 h-4 mr-1 sm:mr-2" />Extrato</TabsTrigger>
          <TabsTrigger value="cards" className="text-xs sm:text-sm"><CreditCard className="w-4 h-4 mr-1 sm:mr-2" />Cartões & Faturas</TabsTrigger>
          <TabsTrigger value="investments" className="text-xs sm:text-sm"><PiggyBank className="w-4 h-4 mr-1 sm:mr-2" />Investir</TabsTrigger>
          <TabsTrigger value="loans" className="text-xs sm:text-sm"><Handshake className="w-4 h-4 mr-1 sm:mr-2" />Empréstimos</TabsTrigger>
          <TabsTrigger value="exchange" className="text-xs sm:text-sm"><CandlestickChart className="w-4 h-4 mr-1 sm:mr-2" />Câmbio</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-6">
          <TransactionsTab transactions={transactions} />
        </TabsContent>
        <TabsContent value="cards" className="mt-6">
          <CardsTab account={account} onUpdate={onUpdate} />
        </TabsContent>
        <TabsContent value="investments" className="mt-6">
          <InvestmentsTab 
            investmentOptions={investmentOptions} 
            userInvestments={userInvestments}
            onUpdate={onUpdate}
          />
        </TabsContent>
        <TabsContent value="loans" className="mt-6">
          <LoansTab loanApplications={loanApplications} onUpdate={onUpdate} />
        </TabsContent>
        <TabsContent value="exchange" className="mt-6">
          <ExchangeTab onUpdate={onUpdate} account={account} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default BankDashboard;