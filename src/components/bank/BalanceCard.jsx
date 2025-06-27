
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, KeyRound, Loader2 } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';

const BalanceCard = ({ account, onUpdate }) => {
  const { toast } = useToast();
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast({ description: "Chave de transferência copiada!" });
  };
  
  const generateTransferKey = async () => {
    setIsGeneratingKey(true);
    const { data, error } = await supabase.rpc('generate_transfer_key_for_user');
    if (error || !data.success) {
      toast({ title: 'Erro ao gerar chave', description: data?.message || error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Sucesso!', description: data.message });
      onUpdate();
    }
    setIsGeneratingKey(false);
  };


  return (
    <div className="bg-black/20 rounded-2xl p-6 text-center">
      <h2 className="text-lg font-bold text-gray-300 mb-2">Saldo em Conta</h2>
      <p className="text-5xl font-black gradient-text mb-4">
        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(account?.balance || 0)}
      </p>
      <div className="text-gray-400 text-sm space-y-2">
        <p>Agência: {account?.agency_number} / Conta: {account?.account_number}</p>
        
        {account?.transfer_key ? (
          <div className="flex items-center justify-center gap-2">
            <p>Chave de Transferência: <span className="font-bold text-white tracking-widest">{account.transfer_key}</span></p>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(account?.transfer_key)}>
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <Button onClick={generateTransferKey} disabled={isGeneratingKey} variant="secondary" size="sm">
            {isGeneratingKey ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2"/>}
            Gerar Chave de Transferência
          </Button>
        )}
      </div>
    </div>
  );
};

export default BalanceCard;
