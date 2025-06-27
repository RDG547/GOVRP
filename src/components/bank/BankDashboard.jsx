
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Coins as HandCoins, Landmark, Receipt } from 'lucide-react';
import BalanceCard from './BalanceCard';
import TransferDialog from './TransferDialog';
import TransactionsTab from './TransactionsTab';
import CardsTab from './CardsTab';
import LoansTab from './LoansTab';
import InvestmentsTab from './InvestmentsTab';
import PayBillDialog from './PayBillDialog';

const BankDashboard = ({ account, transactions, cards, investmentOptions, userInvestments, loanApplications, onUpdate }) => {
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isPayBillModalOpen, setIsPayBillModalOpen] = useState(false);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
      <div className="lg:col-span-1 space-y-6">
        <BalanceCard account={account} onUpdate={onUpdate}/>
        <div className="grid grid-cols-2 gap-4">
            <Button onClick={() => setIsTransferModalOpen(true)} size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 w-full">
              <Landmark className="mr-2 h-4 w-4"/> Transferir
            </Button>
            <Button onClick={() => setIsPayBillModalOpen(true)} size="lg" variant="outline" className="w-full">
                <Receipt className="mr-2 h-4 w-4"/> Pagar
            </Button>
        </div>
        <TransferDialog 
          isOpen={isTransferModalOpen} 
          setIsOpen={setIsTransferModalOpen} 
          onTransferSuccess={onUpdate}
        />
        <PayBillDialog
            isOpen={isPayBillModalOpen}
            setIsOpen={setIsPayBillModalOpen}
        />
      </div>
      <div className="lg:col-span-2">
        <Tabs defaultValue="extrato" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="extrato">Extrato</TabsTrigger>
            <TabsTrigger value="cartoes">Cartões</TabsTrigger>
            <TabsTrigger value="emprestimos">Empréstimos</TabsTrigger>
            <TabsTrigger value="investir">Investir</TabsTrigger>
          </TabsList>
          <TransactionsTab transactions={transactions} accountId={account?.id} />
          <CardsTab cards={cards} onUpdate={onUpdate} />
          <LoansTab loanApplications={loanApplications} onUpdate={onUpdate} />
          <InvestmentsTab 
            investmentOptions={investmentOptions} 
            userInvestments={userInvestments}
            onUpdate={onUpdate} 
          />
        </Tabs>
      </div>
    </div>
  );
};

export default BankDashboard;
