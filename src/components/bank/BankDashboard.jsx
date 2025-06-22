
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BalanceCard from './BalanceCard';
import TransferDialog from './TransferDialog';
import TransactionsTab from './TransactionsTab';
import CardsTab from './CardsTab';
import LoansTab from './LoansTab';
import InvestmentsTab from './InvestmentsTab';

const BankDashboard = ({ account, transactions, cards, investmentOptions, onUpdate }) => {
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-12">
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white">Banco <span className="gradient-text">Nacional</span></h1>
          <p className="mt-2 text-lg text-gray-300">Sua vida financeira, simplificada.</p>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          <div className="lg:col-span-1 space-y-8">
            <BalanceCard account={account} />
            <TransferDialog 
              isOpen={isTransferModalOpen} 
              setIsOpen={setIsTransferModalOpen} 
              onTransferSuccess={onUpdate}
            >
              <Button size="lg" className="w-full bg-gradient-to-r from-blue-600 to-purple-600">
                Fazer Transferência
              </Button>
            </TransferDialog>
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
              <LoansTab />
              <InvestmentsTab investmentOptions={investmentOptions} onUpdate={onUpdate} />
            </Tabs>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default BankDashboard;
