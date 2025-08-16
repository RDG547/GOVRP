import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Save, DollarSign } from 'lucide-react';
import { formatCurrency, parseCurrency } from '@/lib/utils';

const SystemSettings = () => {
    const { toast } = useToast();
    const [settings, setSettings] = useState({
        citizen_income: { enabled: false, amount: 0, day_of_week: 6 }
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const fetchSettings = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.from('system_settings').select('key, value');
        if (error) {
            toast({ title: "Erro ao carregar configurações", description: error.message, variant: "destructive" });
        } else {
            const settingsMap = data.reduce((acc, setting) => {
                acc[setting.key] = setting.value;
                return acc;
            }, {});
            setSettings(prev => ({ ...prev, ...settingsMap }));
        }
        setLoading(false);
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

    const weekDays = [
        { value: 0, label: 'Domingo' },
        { value: 1, label: 'Segunda-feira' },
        { value: 2, label: 'Terça-feira' },
        { value: 3, label: 'Quarta-feira' },
        { value: 4, label: 'Quinta-feira' },
        { value: 5, label: 'Sexta-feira' },
        { value: 6, label: 'Sábado' },
    ];

    if (loading) {
        return <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>;
    }

    return (
        <div className="space-y-6">
            <Card className="glass-effect">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white"><DollarSign className="w-5 h-5 text-green-400" /> Renda Cidadã Semanal</CardTitle>
                    <CardDescription>Configure o pagamento automático de uma renda básica para todos os cidadãos com conta bancária.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between space-x-2 p-4 rounded-lg bg-slate-800/50">
                        <Label htmlFor="income-enabled" className="flex flex-col space-y-1">
                            <span className="font-medium text-white">Habilitar Renda Cidadã</span>
                            <span className="text-xs font-normal leading-snug text-muted-foreground">
                                Ative para que o sistema distribua a renda semanalmente.
                            </span>
                        </Label>
                        <Switch
                            id="income-enabled"
                            checked={settings.citizen_income.enabled}
                            onCheckedChange={(checked) => handleIncomeChange('enabled', checked)}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <Label htmlFor="income-amount">Valor do Pagamento</Label>
                            <Input
                                id="income-amount"
                                value={formatCurrency(settings.citizen_income.amount * 100)}
                                onChange={(e) => handleIncomeChange('amount', parseCurrency(e.target.value))}
                                disabled={!settings.citizen_income.enabled}
                            />
                        </div>
                        <div>
                            <Label htmlFor="income-day">Dia do Pagamento</Label>
                            <Select
                                value={String(settings.citizen_income.day_of_week)}
                                onValueChange={(value) => handleIncomeChange('day_of_week', parseInt(value))}
                                disabled={!settings.citizen_income.enabled}
                            >
                                <SelectTrigger id="income-day">
                                    <SelectValue placeholder="Selecione o dia" />
                                </SelectTrigger>
                                <SelectContent>
                                    {weekDays.map(day => (
                                        <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>
                                    ))}
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
    );
};

export default SystemSettings;