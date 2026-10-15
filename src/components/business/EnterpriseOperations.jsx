import {CurrencyInput} from '@/components/ui/currency-input';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Store, Package, Package2, PackageCheck, Landmark, Wifi, Zap, Droplet, Smartphone, Flame, Building, Loader2, ChevronLeft, Lock, TrendingUp, Coins, DollarSign, Save, Wrench } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
export const ENTERPRISE_SECTORS = [
    { value: 'Habitação', label: 'Habitação e Patrimônio', icon: Building2, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20' },
    { value: 'Comércio Varejista', label: 'Comércio e Abastecimento', icon: Store, color: 'text-amber-400', bgColor: 'bg-amber-500/20' },
    { value: 'Marketplace', label: 'Comércio Digital', icon: Package, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
    { value: 'Banco Nacional', label: 'Banco Nacional', icon: Landmark, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20' },
    { value: 'Internet', label: 'Internet', icon: Wifi, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
    { value: 'Energia Elétrica', label: 'Energia Elétrica', icon: Zap, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
    { value: 'Água', label: 'Água', icon: Droplet, color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
    { value: 'Telefonia', label: 'Telefonia', icon: Smartphone, color: 'text-violet-400', bgColor: 'bg-violet-500/20' },
    { value: 'Gás', label: 'Gás', icon: Flame, color: 'text-orange-500', bgColor: 'bg-orange-500/20' },
    { value: 'Outros', label: 'Outros', icon: Building, color: 'text-gray-400', bgColor: 'bg-gray-500/20' },
];

export const isNationalBankEnterprise = (enterprise) =>
    enterprise?.sector === 'Banco Nacional' || `${enterprise?.name || ''}`.toLowerCase() === 'banco nacional';

export const SECTOR_SERVICE_KEYS = {
    'Internet': [
        { key: 'Internet_Básico', label: 'Plano Básico', icon: Package },
        { key: 'Internet_Ultra', label: 'Plano Ultra', icon: Package2 },
        { key: 'Internet_Mega', label: 'Plano Mega', icon: PackageCheck },
    ],
    'Telefonia': [
        { key: 'Telefonia_Básico', label: 'Plano Básico', icon: Package },
        { key: 'Telefonia_Intermediário', label: 'Plano Intermediário', icon: Package2 },
        { key: 'Telefonia_Premium', label: 'Plano Premium', icon: PackageCheck },
    ],
    'Energia Elétrica': [
        { key: 'Energia Elétrica', label: 'Energia Elétrica', icon: Zap },
    ],
    'Água': [
        { key: 'Água', label: 'Água', icon: Droplet },
    ],
    'Gás': [
        { key: 'Gás', label: 'Gás', icon: Flame },
    ],
};

export const ENTERPRISE_COST_LABELS = {
    employees: 'Funcionários',
    infrastructure: 'Infraestrutura',
    maintenance: 'Manutenção',
    energy: 'Energia',
    licenses: 'Licenças',
};

export const WEEKS_PER_MONTH = 4.345;
export const DEFAULT_ENTERPRISE_FORM = {
    name: '',
    sector: '',
    description: '',
    market_value: 'R$ 1.000.000,00',
    health_score: 75,
};

export const normalizeEnterpriseCosts = (value = {}) =>
    Object.keys(ENTERPRISE_COST_LABELS).reduce((accumulator, key) => {
        accumulator[key] = Number(value?.[key] || 0);
        return accumulator;
    }, {});

export const sumEnterpriseCosts = (costs = {}) =>
    Object.values(costs || {}).reduce((sum, current) => sum + Number(current || 0), 0);

export const getEnterpriseHealthScore = (enterprise) =>
    Math.min(100, Math.max(0, Number(enterprise?.health_score ?? 75)));

export const getEnterpriseMarketValue = (enterprise) => Number(enterprise?.market_value || 0);

export const EnterpriseDetailView = ({ enterprise, onBack, onUpdate }) => {
    const { toast } = useToast();
    const sectorInfo = ENTERPRISE_SECTORS.find(s => s.value === enterprise.sector) || ENTERPRISE_SECTORS.find(s => s.value === 'Outros');
    const SectorIcon = sectorInfo.icon;
    const sectorServices = SECTOR_SERVICE_KEYS[enterprise.sector] || [];
    const isNationalBank = isNationalBankEnterprise(enterprise);

    const [prices, setPrices] = useState({});
    const [costs, setCosts] = useState(() => normalizeEnterpriseCosts());
    const [savingPrices, setSavingPrices] = useState(false);
    const [savingCosts, setSavingCosts] = useState(false);
    const [loadingData, setLoadingData] = useState(true);

    const dirtyPrices = useRef(false), dirtyCosts = useRef(false);
    const [loadError, setLoadError] = useState('');
    const loadData = useCallback(async () => {
        const [pricesRes, costsRes] = await Promise.all([
            supabase.from('system_settings').select('value').eq('key', 'basic_service_prices').maybeSingle(),
            supabase.from('system_settings').select('value').eq('key', 'enterprise_costs').maybeSingle(),
        ]);
        if (pricesRes.error || costsRes.error) setLoadError('Não foi possível atualizar os valores operacionais.');
        else {
            if (!dirtyPrices.current) setPrices(pricesRes.data?.value || {});
            if (!dirtyCosts.current) setCosts(normalizeEnterpriseCosts(costsRes.data?.value?.[enterprise.id]));
            setLoadError('');
        }
        setLoadingData(false);
    }, [enterprise.id]);
    useEffect(() => { void loadData(); }, [loadData]);
    useDomainRealtime('enterprise-operating-settings', enterprise.id, [
        { table: 'system_settings', filter: 'key=eq.basic_service_prices' },
        { table: 'system_settings', filter: 'key=eq.enterprise_costs' },
    ], loadData);

    const handlePriceChange = (key, value) => {
        dirtyPrices.current = true;
        setPrices(prev => ({ ...prev, [key]: parseCurrency(value) }));
    };

    const handleCostChange = (key, value) => {
        dirtyCosts.current = true;
        setCosts(prev => ({ ...prev, [key]: parseCurrency(value) }));
    };

    const handleSavePrices = async () => {
        setSavingPrices(true);
        const { error } = await supabase.rpc('configure_enterprise_operations', { p_enterprise_id: enterprise.id, p_prices: Object.fromEntries(sectorServices.map(({key})=>[key,Number(prices[key]||0)])) });
        if (error) {
            toast({ title: 'Erro ao salvar preços', description: error.message, variant: 'destructive' });
        } else {
            dirtyPrices.current = false; void loadData();
            toast({ title: 'Preços atualizados!' });
            onUpdate?.();
        }
        setSavingPrices(false);
    };

    const handleSaveCosts = async () => {
        setSavingCosts(true);
        const { error } = await supabase.rpc('configure_enterprise_operations', { p_enterprise_id: enterprise.id, p_costs: costs });
        if (error) {
            toast({ title: 'Erro ao salvar custos', description: error.message, variant: 'destructive' });
        } else {
            dirtyCosts.current = false; void loadData();
            toast({ title: 'Custos operacionais atualizados!' });
            onUpdate?.();
        }
        setSavingCosts(false);
    };

    const totalMonthlyCost = sumEnterpriseCosts(costs);
    const totalWeeklyCost = totalMonthlyCost / WEEKS_PER_MONTH;
    const marketValue = getEnterpriseMarketValue(enterprise);
    const healthScore = getEnterpriseHealthScore(enterprise);

    if (loadingData) return <div className="flex justify-start sm:justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

    return (
        <div className="space-y-6">
            {loadError && <p role="alert">{loadError}<Button variant="ghost" onClick={loadData}>Tentar novamente</Button></p>}
            <div className="flex flex-wrap items-center gap-4">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ChevronLeft className="w-4 h-4 mr-1" /> Voltar
                </Button>
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${sectorInfo.bgColor}`}><SectorIcon className={`w-6 h-6 ${sectorInfo.color}`} /></div>
                    <div>
                        <h3 className="text-xl font-semibold">{enterprise.name}</h3>
                        <p className="text-sm text-muted-foreground">{sectorInfo.label} • {enterprise.is_active ? 'Ativa' : 'Inativa'}</p>
                    </div>
                </div>
            </div>

            {enterprise.description && (
                <Card className="glass-effect">
                    <CardContent className="pt-4">
                        <p className="text-sm text-muted-foreground">{enterprise.description}</p>
                    </CardContent>
                </Card>
            )}

            {isNationalBank ? (
                <Card className="glass-effect border-emerald-500/20">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-start gap-2 [&>svg]:shrink-0"><Lock className="w-5 h-5 text-emerald-400" /> Operações do Banco Nacional</CardTitle>
                        <CardDescription>
                            A Presidência pode gerir a estatal e conduzir sua privatização, mas a política operacional de juros, empréstimos e cartões é exclusiva do Presidente do Banco Nacional e não aparece neste painel.
                        </CardDescription>
                    </CardHeader>
                </Card>
            ) : null}

            <Card className="glass-effect border-emerald-500/20">
                <CardHeader>
                    <CardTitle className="text-lg flex items-start gap-2 [&>svg]:shrink-0"><TrendingUp className="w-5 h-5 text-emerald-400" /> Valor e Saúde da Estatal</CardTitle>
                    <CardDescription>
                        O balanço semanal usa estes indicadores para calibrar lucro, prejuízo e impacto no cofre público.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Valor de mercado</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(marketValue)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Saúde operacional</p>
                            <span className={healthScore >= 70 ? 'text-emerald-300' : healthScore >= 40 ? 'text-amber-300' : 'text-red-300'}>{healthScore}%</span>
                        </div>
                        <Progress value={healthScore} className="mt-3 h-3" />
                    </div>
                </CardContent>
            </Card>

            <Card className="glass-effect border-amber-500/20">
                <CardHeader>
                    <CardTitle className="text-lg flex items-start gap-2 [&>svg]:shrink-0"><Coins className="w-5 h-5 text-amber-400" /> Resumo de Custos</CardTitle>
                    <CardDescription>
                        Custos configurados para esta estatal: <span className="font-semibold text-foreground">{formatCurrency(totalMonthlyCost)}</span>/mês e <span className="font-semibold text-foreground">{formatCurrency(totalWeeklyCost)}</span>/semana.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {Object.entries(ENTERPRISE_COST_LABELS).map(([key, label]) => (
                        <div key={key} className="rounded-xl border border-white/10 bg-white/5 p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                            <p className="mt-2 text-lg font-semibold text-foreground">{formatCurrency(costs[key] || 0)}</p>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {sectorServices.length > 0 && (
                <Card className="glass-effect">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-start gap-2 [&>svg]:shrink-0"><DollarSign className="w-5 h-5 text-primary" /> Preços dos Serviços</CardTitle>
                        <CardDescription>Defina o valor semanal para os serviços desta estatal.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {sectorServices.map(({ key, label, icon: ServiceIcon }) => (
                            <div key={key} className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-2">
                                    <ServiceIcon className={`w-4 h-4 ${sectorInfo.color}`} />
                                    <Label htmlFor={`price-${key}`}>{label}</Label>
                                </div>
                                <CurrencyInput
                                    id={`price-${key}`}
                                    value={formatCurrency(prices[key] || 0, true)}
                                    onChange={(e) => handlePriceChange(key, e.target.value)}
                                    className="w-32"
                                />
                            </div>
                        ))}
                    </CardContent>
                    <CardFooter>
                        <Button onClick={handleSavePrices} disabled={savingPrices} className="w-full">
                            {savingPrices ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Salvar Preços
                        </Button>
                    </CardFooter>
                </Card>
            )}

            <Card className="glass-effect">
                <CardHeader>
                    <CardTitle className="text-lg flex items-start gap-2 [&>svg]:shrink-0"><Coins className="w-5 h-5 text-amber-400" /> Custos Operacionais</CardTitle>
                    <CardDescription>Custos mensais de operação da estatal. Total: <span className="font-bold text-foreground">{formatCurrency(totalMonthlyCost)}</span>/mês</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {Object.entries(ENTERPRISE_COST_LABELS).map(([key, label]) => (
                        <div key={key} className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-2">
                                <Wrench className="w-4 h-4 text-muted-foreground" />
                                <Label htmlFor={`cost-${key}`}>{label}</Label>
                            </div>
                            <CurrencyInput
                                id={`cost-${key}`}
                                value={formatCurrency(costs[key] || 0, true)}
                                onChange={(e) => handleCostChange(key, e.target.value)}
                                className="w-32"
                            />
                        </div>
                    ))}
                </CardContent>
                <CardFooter>
                    <Button onClick={handleSaveCosts} disabled={savingCosts} className="w-full">
                        {savingCosts ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Salvar Custos
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
};
