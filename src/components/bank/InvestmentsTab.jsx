import {CurrencyInput} from '@/components/ui/currency-input';
import StockExchange from '@/pages/services/StockExchange';
import { formatLocaleBR } from '@/lib/dateTime';
import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Activity, BarChart3, Briefcase, Loader2, Minus, PiggyBank, Plus, ShieldCheck, TrendingUp, Wallet } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const InvestmentActionModal = ({ isOpen, setIsOpen, action, investment, onActionSuccess }) => {
    const [amount, setAmount] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const title = action === 'invest' ? 'Investir' : 'Sacar';
    const investmentName = investment?.investment_option?.name || investment?.name;
    const currentPrice = Number(investment?.investment_option?.current_unit_price || investment?.current_unit_price || 1);
    const availableValue = Number(investment?.quantity || 0) * currentPrice;
    const description = action === 'invest'
        ? `Quanto você gostaria de investir em ${investmentName}?`
        : `Você possui ${Number(investment?.quantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 8 })} unidades, atualmente avaliadas em ${formatCurrency(availableValue)}.`;
    const minimumAmount = Number(investment?.minimum_amount || 0);

    const handleAction = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        const numericAmount = parseCurrency(amount);

        if (numericAmount <= 0) {
            toast({ title: "Valor inválido", description: "O valor deve ser maior que zero.", variant: "destructive" });
            setIsLoading(false);
            return;
        }

        if (action === 'invest' && minimumAmount > 0 && numericAmount < minimumAmount) {
            toast({ title: "Valor abaixo do mínimo", description: `A aplicação mínima é ${formatCurrency(minimumAmount)}.`, variant: "destructive" });
            setIsLoading(false);
            return;
        }

        if (action === 'withdraw' && numericAmount > availableValue) {
            toast({ title: "Valor indisponível", description: "Você não pode sacar mais do que possui aplicado.", variant: "destructive" });
            setIsLoading(false);
            return;
        }

        try {
            const optionId = action === 'invest' ? investment.id : investment.investment_id;
            const { data, error } = await supabase.rpc('trade_investment', {
                p_investment_id: optionId,
                p_operation_type: action === 'invest' ? 'buy' : 'sell',
                p_quantity: Number((numericAmount / currentPrice).toFixed(8)),
                p_idempotency_key: crypto.randomUUID(),
            });

            if (error || !data?.success) {
                throw new Error(data?.message || error?.message || "Ocorreu um erro.");
            }

            toast({ title: "Sucesso!", description: data.message });
            setIsOpen(false);
            setAmount('');
            onActionSuccess?.(true);
        } catch (error) {
            toast({ title: "Erro", description: error.message, variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
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
                        <CurrencyInput id="amount" value={amount} onChange={(e) => setAmount(formatCurrency(e.target.value, true))} placeholder="R$ 0,00" required />
                        {action === 'invest' && minimumAmount > 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">Aplicação mínima: {formatCurrency(minimumAmount)}</p>
                        ) : null}
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
    return <span className={`px-2 py-1 text-xs font-medium rounded-full ${riskStyles[level] || riskStyles.medium}`}>{riskLabels[level] || 'Médio'}</span>;
}

const getAnnualReturnPercent = (value) => Number(value || 0) * 100;

const getInvestmentProjectedReturn = (amount, rate) =>
    Number(amount || 0) * Number(rate || 0);

const InvestmentsTab = ({ investmentOptions, userInvestments, investmentOperations = [], portfolioSnapshots = [], onUpdate }) => {
    const [stockAsset,setStockAsset] = useState('');
    const [modalState, setModalState] = useState({ isOpen: false, action: '', investment: null });
    const [activeTab, setActiveTab] = useState('portfolio');
    const [riskFilter, setRiskFilter] = useState('all');

    const openModal = (action, investment) => {
        const option = investment.investment_option || investment;
        if (option.asset_type === 'stock') { setStockAsset(option.id); setActiveTab('stocks'); return; }
        setModalState({ isOpen: true, action, investment });
    };

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

    const portfolioStats = useMemo(() => {
        const totalInvested = (userInvestments || []).reduce((sum, inv) => sum + Number(inv.amount_invested || 0), 0);
        const marketValue = (userInvestments || []).reduce((sum, inv) => sum + Number(inv.quantity || 0) * Number(inv.investment_option?.current_unit_price || 1), 0);
        const projectedAnnualReturn = (userInvestments || []).reduce(
            (sum, inv) => sum + getInvestmentProjectedReturn(inv.amount_invested, inv.investment_option?.annual_return_rate),
            0
        );
        const weightedAnnualRate = totalInvested > 0 ? projectedAnnualReturn / totalInvested : 0;

        return {
            totalInvested,
            marketValue,
            result: marketValue - totalInvested,
            projectedAnnualReturn,
            weightedAnnualRate,
            activePositions: (userInvestments || []).length,
        };
    }, [userInvestments]);

    return (
        <>
            <div className="mt-4 space-y-6">
                <div className="grid gap-4 md:grid-cols-4">
                    <Card className="glass-effect border-emerald-500/20">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-muted-foreground">Total investido</p>
                                <Wallet className="h-4 w-4 text-emerald-300" />
                            </div>
                            <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(portfolioStats.totalInvested)}</p>
                        </CardContent>
                    </Card>
                    <Card className="glass-effect border-sky-500/20">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-muted-foreground">Valor de mercado</p>
                                <TrendingUp className="h-4 w-4 text-sky-300" />
                            </div>
                            <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(portfolioStats.marketValue)}</p>
                        </CardContent>
                    </Card>
                    <Card className="glass-effect border-violet-500/20">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-muted-foreground">Resultado atual</p>
                                <BarChart3 className="h-4 w-4 text-violet-300" />
                            </div>
                            <p className={`mt-2 text-2xl font-bold ${portfolioStats.result >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{formatCurrency(portfolioStats.result)}</p>
                        </CardContent>
                    </Card>
                    <Card className="glass-effect border-amber-500/20">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-muted-foreground">Posições ativas</p>
                                <Activity className="h-4 w-4 text-amber-300" />
                            </div>
                            <p className="mt-2 text-2xl font-bold text-foreground">{portfolioStats.activePositions}</p>
                        </CardContent>
                    </Card>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
                        <TabsTrigger value="portfolio"><PiggyBank className="mr-2 h-4 w-4" />Meu Portfólio</TabsTrigger>
                        <TabsTrigger value="opportunities"><Briefcase className="mr-2 h-4 w-4" />Oportunidades</TabsTrigger>
                        <TabsTrigger value="stocks"><TrendingUp className="mr-2 h-4 w-4"/>Ações</TabsTrigger>
                        <TabsTrigger value="history"><BarChart3 className="mr-2 h-4 w-4" />Histórico</TabsTrigger>
                    </TabsList>
                    <TabsContent value="portfolio" className="mt-4">
                        <Card className="glass-effect">
                            <CardHeader>
                                <CardTitle className="text-white flex items-center gap-2"><PiggyBank className="h-5 w-5 text-emerald-300" /> Seu Portfólio</CardTitle>
                                <CardDescription>Acompanhe, aumente posição ou resgate aplicações.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-4 lg:grid-cols-2">
                                {userInvestments && userInvestments.length > 0 ? userInvestments.map(inv => (
                                    <motion.div initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} key={inv.id} className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <h4 className="font-bold text-white">{inv.investment_option.name}</h4>
                                                <p className="mt-1 text-sm text-muted-foreground">{inv.investment_option.description}</p>
                                            </div>
                                            <RiskBadge level={inv.investment_option.risk_level} />
                                        </div>
                                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                                            <div className="rounded-lg bg-white/5 p-3">
                                                <p className="text-muted-foreground">Quantidade · preço médio</p>
                                                <p className="text-lg font-bold text-green-400">{Number(inv.quantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 8 })}</p>
                                                <p className="text-xs text-muted-foreground">{formatCurrency(inv.average_unit_price || 0)} por unidade</p>
                                            </div>
                                            <div className="rounded-lg bg-white/5 p-3">
                                                <p className="text-muted-foreground">Valor atual · resultado</p>
                                                <p className="text-lg font-bold text-sky-300">{formatCurrency(Number(inv.quantity || 0) * Number(inv.investment_option?.current_unit_price || 1))}</p>
                                                <p className="text-xs text-muted-foreground">{formatCurrency((Number(inv.quantity || 0) * Number(inv.investment_option?.current_unit_price || 1)) - Number(inv.amount_invested || 0))}</p>
                                            </div>
                                        </div>
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            <Button size="sm" variant="outline" className="bg-green-500/10 border-green-500/30 hover:bg-green-500/20" onClick={() => openModal('invest', inv.investment_option)}>
                                                <Plus className="mr-2 h-4 w-4 text-green-300"/> Aumentar
                                            </Button>
                                            <Button size="sm" variant="destructive" onClick={() => openModal('withdraw', inv)}>
                                                <Minus className="mr-2 h-4 w-4"/> Resgatar
                                            </Button>
                                        </div>
                                    </motion.div>
                                )) : (
                                    <div className="col-span-full rounded-xl border border-dashed border-white/10 bg-white/5 py-10 text-center text-gray-400">
                                        Você ainda não possui investimentos. Explore as oportunidades e faça sua primeira aplicação.
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                     <TabsContent value="opportunities" className="mt-4">
                         <Card className="glass-effect">
                             <CardHeader>
                                 <CardTitle className="text-white flex items-center gap-2"><Briefcase className="h-5 w-5 text-sky-300" /> Opções Para Investir</CardTitle>
                                 <CardDescription>Compare risco, rentabilidade e aplicação mínima.</CardDescription>
                             </CardHeader>
                             <CardContent className="space-y-6">
                                <div className="flex flex-wrap gap-2">
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
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {filteredOptions && filteredOptions.map(opt => (
                                        <motion.div initial={{opacity: 0, scale: 0.95}} animate={{opacity: 1, scale: 1}} key={opt.id} className="rounded-xl border border-white/10 bg-slate-950/40 p-4 transition-colors hover:border-primary/40">
                                            <div>
                                                <div className="flex justify-between items-start">
                                                    <h4 className="font-bold text-white flex-1 mr-2">{opt.name}</h4>
                                                    <RiskBadge level={opt.risk_level} />
                                                </div>
                                                <p className="text-sm text-gray-400 mt-2 min-h-[48px]">{opt.description}</p>
                                            </div>
                                            <div className="mt-4 grid grid-cols-2 gap-3">
                                                <div className="rounded-lg bg-white/5 p-3">
                                                    <p className="text-xs text-gray-400">Rentabilidade</p>
                                                    <p className="text-lg font-bold text-green-400">{opt.asset_type === 'stock' ? 'Variável' : `${getAnnualReturnPercent(opt.annual_return_rate).toFixed(2)}% a.a.`}</p>
                                                </div>
                                                <div className="rounded-lg bg-white/5 p-3">
                                                    <p className="text-xs text-gray-400">Aplicação mínima</p>
                                                    <p className="text-lg font-bold text-foreground">{formatCurrency(opt.minimum_amount || 0)}</p>
                                                </div>
                                            </div>
                                            <div className="mt-4 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    <ShieldCheck className="h-4 w-4 text-emerald-300" />
                                                    {opt.asset_type === 'stock' ? 'Oferta e liquidez limitadas' : 'Resgate sujeito à reserva'}
                                                </div>
                                                <Button size="sm" onClick={() => openModal('invest', opt)}>Investir</Button>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                                {filteredOptions && filteredOptions.length === 0 && (
                                    <p className="text-center text-muted-foreground py-4">Nenhuma opção de investimento encontrada para esta categoria.</p>
                                )}
                             </CardContent>
                         </Card>
                    </TabsContent>
                    <TabsContent value="stocks" className="mt-4"><StockExchange embedded initialAsset={stockAsset} onTrade={onUpdate}/></TabsContent>
                    <TabsContent value="history" className="mt-4 space-y-4">
                        <Card className="glass-effect"><CardHeader><CardTitle>Evolução do portfólio</CardTitle><CardDescription>Snapshots gerados pelo servidor após cada compra ou venda.</CardDescription></CardHeader><CardContent>{portfolioSnapshots.length ? <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={portfolioSnapshots.map((item) => ({ ...item, label: formatLocaleBR(new Date(item.captured_at), 'toLocaleDateString', 'pt-BR'), value: Number(item.market_value) }))}><CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.15)" /><XAxis dataKey="label" stroke="#94a3b8" /><YAxis stroke="#94a3b8" /><Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ background: '#0f172a', border: '1px solid rgba(148,163,184,.25)', borderRadius: 8 }} /><Line type="monotone" dataKey="value" stroke="#38bdf8" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div> : <p className="py-8 text-center text-muted-foreground">O gráfico surgirá após a primeira operação.</p>}</CardContent></Card>
                        <Card className="glass-effect"><CardHeader><CardTitle>Compras e vendas</CardTitle></CardHeader><CardContent className="space-y-3">{investmentOperations.length ? investmentOperations.map((operation) => <div key={operation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3"><div><p className="font-medium">{operation.operation_type === 'buy' ? 'Compra' : 'Venda'} · {operation.investment_option?.asset_symbol || operation.investment_option?.name}</p><p className="text-xs text-muted-foreground">{formatLocaleBR(new Date(operation.executed_at), 'toLocaleString', 'pt-BR')} · {Number(operation.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 8 })} unidades a {formatCurrency(operation.unit_price)}</p></div><p className="font-bold">{formatCurrency(operation.gross_amount)}</p></div>) : <p className="py-6 text-center text-muted-foreground">Nenhuma operação registrada.</p>}</CardContent></Card>
                    </TabsContent>
                </Tabs>
            </div>
            <InvestmentActionModal {...modalState} setIsOpen={(isOpen) => setModalState(s => ({...s, isOpen}))} onActionSuccess={onUpdate} />
        </>
    );
};

export default InvestmentsTab;
