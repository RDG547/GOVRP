import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Minus, PiggyBank, Briefcase } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { motion } from 'framer-motion';

const InvestmentActionModal = ({ isOpen, setIsOpen, action, investment, onActionSuccess }) => {
    const [amount, setAmount] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const title = action === 'invest' ? 'Investir' : 'Sacar';
    const investmentName = investment?.investment_option?.name || investment?.name;
    const description = action === 'invest'
        ? `Quanto você gostaria de investir em ${investmentName}?`
        : `Você tem ${formatCurrency((investment?.amount_invested || 0) * 100)} investido. Quanto gostaria de sacar?`;

    const handleAction = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        const numericAmount = parseCurrency(amount);

        if (numericAmount <= 0) {
            toast({ title: "Valor inválido", description: "O valor deve ser maior que zero.", variant: "destructive" });
            setIsLoading(false);
            return;
        }

        const rpcName = action === 'invest' ? 'invest' : 'withdraw';
        const params = action === 'invest'
            ? { p_investment_id: investment.id, p_amount: numericAmount }
            : { p_user_investment_id: investment.id, p_amount: numericAmount };

        const { data, error } = await supabase.rpc(rpcName, params);

        if (error || !data.success) {
            toast({ title: "Erro", description: data?.message || error?.message || "Ocorreu um erro.", variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            setIsOpen(false);
            setAmount('');
            onActionSuccess();
        }
        setIsLoading(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!isLoading) setIsOpen(open) }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title} em {investmentName}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAction} className="space-y-4 pt-4">
                    <div>
                        <Label htmlFor="amount">{`Valor para ${title.toLowerCase()}`}</Label>
                        <Input id="amount" value={amount} onChange={(e) => setAmount(formatCurrency(e.target.value))} placeholder="R$ 0,00" required />
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={isLoading}>{isLoading ? <Loader2 className="animate-spin" /> : title}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const RiskBadge = ({ level }) => {
    const riskStyles = {
        'low': 'bg-green-500/20 text-green-300',
        'medium': 'bg-yellow-500/20 text-yellow-300',
        'high': 'bg-red-500/20 text-red-300',
        'very-high': 'bg-purple-500/20 text-purple-300',
    };
    const riskLabels = {
        'low': 'Baixo',
        'medium': 'Médio',
        'high': 'Alto',
        'very-high': 'Muito Alto',
    };
    return <span className={`px-2 py-1 text-xs font-medium rounded-full ${riskStyles[level]}`}>{riskLabels[level]}</span>;
}

const InvestmentsTab = ({ investmentOptions, userInvestments, onUpdate }) => {
    const [modalState, setModalState] = useState({ isOpen: false, action: '', investment: null });
    const [activeTab, setActiveTab] = useState('portfolio');
    const [riskFilter, setRiskFilter] = useState('all');

    const openModal = (action, investment) => {
        setModalState({ isOpen: true, action, investment });
    };

    const riskOrder = ['low', 'medium', 'high', 'very-high'];
    const riskLabels = {
        'all': 'Todos',
        'low': 'Baixo Risco',
        'medium': 'Médio Risco',
        'high': 'Alto Risco',
        'very-high': 'Muito Alto Risco',
    };

    const filteredOptions = useMemo(() => {
        if (riskFilter === 'all') return investmentOptions;
        return investmentOptions.filter(opt => opt.risk_level === riskFilter);
    }, [investmentOptions, riskFilter]);

    return (
        <>
            <div className="mt-4">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="portfolio"><PiggyBank className="mr-2 h-4 w-4" />Meu Portfólio</TabsTrigger>
                        <TabsTrigger value="opportunities"><Briefcase className="mr-2 h-4 w-4" />Oportunidades</TabsTrigger>
                    </TabsList>
                    <TabsContent value="portfolio" className="mt-4">
                        <Card className="glass-effect">
                            <CardHeader className="text-center">
                                <CardTitle className="text-white justify-center">Seu Portfólio de Investimentos</CardTitle>
                                <CardDescription>Acompanhe e gerencie seus ativos.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {userInvestments && userInvestments.length > 0 ? userInvestments.map(inv => (
                                    <motion.div initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} key={inv.id} className="p-4 rounded-lg bg-slate-800/50 flex justify-between items-center">
                                        <div>
                                            <h4 className="font-bold text-white">{inv.investment_option.name}</h4>
                                            <RiskBadge level={inv.investment_option.risk_level} />
                                            <p className="text-lg font-bold text-green-400 mt-1">{formatCurrency(inv.amount_invested * 100)}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button size="icon" variant="outline" className="bg-green-500/10 border-green-500/30 hover:bg-green-500/20" onClick={() => openModal('invest', inv.investment_option)}><Plus className="h-4 w-4 text-green-300"/></Button>
                                            <Button size="icon" variant="destructive" onClick={() => openModal('withdraw', inv)}><Minus className="h-4 w-4"/></Button>
                                        </div>
                                    </motion.div>
                                )) : (
                                    <div className="text-center py-8 text-gray-400">Você ainda não possui investimentos. Explore as oportunidades!</div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                     <TabsContent value="opportunities" className="mt-4">
                         <Card className="glass-effect">
                             <CardHeader className="text-center">
                                 <CardTitle className="text-white justify-center">Opções Para Investir</CardTitle>
                                 <CardDescription>Explore oportunidades para fazer seu dinheiro render.</CardDescription>
                             </CardHeader>
                             <CardContent className="space-y-6">
                                <div className="flex flex-wrap gap-2 justify-center my-4">
                                    {Object.keys(riskLabels).map(risk => (
                                        <Button
                                            key={risk}
                                            variant={riskFilter === risk ? 'default' : 'outline'}
                                            onClick={() => setRiskFilter(risk)}
                                        >
                                            {riskLabels[risk]}
                                        </Button>
                                    ))}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {filteredOptions.map(opt => (
                                        <motion.div initial={{opacity: 0, scale: 0.95}} animate={{opacity: 1, scale: 1}} key={opt.id} className="p-4 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 transition-colors flex flex-col justify-between">
                                            <div>
                                                <div className="flex justify-between items-start">
                                                    <h4 className="font-bold text-white flex-1 mr-2">{opt.name}</h4>
                                                    <RiskBadge level={opt.risk_level} />
                                                </div>
                                                <p className="text-sm text-gray-400 mt-2 min-h-[40px]">{opt.description}</p>
                                            </div>
                                            <div className="flex justify-between items-end mt-4">
                                                <div>
                                                    <p className="text-xs text-gray-400">Rentabilidade</p>
                                                    <p className="text-lg font-bold text-green-400">{(opt.annual_return_rate * 100).toFixed(0)}% a.a.</p>
                                                </div>
                                                <Button size="sm" onClick={() => openModal('invest', opt)}>Investir</Button>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                                {filteredOptions.length === 0 && (
                                    <p className="text-center text-muted-foreground py-4">Nenhuma opção de investimento encontrada para esta categoria.</p>
                                )}
                             </CardContent>
                         </Card>
                    </TabsContent>
                </Tabs>
            </div>
            <InvestmentActionModal {...modalState} setIsOpen={(isOpen) => setModalState(s => ({...s, isOpen}))} onActionSuccess={onUpdate} />
        </>
    );
};

export default InvestmentsTab;