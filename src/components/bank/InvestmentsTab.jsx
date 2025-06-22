import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { TabsContent } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Banknote } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency, parseCurrency } from '@/lib/utils';
const InvestmentsTab = ({
  investmentOptions,
  onUpdate
}) => {
  const [isInvestModalOpen, setIsInvestModalOpen] = useState(false);
  const [selectedInvestment, setSelectedInvestment] = useState(null);
  const [investmentAmount, setInvestmentAmount] = useState('');
  const [isInvesting, setIsInvesting] = useState(false);
  const {
    user
  } = useAuth();
  const {
    toast
  } = useToast();
  const handleAmountChange = e => {
    setInvestmentAmount(formatCurrency(e.target.value));
  };
  const handleInvestment = async e => {
    e.preventDefault();
    setIsInvesting(true);
    const amount = parseCurrency(investmentAmount);
    const {
      error
    } = await supabase.from('user_investments').insert({
      user_id: user.id,
      investment_id: selectedInvestment.id,
      amount_invested: amount
    });
    if (error) {
      toast({
        title: "Erro",
        description: "Não foi possível realizar o investimento.",
        variant: "destructive"
      });
    } else {
      toast({
        title: "Sucesso!",
        description: `Você investiu ${formatCurrency(String(amount * 100))} em ${selectedInvestment.name}`
      });
      setIsInvestModalOpen(false);
      setSelectedInvestment(null);
      setInvestmentAmount('');
      onUpdate();
    }
    setIsInvesting(false);
  };
  return <TabsContent value="investir" className="bg-black/20 rounded-2xl p-6 mt-4 text-center">
            <Banknote className="w-16 h-16 mx-auto text-green-400 mb-4" />
            <h3 className="text-xl font-bold text-white mb-4">Investimentos</h3>
            <p className="text-gray-300 mb-6">Faça seu dinheiro render com segurança.</p>
            <Dialog open={isInvestModalOpen} onOpenChange={setIsInvestModalOpen}>
                <DialogTrigger asChild><Button>Ver Opções de Investimento</Button></DialogTrigger>
                <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>Plataforma de Investimentos</DialogTitle><DialogDescription>Selecione uma opção e o valor para investir.</DialogDescription></DialogHeader>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
                        {investmentOptions.map(opt => <div key={opt.id} onClick={() => setSelectedInvestment(opt)} className={`p-4 rounded-lg cursor-pointer border-2 ${selectedInvestment?.id === opt.id ? 'border-blue-500' : 'border-white/10'} hover:border-blue-500`}>
                                <h4 className="font-bold">{opt.name}</h4>
                                <p className="text-sm text-gray-400">{opt.risk_level}</p>
                                <p className="text-lg font-bold text-green-400">{(opt.annual_return_rate * 100).toFixed(0)}% a.a.</p>
                            </div>)}
                    </div>
                    {selectedInvestment && <form onSubmit={handleInvestment} className="space-y-4">
                            <p>Investindo em: <span className="font-bold">{selectedInvestment.name}</span></p>
                            <div>
                                <Label htmlFor="investAmount">Valor do investimento</Label>
                                <Input id="investAmount" value={investmentAmount} onChange={handleAmountChange} placeholder="R$ 0,00" required />
                            </div>
                            <DialogFooter>
                                <Button type="submit" disabled={isInvesting}>
                                    {isInvesting ? <Loader2 className="animate-spin" /> : "Investir Agora"}
                                </Button>
                            </DialogFooter>
                        </form>}
                </DialogContent>
            </Dialog>
        </TabsContent>;
};
export default InvestmentsTab;