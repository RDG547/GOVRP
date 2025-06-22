
import React from 'react';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";

const BalanceCard = ({ account }) => {
  const { toast } = useToast();
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast({ description: "Copiado!" });
  };

  return (
    <div className="bg-black/20 rounded-2xl p-6 text-center">
      <h2 className="text-lg font-bold text-gray-300 mb-2">Saldo em Conta</h2>
      <p className="text-5xl font-black gradient-text mb-4">
        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(account?.balance || 0)}
      </p>
      <div className="text-gray-400 text-sm space-y-1">
        <p>Agência: {account?.agency_number}</p>
        <div className="flex items-center justify-center gap-2">
          <p>Conta: {account?.account_number}</p>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(account?.account_number)}>
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BalanceCard;
