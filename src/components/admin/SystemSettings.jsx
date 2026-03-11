import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, Save, DollarSign, Landmark, CreditCard, HeartHandshake as Handshake, FileCheck2, PiggyBank, CandlestickChart, Building, User, Eraser, FileText } from 'lucide-react';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

const FinanceInfo = ({ finances, loading }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <div className="p-4 bg-background/30 rounded-lg">
            <p className="text-sm text-muted-foreground">Saldo do Cofre</p>
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <p className="text-xl font-bold">{formatCurrency(finances.treasury_balance || 0)}</p>}
        </div>
        <div className="p-4 bg-background/30 rounded-lg">
            <p className="text-sm text-muted-foreground">Cartão Governamental</p>
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <p className="text-xl font-bold">{formatCurrency(finances.corporate_card_used || 0)} / {formatCurrency(finances.corporate_card_limit || 0)}</p>}
        </div>
        <div className="p-4 bg-background/30 rounded-lg">
            <p className="text-sm text-muted-foreground">Empréstimos Tomados</p>
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <p className="text-xl font-bold">{formatCurrency(finances.loans_balance || 0)} / {formatCurrency(finances.loan_limit || 0)}</p>}
        </div>
    </div>
);

const TreasuryManager = ({ onUpdate }) => {
    const { toast } = useToast();
    const [amount, setAmount] = useState(0);
    const [inputValue, setInputValue] = useState('');
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    const handleAmountChange = (e) => {
        const rawValue = e.target.value;
        setInputValue(rawValue);
        const parsedValue = parseCurrency(rawValue);
        if (!isNaN(parsedValue)) {
            setAmount(parsedValue);
        }
    };

    useEffect(() => {
        setInputValue(formatCurrency(amount, true));
    }, [amount]);

    const handleAction = async (action) => {
        setSaving(true);
        if (amount <= 0 && action !== 'set') {
            toast({ title: "Valor inválido", variant: "destructive" });
            setSaving(false);
            return;
        }
        if (!reason) {
            toast({ title: "Motivo obrigatório", variant: "destructive" });
            setSaving(false);
            return;
        }

        const { data, error } = await supabase.rpc('admin_modify_treasury', {
            p_amount: amount,
            p_action: action,
            p_reason: reason
        });

        if (error || !data.success) {
            toast({ title: "Erro ao modificar cofre", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            setAmount(0);
            setInputValue('');
            setReason('');
            onUpdate();
        }
        setSaving(false);
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white"><Landmark className="w-5 h-5 text-amber-400" /> Gerenciar Cofre do Governo</CardTitle>
                <CardDescription>Adicione, remova ou defina o valor total do tesouro nacional.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <Label htmlFor="treasury-amount">Valor</Label>
                    <Input id="treasury-amount" type="text" value={inputValue} onChange={handleAmountChange} placeholder="R$ 0,00" />
                </div>
                <div>
                    <Label htmlFor="treasury-reason">Motivo da Operação</Label>
                    <Input id="treasury-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: Arrecadação de impostos" />
                </div>
            </CardContent>
            <CardFooter className="gap-2">
                <Button onClick={() => handleAction('add')} disabled={saving} variant="secondary">Adicionar</Button>
                <Button onClick={() => handleAction('remove')} disabled={saving} variant="destructive">Remover</Button>
                <Button onClick={() => handleAction('set')} disabled={saving}>Definir Valor Exato</Button>
            </CardFooter>
        </Card>
    );
};

const GovCardManager = ({ onUpdate }) => {
    const { toast } = useToast();
    const [limit, setLimit] = useState(0);
    const [inputValue, setInputValue] = useState('');
    const [saving, setSaving] = useState(false);

    const handleLimitChange = (e) => {
        const rawValue = e.target.value;
        setInputValue(rawValue);
        const parsedValue = parseCurrency(rawValue);
        if (!isNaN(parsedValue)) {
            setLimit(parsedValue);
        }
    };

    useEffect(() => {
        setInputValue(formatCurrency(limit, true));
    }, [limit]);

    const handleSave = async () => {
        setSaving(true);
        const { data, error } = await supabase.rpc('admin_set_gov_card_limit', { p_new_limit: limit });
        if (error || !data.success) {
            toast({ title: "Erro ao definir limite", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            onUpdate();
        }
        setSaving(false);
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white"><CreditCard className="w-5 h-5 text-sky-400" /> Cartão Governamental</CardTitle>
                <CardDescription>Defina o limite de crédito do cartão do governo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <Label htmlFor="card-limit">Novo Limite</Label>
                    <Input id="card-limit" type="text" value={inputValue} onChange={handleLimitChange} placeholder="R$ 0,00" />
                </div>
            </CardContent>
            <CardFooter>
                <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2 h-4 w-4" />} Salvar Limite</Button>
            </CardFooter>
        </Card>
    );
};

const GovLoanManager = ({ onUpdate }) => {
    const { toast } = useToast();
    const [limit, setLimit] = useState(0);
    const [inputValue, setInputValue] = useState('');
    const [saving, setSaving] = useState(false);

    const handleLimitChange = (e) => {
        const rawValue = e.target.value;
        setInputValue(rawValue);
        const parsedValue = parseCurrency(rawValue);
        if (!isNaN(parsedValue)) {
            setLimit(parsedValue);
        }
    };

    useEffect(() => {
        setInputValue(formatCurrency(limit, true));
    }, [limit]);

    const handleSave = async () => {
        setSaving(true);
        const { data, error } = await supabase.rpc('admin_set_gov_loan_limit', { p_new_limit: limit });
        if (error || !data.success) {
            toast({ title: "Erro ao definir limite", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            onUpdate();
        }
        setSaving(false);
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white"><Handshake className="w-5 h-5 text-green-400" /> Empréstimos do Governo</CardTitle>
                <CardDescription>Defina o limite total de empréstimos que o governo pode tomar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <Label htmlFor="loan-limit">Novo Limite de Empréstimos</Label>
                    <Input id="loan-limit" type="text" value={inputValue} onChange={handleLimitChange} placeholder="R$ 0,00" />
                </div>
            </CardContent>
            <CardFooter>
                <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2 h-4 w-4" />} Salvar Limite</Button>
            </CardFooter>
        </Card>
    );
};

const ForgiveDebtManager = ({ finances, onUpdate }) => {
    const { toast } = useToast();
    const [saving, setSaving] = useState(false);
    const [amount, setAmount] = useState(0);
    const [inputValue, setInputValue] = useState('');

    useEffect(() => {
        setInputValue(formatCurrency(amount, true));
    }, [amount]);

    const handleAmountChange = (e) => {
        const rawValue = e.target.value;
        setInputValue(rawValue);
        const parsedValue = parseCurrency(rawValue);
        if (!isNaN(parsedValue)) {
            setAmount(parsedValue);
        }
    };

    const handleAction = async (actionType) => {
        setSaving(true);
        let rpcParams = {
            p_target_type: 'government',
            p_user_id: null,
            p_loan_id: null,
            p_amount: actionType === 'abate' ? amount : null,
        };

        const { data, error } = await supabase.rpc('admin_forgive_debt', rpcParams);
        if (error || !data.success) {
            toast({ title: "Erro ao gerenciar dívida", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            onUpdate();
        }
        setSaving(false);
    };

    const currentDebt = finances?.loans_balance || 0;

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white"><Eraser className="w-5 h-5 text-red-400" /> Dívida de Empréstimos do Governo</CardTitle>
                <CardDescription>
                    Valor atual da dívida: <span className="text-red-400 font-bold">{formatCurrency(currentDebt)}</span>
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div>
                    <Label htmlFor="debt-amount">Valor para Abater</Label>
                    <Input id="debt-amount" type="text" value={inputValue} onChange={handleAmountChange} placeholder="R$ 0,00" disabled={currentDebt <= 0} />
                </div>
                 <Button onClick={() => handleAction('abate')} disabled={saving || currentDebt <= 0 || amount <= 0 || amount > currentDebt} className="w-full">
                    {saving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2 h-4 w-4" />} Abater Valor Específico
                </Button>
            </CardContent>
            <CardFooter>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="destructive" disabled={saving || currentDebt <= 0} className="w-full">
                            <Eraser className="mr-2 h-4 w-4" /> Perdoar Dívida Total
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Confirmar Ação</DialogTitle>
                            <DialogDescription>
                                Tem certeza que deseja perdoar toda a dívida de empréstimos do governo no valor de {formatCurrency(currentDebt)}? Esta ação é irreversível.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="sm:justify-center">
                            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                            <Button variant="destructive" onClick={() => handleAction('forgive')}>Confirmar e Perdoar</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardFooter>
        </Card>
    );
};

const PayUserInvoiceManager = ({ onUpdate }) => {
    const { toast } = useToast();
    const [usersWithInvoices, setUsersWithInvoices] = useState([]);
    const [selectedUser, setSelectedUser] = useState('');
    const [invoices, setInvoices] = useState([]);
    const [selectedInvoice, setSelectedInvoice] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const fetchUsers = async () => {
            const { data, error } = await supabase.rpc('get_users_with_pending_invoices');
            if (error) {
                toast({ title: "Erro ao buscar usuários com faturas", variant: "destructive" });
            } else {
                setUsersWithInvoices(data);
            }
        };
        fetchUsers();
    }, [toast]);

    useEffect(() => {
        const fetchInvoices = async () => {
            if (!selectedUser) {
                setInvoices([]);
                return;
            }
            const { data, error } = await supabase
                .from('card_invoices')
                .select('id, closing_date, amount')
                .eq('user_id', selectedUser)
                .eq('status', 'pending')
                .gt('amount', 0);

            if (error) {
                toast({ title: "Erro ao buscar faturas do usuário", variant: "destructive" });
            } else {
                setInvoices(data);
            }
        };
        fetchInvoices();
    }, [selectedUser, toast]);

    const handlePay = async () => {
        setSaving(true);
        const { data, error } = await supabase.rpc('admin_pay_invoice', { p_invoice_id: selectedInvoice });
        if (error || !data.success) {
            toast({ title: "Erro ao quitar fatura", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            onUpdate();
            setSelectedUser('');
            setSelectedInvoice('');
        }
        setSaving(false);
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white"><FileText className="w-5 h-5 text-teal-400" /> Quitar Faturas de Usuários</CardTitle>
                <CardDescription>Selecione um usuário e uma fatura pendente para quitá-la sem custos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <Label>Usuário com Faturas Pendentes</Label>
                    <Select onValueChange={setSelectedUser} value={selectedUser}>
                        <SelectTrigger><SelectValue placeholder="Selecione um usuário..." /></SelectTrigger>
                        <SelectContent>
                             <ScrollArea className="h-72">
                                {usersWithInvoices.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                            </ScrollArea>
                        </SelectContent>
                    </Select>
                </div>
                {invoices.length > 0 && (
                    <div>
                        <Label>Fatura a Quitar</Label>
                        <Select onValueChange={setSelectedInvoice} value={selectedInvoice}>
                            <SelectTrigger><SelectValue placeholder="Selecione uma fatura..." /></SelectTrigger>
                            <SelectContent>
                                {invoices.map(inv => (
                                    <SelectItem key={inv.id} value={inv.id}>
                                        Vencimento: {new Date(inv.closing_date).toLocaleDateString()} - Valor: {formatCurrency(inv.amount)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </CardContent>
            <CardFooter>
                <Button onClick={handlePay} disabled={saving || !selectedInvoice}>
                    {saving ? <Loader2 className="animate-spin mr-2" /> : <FileCheck2 className="mr-2 h-4 w-4" />} Quitar Fatura Selecionada
                </Button>
            </CardFooter>
        </Card>
    );
};

const AssetManager = ({ onUpdate, assetType }) => {
    const { toast } = useToast();
    const [users, setUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState('');
    const [amount, setAmount] = useState(0);
    const [inputValue, setInputValue] = useState('');
    const [currencyCode, setCurrencyCode] = useState('USD');
    const [saving, setSaving] = useState(false);
    const [currentBalance, setCurrentBalance] = useState(null);
    const [loadingBalance, setLoadingBalance] = useState(false);

    const typeConfig = {
        investment: {
            title: "Gerenciar Investimentos",
            description: "Modifique o saldo de investimentos de um usuário.",
            rpc_function: "admin_modify_investments",
            icon: PiggyBank,
            iconColor: "text-green-400"
        },
        currency: {
            title: "Gerenciar Câmbio",
            description: "Defina o saldo de moedas estrangeiras de um usuário.",
            rpc_function: "admin_modify_currency_balance",
            icon: CandlestickChart,
            iconColor: "text-purple-400"
        }
    };
    const config = typeConfig[assetType];

    useEffect(() => {
        const fetchUsers = async () => {
            const { data, error } = await supabase.from('profiles').select('id, full_name');
            if (error) {
                toast({ title: "Erro ao buscar usuários", variant: "destructive" });
            } else {
                setUsers(data);
            }
        };
        fetchUsers();
    }, [toast]);

    useEffect(() => {
        const fetchBalance = async () => {
            if (!selectedUser) {
                setCurrentBalance(null);
                return;
            }
            setLoadingBalance(true);

            if (assetType === 'investment') {
                const { data, error } = await supabase.rpc('get_total_invested_by_user', { p_user_id: selectedUser });
                if (!error) setCurrentBalance({ BRL: data });
            } else if (assetType === 'currency') {
                const { data, error } = await supabase.from('accounts').select('currency_balances').eq('user_id', selectedUser).single();
                if (!error && data) {
                    setCurrentBalance(data.currency_balances || {});
                }
            }
            setLoadingBalance(false);
        };
        fetchBalance();
    }, [selectedUser, assetType, supabase]);


    const handleAmountChange = (e) => {
        const rawValue = e.target.value;
        setInputValue(rawValue);
        const parsedValue = parseCurrency(rawValue);
        if (!isNaN(parsedValue)) {
            setAmount(parsedValue);
        }
    };

    useEffect(() => {
        setInputValue(formatCurrency(amount, true));
    }, [amount]);


    const handleAction = async (action) => {
        setSaving(true);

        if (!selectedUser) {
            toast({ title: "Selecione um usuário", variant: "destructive" });
            setSaving(false); return;
        }

        let rpcPayload = { p_user_id: selectedUser, p_amount: amount, p_action: action };
        if (assetType === 'investment') {
            rpcPayload.p_reason = 'Ajuste administrativo';
        } else if (assetType === 'currency') {
            rpcPayload.p_currency_code = currencyCode;
        }

        const { data, error } = await supabase.rpc(config.rpc_function, rpcPayload);

        if (error || !data.success) {
            toast({ title: `Erro ao modificar ${assetType}`, description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            onUpdate();
        }
        setSaving(false);
    };

    const displayedBalance = assetType === 'investment'
        ? formatCurrency(currentBalance?.BRL || 0)
        : formatCurrency(currentBalance?.[currencyCode] || 0);

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white"><config.icon className={`w-5 h-5 ${config.iconColor}`} /> {config.title}</CardTitle>
                <CardDescription>{config.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div>
                    <Label>Usuário</Label>
                    <Select onValueChange={setSelectedUser} value={selectedUser}>
                        <SelectTrigger><SelectValue placeholder="Selecione um usuário..." /></SelectTrigger>
                        <SelectContent>
                             <ScrollArea className="h-72">
                                {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                            </ScrollArea>
                        </SelectContent>
                    </Select>
                </div>
                 {selectedUser && (
                    <div className="text-sm text-muted-foreground">
                        Saldo Atual: {loadingBalance ? <Loader2 className="w-4 h-4 animate-spin inline-block" /> : <strong>{displayedBalance} {assetType === 'currency' ? currencyCode : ''}</strong>}
                    </div>
                )}
                {assetType === 'currency' && (
                    <div>
                        <Label>Moeda</Label>
                        <Select onValueChange={setCurrencyCode} value={currencyCode}>
                            <SelectTrigger><SelectValue placeholder="Selecione uma moeda..." /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="USD">USD</SelectItem>
                                <SelectItem value="EUR">EUR</SelectItem>
                                <SelectItem value="GBP">GBP</SelectItem>
                                <SelectItem value="JPY">JPY</SelectItem>
                                <SelectItem value="CNY">CNY</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <div>
                    <Label htmlFor={`${assetType}-amount`}>Valor</Label>
                    <Input id={`${assetType}-amount`} type="text" value={inputValue} onChange={handleAmountChange} placeholder="R$ 0,00" />
                </div>
            </CardContent>
            <CardFooter className="gap-2">
                {assetType === 'investment' && <Button onClick={() => handleAction('add')} disabled={saving} variant="secondary">Adicionar</Button>}
                {assetType === 'investment' && <Button onClick={() => handleAction('remove')} disabled={saving} variant="destructive">Remover</Button>}
                <Button onClick={() => handleAction('set')} disabled={saving}>Definir Valor Exato</Button>
            </CardFooter>
        </Card>
    );
};

const SystemSettings = () => {
    const { toast } = useToast();
    const [settings, setSettings] = useState({
        citizen_income: { enabled: false, amount: 0, day_of_week: 6 }
    });
    const [govFinances, setGovFinances] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const fetchSettings = useCallback(async () => {
        setLoading(true);
        try {
            const { data: settingsData, error: settingsError } = await supabase.from('system_settings').select('key, value');
            if (settingsError) throw settingsError;
            const settingsMap = settingsData.reduce((acc, setting) => {
                acc[setting.key] = setting.value;
                return acc;
            }, {});
            setSettings(prev => ({ ...prev, ...settingsMap }));

            const { data: financesData, error: financesError } = await supabase.from('government_finances').select('*').single();
            if (financesError) throw financesError;
            setGovFinances(financesData);

        } catch (error) {
            toast({ title: "Erro ao carregar configurações", description: error.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const handleIncomeChange = (field, value) => {
        setSettings(prev => ({
            ...prev,
            citizen_income: {
                ...prev.citizen_income,
                [field]: value
            }
        }));
    };

    const handleSaveSettings = async () => {
        setSaving(true);
        const { error } = await supabase
            .from('system_settings')
            .upsert({ key: 'citizen_income', value: settings.citizen_income });

        if (error) {
            toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso", description: "Configurações da Renda Cidadã salvas." });
        }
        setSaving(false);
    };

    const weekDays = [ { value: 0, label: 'Domingo' }, { value: 1, label: 'Segunda-feira' }, { value: 2, label: 'Terça-feira' }, { value: 3, label: 'Quarta-feira' }, { value: 4, label: 'Quinta-feira' }, { value: 5, label: 'Sexta-feira' }, { value: 6, label: 'Sábado' }];

    if (loading) {
        return <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>;
    }

    return (
        <Tabs defaultValue="government" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="government"><Building className="mr-2 h-4 w-4" />Governo</TabsTrigger>
                <TabsTrigger value="users"><User className="mr-2 h-4 w-4" />Usuários</TabsTrigger>
            </TabsList>
            <TabsContent value="government" className="mt-6">
                <div className="space-y-6">
                    <FinanceInfo finances={govFinances} loading={loading} />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <TreasuryManager onUpdate={fetchSettings} />
                        <GovCardManager onUpdate={fetchSettings} />
                        <GovLoanManager onUpdate={fetchSettings} />
                        <ForgiveDebtManager finances={govFinances} onUpdate={fetchSettings} />
                    </div>
                </div>
            </TabsContent>
            <TabsContent value="users" className="mt-6">
                 <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <AssetManager assetType="investment" onUpdate={fetchSettings} />
                        <AssetManager assetType="currency" onUpdate={fetchSettings} />
                        <PayUserInvoiceManager onUpdate={fetchSettings} />
                    </div>
                    <Card className="glass-effect">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-white"><DollarSign className="w-5 h-5 text-green-400" /> Renda Cidadã Semanal</CardTitle>
                            <CardDescription>Configure o pagamento automático de uma renda básica para todos os cidadãos com conta bancária.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between space-x-2 p-4 rounded-lg bg-slate-800/50">
                                <Label htmlFor="income-enabled" className="flex flex-col space-y-1">
                                    <span className="font-medium text-white">Habilitar Renda Cidadã</span>
                                    <span className="text-xs font-normal leading-snug text-muted-foreground">Ative para que o sistema distribua a renda semanalmente.</span>
                                </Label>
                                <Switch id="income-enabled" checked={settings.citizen_income.enabled} onCheckedChange={(checked) => handleIncomeChange('enabled', checked)} />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <Label htmlFor="income-amount">Valor do Pagamento</Label>
                                    <Input id="income-amount" value={formatCurrency(settings.citizen_income.amount, true)} onChange={(e) => handleIncomeChange('amount', parseCurrency(e.target.value))} disabled={!settings.citizen_income.enabled} placeholder="R$ 0,00" />
                                </div>
                                <div>
                                    <Label htmlFor="income-day">Dia do Pagamento</Label>
                                    <Select value={String(settings.citizen_income.day_of_week)} onValueChange={(value) => handleIncomeChange('day_of_week', parseInt(value))} disabled={!settings.citizen_income.enabled}>
                                        <SelectTrigger id="income-day"><SelectValue placeholder="Selecione o dia" /></SelectTrigger>
                                        <SelectContent>
                                            {weekDays.map(day => (<SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex justify-end">
                                <Button onClick={handleSaveSettings} disabled={saving}>
                                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Salvar Configurações
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </TabsContent>
        </Tabs>
    );
};

export default SystemSettings;
