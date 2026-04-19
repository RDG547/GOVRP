import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Loader2, Landmark, Users, Briefcase, FileSignature, Edit, Plus, Save, Trash2, Megaphone, TrendingUp, TrendingDown, CreditCard, School as University, PiggyBank, HeartHandshake as Handshake, BrainCircuit, HeartPulse, Shield, Anchor, BookOpen, Microscope, Recycle, TramFront as Tram, Globe, Palette, Cpu, Building, Coins, Percent, Wifi, Smartphone, Droplet, Flame, Zap, Package, Package2, PackageCheck, UserPlus, FilePlus, UserX, LogOut, AlertTriangle, Clock3 } from 'lucide-react';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import PageHeader from '@/components/layout/PageHeader';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
    getGovernmentBudgetTotal,
    haveGovernmentBudgetAreasChanged,
    rebalanceGovernmentBudgetAreas,
} from '@/lib/governmentBudget';
import { publishOfficialGazetteEntry } from '@/lib/officialGazette';
import {
    EXECUTIVE_SPECIAL_OFFICES,
    appointExecutiveSpecialOffice,
    createExecutiveProvisionalMeasure,
    dismissExecutiveSpecialOffice,
    fetchExecutiveConstitutionalState,
    markExecutiveOfficeVacancy,
    reviewPresidentialBill,
} from '@/lib/executiveGovernance';

const MinisterManager = ({ ministers, onUpdate }) => {
    const { toast } = useToast();
    const [allUsers, setAllUsers] = useState([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState('');
    const [selectedMinistry, setSelectedMinistry] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const allMinistries = [
        'Ministério da Justiça', 'Ministério da Defesa', 'Ministério da Economia',
        'Ministério da Saúde', 'Ministério da Educação', 'Ministério da Infraestrutura',
        'Ministério do Meio Ambiente', 'Ministério de Relações Exteriores', 'Ministério da Cultura',
        'Ministério de Pesquisa', 'Ministério da Tecnologia'
    ];

    const availableMinistries = allMinistries.filter(
        (ministry) => !ministers.some((minister) => minister.ministry === ministry)
    );


    useEffect(() => {
        const fetchUsers = async () => {
            const { data, error } = await supabase.from('profiles').select('id, full_name, role').eq('role', 'Cidadão');
            if (error) {
                toast({ title: 'Erro ao buscar cidadãos', variant: 'destructive' });
            } else {
                setAllUsers(data);
            }
        };
        fetchUsers();
    }, [toast]);

    const handleAppoint = async () => {
        setIsSaving(true);
        const { data, error } = await supabase.rpc('appoint_minister', { p_user_id: selectedUser, p_ministry: selectedMinistry });
        if (error || !data.success) {
            toast({ title: 'Erro ao nomear ministro', description: data?.message || error.message, variant: 'destructive' });
        } else {
            const selectedProfile = allUsers.find((profile) => profile.id === selectedUser);

            try {
                await publishOfficialGazetteEntry(supabase, {
                    title: `Nomeação ministerial: ${selectedProfile?.full_name || 'Ministro'}`,
                    summary: `${selectedProfile?.full_name || 'O cidadão selecionado'} foi nomeado para ${selectedMinistry}.`,
                    content: `${selectedProfile?.full_name || 'O cidadão selecionado'} assumiu oficialmente o cargo de ${selectedMinistry}.`,
                    type: 'Nomeação e Exoneração',
                });
            } catch (gazetteError) {
                console.error('Erro ao publicar nomeação no Diário Oficial:', gazetteError);
            }

            toast({ title: 'Sucesso!', description: data.message });
            onUpdate();
            setIsDialogOpen(false);
        }
        setIsSaving(false);
    };

    const handleDismiss = async (minister) => {
        const { data, error } = await supabase.rpc('dismiss_minister', { p_user_id: minister.user_id });
        if (error || !data.success) {
            toast({ title: 'Erro ao exonerar ministro', description: data?.message || error.message, variant: 'destructive' });
        } else {
            try {
                await publishOfficialGazetteEntry(supabase, {
                    title: `Exoneração ministerial: ${minister.profile.full_name}`,
                    summary: `${minister.profile.full_name} deixou o cargo de ${minister.ministry}.`,
                    content: `${minister.profile.full_name} foi exonerado do cargo de ${minister.ministry}.`,
                    type: 'Nomeação e Exoneração',
                });
            } catch (gazetteError) {
                console.error('Erro ao publicar exoneração no Diário Oficial:', gazetteError);
            }

            toast({ title: 'Sucesso!', description: data.message });
            onUpdate();
        }
    };

    return (
        <Card className="glass-effect h-full flex flex-col">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Briefcase className="w-6 h-6 text-primary" />Gabinete de Ministros</CardTitle>
                <CardDescription>Nomeie e exonere os ministros do seu governo.</CardDescription>
            </CardHeader>
            <CardContent className="flex-grow space-y-4">
                {ministers.length > 0 ? ministers.map(minister => (
                    <div key={minister.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                        <div>
                            <p className="font-semibold">{minister.profile.full_name}</p>
                            <p className="text-sm text-muted-foreground">{minister.ministry}</p>
                        </div>
                        <Button variant="destructive" size="sm" onClick={() => handleDismiss(minister)}>
                            <UserX className="mr-2 h-4 w-4" />
                            Exonerar
                        </Button>
                    </div>
                )) : <p className="text-center text-muted-foreground py-4">Nenhum ministro nomeado.</p>}
            </CardContent>
            <CardFooter>
                 <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="w-full"><UserPlus className="mr-2 h-4 w-4" /> Nomear Ministro</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Nomear Novo Ministro</DialogTitle>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="user">Cidadão</Label>
                                <Select onValueChange={setSelectedUser}>
                                    <SelectTrigger><SelectValue placeholder="Selecione um cidadão" /></SelectTrigger>
                                    <SelectContent>
                                        <ScrollArea className="h-72">
                                          {allUsers.map(user => <SelectItem key={user.id} value={user.id}>{user.full_name}</SelectItem>)}
                                        </ScrollArea>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="ministry">Ministério</Label>
                                <Select onValueChange={setSelectedMinistry}>
                                    <SelectTrigger><SelectValue placeholder="Selecione um ministério" /></SelectTrigger>
                                    <SelectContent>
                                        <ScrollArea className="h-72">
                                          {availableMinistries.map(min => <SelectItem key={min} value={min}>{min}</SelectItem>)}
                                        </ScrollArea>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button onClick={handleAppoint} disabled={isSaving || !selectedUser || !selectedMinistry}>
                                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Nomear
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardFooter>
        </Card>
    );
};

const DecreeManager = ({ decrees, onUpdate }) => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingDecree, setEditingDecree] = useState(null);
    const [formData, setFormData] = useState({ title: '', content: '' });
    const [isSaving, setIsSaving] = useState(false);

    const openNewDialog = () => {
        setEditingDecree(null);
        setFormData({ title: '', content: '' });
        setIsDialogOpen(true);
    };

    const openEditDialog = (decree) => {
        setEditingDecree(decree);
        setFormData({ title: decree.title, content: decree.content });
        setIsDialogOpen(true);
    };

    const handleSave = async () => {
        setIsSaving(true);
        let error;
        if (editingDecree) {
            ({ error } = await supabase.from('decrees').update({ ...formData }).eq('id', editingDecree.id));
        } else {
            ({ error } = await supabase.from('decrees').insert({ ...formData, author_id: user.id, is_published: false }));
        }

        if (error) {
            toast({ title: 'Erro ao salvar decreto', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Decreto salvo com sucesso!' });
            onUpdate();
            setIsDialogOpen(false);
        }
        setIsSaving(false);
    };

    const handleDelete = async (decreeId) => {
        const { error } = await supabase.from('decrees').delete().eq('id', decreeId);
        if (error) {
            toast({ title: 'Erro ao excluir decreto', variant: 'destructive' });
        } else {
            toast({ title: 'Decreto excluído com sucesso!' });
            onUpdate();
        }
    };

    const handlePublish = async (decreeId, isPublished) => {
        const { error } = await supabase
            .from('decrees')
            .update({ is_published: !isPublished, published_at: new Date().toISOString() })
            .eq('id', decreeId);
         if (error) {
            toast({ title: 'Erro ao publicar', variant: 'destructive' });
        } else {
            toast({ title: `Decreto ${!isPublished ? 'publicado' : 'despublicado'}!` });
            onUpdate();
        }
    };


    return (
        <Card className="glass-effect h-full flex flex-col">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileSignature className="w-6 h-6 text-primary" />Decretos Presidenciais</CardTitle>
                <CardDescription>Crie, edite e publique seus decretos.</CardDescription>
            </CardHeader>
            <CardContent className="flex-grow space-y-4">
                 {decrees.length > 0 ? decrees.map(decree => (
                    <div key={decree.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                        <div>
                            <p className="font-semibold">{decree.title}</p>
                            <p className={`text-sm ${decree.is_published ? 'text-green-400' : 'text-yellow-400'}`}>{decree.is_published ? 'Publicado' : 'Rascunho'}</p>
                        </div>
                        <div className="flex gap-1">
                            <Button variant="outline" size="sm" onClick={() => openEditDialog(decree)}><Edit className="w-4 h-4 mr-2"/>Editar</Button>
                            <Button variant="outline" size="sm" onClick={() => handlePublish(decree.id, decree.is_published)}><Megaphone className="w-4 h-4 mr-2"/>Publicar</Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDelete(decree.id)}><Trash2 className="w-4 h-4 mr-2"/>Excluir</Button>
                        </div>
                    </div>
                )) : <p className="text-center text-muted-foreground py-4">Nenhum decreto criado.</p>}
            </CardContent>
            <CardFooter>
                <Button onClick={openNewDialog} className="w-full"><FilePlus className="mr-2 h-4 w-4" /> Novo Decreto</Button>
            </CardFooter>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingDecree ? 'Editar Decreto' : 'Novo Decreto'}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="title">Título</Label>
                            <Input id="title" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="content">Conteúdo</Label>
                            <Textarea id="content" value={formData.content} onChange={(e) => setFormData({...formData, content: e.target.value})} rows={10}/>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

const BudgetManager = ({ budget, treasuryBalance, onUpdate, setActiveTab }) => {
    const { toast } = useToast();
    const [areas, setAreas] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [editingArea, setEditingArea] = useState(null);
    const [tempValue, setTempValue] = useState(0);
    const [inputValue, setInputValue] = useState("R$ 0,00");
    const safeTreasuryBalance = Math.max(0, Math.floor(Number(treasuryBalance) || 0));

    const areaIcons = {
        'Saúde': { icon: HeartPulse, color: 'text-red-400' },
        'Segurança': { icon: Shield, color: 'text-blue-400' },
        'Defesa': { icon: Anchor, color: 'text-gray-400' },
        'Educação': { icon: BookOpen, color: 'text-yellow-400' },
        'Tecnologia': { icon: Cpu, color: 'text-cyan-400' },
        'Meio Ambiente': { icon: Recycle, color: 'text-green-400' },
        'Infraestrutura': { icon: Tram, color: 'text-orange-400' },
        'Cultura': { icon: Palette, color: 'text-purple-400' },
        'Relações Exteriores': { icon: Globe, color: 'text-indigo-400' },
        'Economia': { icon: Landmark, color: 'text-emerald-400' },
        'Pesquisa': { icon: Microscope, color: 'text-pink-400' },
        'default': { icon: Building, color: 'text-gray-500'}
    };

    useEffect(() => {
        if (budget && budget.areas) {
            const adjustedAreas = rebalanceGovernmentBudgetAreas(budget.areas, safeTreasuryBalance);
            setAreas(adjustedAreas);

            if (haveGovernmentBudgetAreasChanged(budget.areas, adjustedAreas)) {
                const saveAdjusted = async () => {
                    await supabase
                        .from('system_settings')
                        .update({ value: { ...budget, areas: adjustedAreas } })
                        .eq('key', 'government_budget');
                };

                saveAdjusted();
            }
        }
    }, [budget, safeTreasuryBalance]);

    useEffect(() => {
        setInputValue(formatCurrency(tempValue, true));
    }, [tempValue]);

    const totalAllocated = getGovernmentBudgetTotal(areas);
    const availableToAllocate = Math.max(
        0,
        safeTreasuryBalance - (totalAllocated - (editingArea?.allocated_value || 0))
    );

    const handleEditArea = (area) => {
        setEditingArea(area);
        const value = area.allocated_value || 0;
        setTempValue(value);
        setInputValue(formatCurrency(value, true));
    };

    const handleUpdateAreaValue = () => {
        const maxAllowed = Math.max(0, availableToAllocate + (editingArea?.allocated_value || 0));
        let finalValue = Math.max(0, tempValue);

        if (tempValue > maxAllowed) {
            finalValue = maxAllowed;
            toast({ title: "Valor excede o saldo!", description: `O valor foi ajustado para o máximo disponível: ${formatCurrency(maxAllowed)}.`, variant: "destructive" });
        }

        const newAreas = areas.map(area =>
            area.name === editingArea.name ? { ...area, allocated_value: finalValue } : area
        );
        setAreas(newAreas);
        setEditingArea(null);
    };

    const handleSave = async () => {
        setIsSaving(true);
        const currentTotalAllocated = getGovernmentBudgetTotal(areas);

        if (currentTotalAllocated > safeTreasuryBalance) {
            toast({ title: 'Orçamento Inválido', description: 'O valor alocado excede o saldo do cofre público.', variant: 'destructive' });
            setIsSaving(false);
            return;
        }

        const newBudgetData = { areas };
        const { error } = await supabase
            .from('system_settings')
            .update({ value: newBudgetData })
            .eq('key', 'government_budget');

        if (error) {
            toast({ title: 'Erro ao salvar orçamento', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Orçamento salvo com sucesso!' });
            onUpdate();
            if(setActiveTab) setActiveTab('finances');
        }
        setIsSaving(false);
    };

    const handleInputChange = (e) => {
        const rawValue = e.target.value;
        setInputValue(rawValue);
        const parsedValue = parseCurrency(rawValue);
        if (!isNaN(parsedValue)) {
            setTempValue(parsedValue);
        }
    };

    return (
        <Card className="glass-effect h-full flex flex-col">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><PiggyBank className="w-6 h-6 text-primary" />Orçamento Governamental</CardTitle>
                <CardDescription>Distribua os recursos do cofre público. Disponível: <span className="text-green-400 font-bold">{formatCurrency(Math.max(0, safeTreasuryBalance - totalAllocated))}</span></CardDescription>
            </CardHeader>
            <CardContent className="flex-grow space-y-4 overflow-y-auto max-h-[500px] pr-4 custom-scrollbar">
                {areas.map((area) => {
                    const AreaIcon = areaIcons[area.name]?.icon || areaIcons.default.icon;
                    const iconColor = areaIcons[area.name]?.color || areaIcons.default.color;
                    return (
                        <div key={area.name} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                            <div className="flex items-center gap-3">
                                <AreaIcon className={`w-5 h-5 ${iconColor}`} />
                                <div>
                                    <p className="font-semibold">{area.name}</p>
                                    <p className="text-sm text-muted-foreground">{formatCurrency(area.allocated_value)}</p>
                                </div>
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => handleEditArea(area)}>Gerenciar</Button>
                        </div>
                    )
                })}
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-4 pt-6">
                <div className="text-center text-sm font-bold">
                    <p>Total Alocado: {formatCurrency(totalAllocated)}</p>
                    <p className="text-xs text-muted-foreground">Disponível no Cofre: {formatCurrency(safeTreasuryBalance)}</p>
                    <Progress value={safeTreasuryBalance > 0 ? (totalAllocated / safeTreasuryBalance) * 100 : 0} className="mt-2 h-2"/>
                </div>
                <Button onClick={handleSave} disabled={isSaving}>
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Salvar Orçamento'}
                </Button>
            </CardFooter>

             <Dialog open={!!editingArea} onOpenChange={() => setEditingArea(null)}>
                <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle>Gerenciar Orçamento: {editingArea?.name}</DialogTitle>
                        <DialogDescription>
                            Defina o valor para esta área. Disponível para alocação: {formatCurrency(availableToAllocate)}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4" >
                        <div>
                            <Label htmlFor="exact-value">Valor Exato</Label>
                            <Input
                                id="exact-value"
                                value={inputValue}
                                onChange={handleInputChange}
                            />
                        </div>
                        <div>
                             <Label>Alocação Visual ({(((Math.max(0, tempValue) || 0) / (Math.max(0, availableToAllocate + (editingArea?.allocated_value || 0)) || 1)) * 100).toFixed(2)}%)</Label>
                             <div onPointerDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                               <Slider
                                  value={[Math.max(0, tempValue)]}
                                  onValueChange={(val) => setTempValue(Math.max(0, val[0]))}
                                  max={Math.max(0, availableToAllocate + (editingArea?.allocated_value || 0))}
                                  step={1000}
                               />
                             </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingArea(null)}>Cancelar</Button>
                        <Button onClick={handleUpdateAreaValue}>Confirmar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

const TaxManager = ({ taxes, onUpdate, setActiveTab }) => {
    const { toast } = useToast();
    const [taxRates, setTaxRates] = useState({});
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (taxes) {
            setTaxRates({
                product_tax: (taxes.product_tax || 0) * 100,
                service_tax: (taxes.service_tax || 0) * 100,
                transaction_tax_value: taxes.transaction_tax?.value ?
                    (taxes.transaction_tax.type === 'percentage' ? taxes.transaction_tax.value * 100 : taxes.transaction_tax.value)
                    : 0,
                transaction_tax_type: taxes.transaction_tax?.type || 'percentage',
            });
        }
    }, [taxes]);

    const handleSave = async () => {
        setIsSaving(true);
        const newTaxData = {
            product_tax: taxRates.product_tax / 100,
            service_tax: taxRates.service_tax / 100,
            transaction_tax: {
                type: taxRates.transaction_tax_type,
                value: taxRates.transaction_tax_type === 'percentage' ? taxRates.transaction_tax_value / 100 : taxRates.transaction_tax_value
            }
        };

        const { error } = await supabase.from('system_settings').update({ value: newTaxData }).eq('key', 'tax_rates');

        if (error) {
            toast({ title: 'Erro ao salvar impostos', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Impostos salvos com sucesso!' });
            onUpdate();
            setActiveTab('finances');
        }
        setIsSaving(false);
    };

    const handleTaxValueChange = (taxName, value) => {
        const numericValue = parseFloat(value);
        if (!isNaN(numericValue)) {
            setTaxRates(prev => ({ ...prev, [taxName]: numericValue }));
        } else if (value === '') {
            setTaxRates(prev => ({ ...prev, [taxName]: 0 }));
        }
    };

    return (
        <Card className="glass-effect h-full flex flex-col">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><BrainCircuit className="w-6 h-6 text-primary" />Gestão de Impostos</CardTitle>
                <CardDescription>Ajuste as alíquotas de impostos do país.</CardDescription>
            </CardHeader>
            <CardContent className="flex-grow space-y-6">
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <Label>Imposto sobre Produtos (IVC)</Label>
                        <div className="flex items-center gap-1 w-24">
                           <Input type="number" value={taxRates.product_tax?.toFixed(2)} onChange={e => handleTaxValueChange('product_tax', e.target.value)} className="h-8 text-right"/>
                           <Percent className="h-4 w-4 text-muted-foreground" />
                        </div>
                    </div>
                    <Slider value={[taxRates.product_tax || 0]} onValueChange={(val) => setTaxRates(p => ({...p, product_tax: val[0]}))} max={100} step={0.01} />
                </div>
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <Label>Imposto sobre Serviços (ISS)</Label>
                         <div className="flex items-center gap-1 w-24">
                           <Input type="number" value={taxRates.service_tax?.toFixed(2)} onChange={e => handleTaxValueChange('service_tax', e.target.value)} className="h-8 text-right"/>
                           <Percent className="h-4 w-4 text-muted-foreground" />
                        </div>
                    </div>
                    <Slider value={[taxRates.service_tax || 0]} onValueChange={(val) => setTaxRates(p => ({...p, service_tax: val[0]}))} max={100} step={0.01} />
                </div>
                 <div className="space-y-4">
                    <Label>Imposto sobre Transações Financeiras (ITF)</Label>
                    <Select value={taxRates.transaction_tax_type} onValueChange={(val) => setTaxRates(p => ({...p, transaction_tax_type: val}))}>
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="percentage">Porcentagem (%)</SelectItem>
                            <SelectItem value="fixed">Valor Fixo (R$)</SelectItem>
                        </SelectContent>
                    </Select>
                     {taxRates.transaction_tax_type === 'percentage' ? (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label>Alíquota Percentual</Label>
                                <div className="flex items-center gap-1 w-24">
                                   <Input type="number" value={taxRates.transaction_tax_value?.toFixed(2)} onChange={e => handleTaxValueChange('transaction_tax_value', e.target.value)} className="h-8 text-right"/>
                                   <Percent className="h-4 w-4 text-muted-foreground" />
                                </div>
                            </div>
                            <Slider value={[taxRates.transaction_tax_value || 0]} onValueChange={(val) => setTaxRates(p => ({...p, transaction_tax_value: val[0]}))} max={100} step={0.01} />
                        </div>
                    ) : (
                        <div>
                            <Label>Valor Fixo por Transação</Label>
                            <Input type="text" value={formatCurrency(taxRates.transaction_tax_value || 0, true)} onChange={(e) => setTaxRates(p => ({...p, transaction_tax_value: parseCurrency(e.target.value)}))} />
                        </div>
                    )}
                </div>
            </CardContent>
            <CardFooter>
                 <Button onClick={handleSave} disabled={isSaving} className="w-full">
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Salvar Impostos'}
                </Button>
            </CardFooter>
        </Card>
    );
};

const FinanceCard = ({ title, value, icon, isCurrency = true, colorClass = 'text-green-400' }) => {
    const Icon = icon;
    return (
        <div className="glass-effect p-4 rounded-lg flex items-center gap-4">
            <div className={`p-3 rounded-md bg-primary/10 ${colorClass}`}>
                <Icon className="w-6 h-6" />
            </div>
            <div>
                <p className="text-sm text-muted-foreground">{title}</p>
                <p className={`text-lg font-bold ${colorClass}`}>{isCurrency ? formatCurrency(value) : value}</p>
            </div>
        </div>
    );
};

const LoanManager = ({ onUpdate, setActiveTab, govFinances }) => {
    const { toast } = useToast();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [amount, setAmount] = useState(1000000);
    const [installments, setInstallments] = useState(12);
    const [isSaving, setIsSaving] = useState(false);

    const availableLoanAmount = govFinances ? govFinances.loan_limit - govFinances.loans_balance : 0;

    const handleTakeLoan = async () => {
        setIsSaving(true);
        const { data, error } = await supabase.rpc('government_take_loan', {
            p_amount: amount,
            p_installments: installments,
        });
        if (error || !data.success) {
            toast({ title: 'Erro ao pegar empréstimo', description: data?.message || error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: data.message });
            onUpdate();
            setIsDialogOpen(false);
            setActiveTab('finances');
        }
        setIsSaving(false);
    };

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                <Button className="w-full"><Coins className="mr-2 h-4 w-4"/>Pegar Empréstimo</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Pegar Empréstimo Governamental</DialogTitle>
                    <DialogDescription>
                        Solicite um empréstimo para o cofre público.
                        <br />
                        <span className="font-bold text-primary">Disponível para empréstimo: {formatCurrency(availableLoanAmount)}</span>
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="amount">Valor do Empréstimo</Label>
                        <Input id="amount" type="text" value={formatCurrency(amount, true)} onChange={e => setAmount(parseCurrency(e.target.value))} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="installments">Parcelas</Label>
                        <Input id="installments" type="number" value={installments} onChange={(e) => setInstallments(parseInt(e.target.value, 10))} />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleTakeLoan} disabled={isSaving}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirmar Empréstimo
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ServicePriceManager = ({ servicePrices, onUpdate, setActiveTab }) => {
    const { toast } = useToast();
    const [prices, setPrices] = useState({});
    const [isSaving, setIsSaving] = useState(false);

    const serviceGroups = {
        'Internet': {
            groupIcon: Wifi,
            services: [
                { key: 'Internet_Básico', label: 'Plano Básico', icon: Package },
                { key: 'Internet_Ultra', label: 'Plano Ultra', icon: Package2 },
                { key: 'Internet_Mega', label: 'Plano Mega', icon: PackageCheck },
            ]
        },
        'Telefonia': {
            groupIcon: Smartphone,
            services: [
                { key: 'Telefonia_Básico', label: 'Plano Básico', icon: Package },
                { key: 'Telefonia_Intermediário', label: 'Plano Intermediário', icon: Package2 },
                { key: 'Telefonia_Premium', label: 'Plano Premium', icon: PackageCheck },
            ]
        },
        'Energia': {
            groupIcon: Zap,
            services: [
                { key: 'Energia Elétrica', label: 'Energia Elétrica', icon: Zap },
            ]
        },
        'Água': {
            groupIcon: Droplet,
            services: [
                { key: 'Água', label: 'Água', icon: Droplet },
            ]
        },
        'Gás': {
            groupIcon: Flame,
            services: [
                { key: 'Gás', label: 'Gás', icon: Flame },
            ]
        }
    };

    useEffect(() => {
        if (servicePrices) {
            setPrices(servicePrices);
        }
    }, [servicePrices]);

    const handlePriceChange = (key, value) => {
        setPrices(prev => ({ ...prev, [key]: parseCurrency(value) }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        const { error } = await supabase.from('system_settings').update({ value: prices }).eq('key', 'basic_service_prices');
        if (error) {
            toast({ title: 'Erro ao salvar preços', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Preços dos serviços atualizados!' });
            onUpdate();
            setActiveTab('finances');
        }
        setIsSaving(false);
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle>Preços dos Serviços Básicos</CardTitle>
                <CardDescription>Defina o valor semanal para os serviços essenciais.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {Object.entries(serviceGroups).map(([groupName, groupData]) => {
                    const GroupIcon = groupData.groupIcon;
                    return (
                        <div key={groupName} className="space-y-4">
                            <div className="flex items-center gap-2">
                                <GroupIcon className="w-5 h-5 text-primary" />
                                <h4 className="font-semibold text-lg text-foreground">{groupName}</h4>
                                <Separator className="flex-grow ml-2" />
                            </div>
                            {groupData.services.map(({ key, label, icon: ServiceIcon }) => (
                                <div key={key} className="flex items-center justify-between pl-4">
                                     <div className="flex items-center gap-2">
                                        <ServiceIcon className="w-4 h-4 text-muted-foreground" />
                                        <Label htmlFor={key}>{label}</Label>
                                    </div>
                                    <Input
                                        id={key}
                                        value={formatCurrency(prices[key] || 0, true)}
                                        onChange={(e) => handlePriceChange(key, e.target.value)}
                                        className="w-32"
                                    />
                                </div>
                            ))}
                        </div>
                    );
                })}
            </CardContent>
            <CardFooter>
                 <Button onClick={handleSave} disabled={isSaving} className="w-full">
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Salvar Preços'}
                </Button>
            </CardFooter>
        </Card>
    );
};

const ConstitutionalStatusCard = ({ executiveState }) => {
    const currentTerm = executiveState?.currentTerm;
    const currentPresident = executiveState?.currentPresidentProfile?.full_name || 'Sem presidente em exercício';
    const currentVice = executiveState?.currentViceProfile?.full_name || 'Vice-Presidente não definido';
    const actingAuthority = executiveState?.actingAuthority?.profile?.full_name || executiveState?.actingAuthority?.label || 'Conselho dos Administradores (CDA)';

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Landmark className="w-6 h-6 text-primary" />
                    Status Constitucional do Executivo
                </CardTitle>
                <CardDescription>
                    A Presidência e a Vice-Presidência são eleitas simultaneamente por voto direto, com mandato de 1 mês e apenas 1 reeleição consecutiva.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm text-muted-foreground">Presidente da República</p>
                        <p className="font-semibold text-foreground mt-1">{currentPresident}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm text-muted-foreground">Vice-Presidente</p>
                        <p className="font-semibold text-foreground mt-1">{currentVice}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm text-muted-foreground">Mandato mensal</p>
                        <p className="text-sm font-medium text-foreground mt-1">
                            {currentTerm
                                ? `${new Date(currentTerm.term_start_at).toLocaleString('pt-BR')} até ${new Date(currentTerm.term_end_at).toLocaleString('pt-BR')}`
                                : 'Nenhum mandato ativo identificado no histórico eleitoral.'}
                        </p>
                    </div>
                </div>

                <div className={`rounded-xl border p-4 ${executiveState?.isVacant ? 'border-amber-500/30 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10'}`}>
                    <div className="flex items-start gap-3">
                        {executiveState?.isVacant ? (
                            <AlertTriangle className="w-5 h-5 text-amber-300 mt-0.5 shrink-0" />
                        ) : (
                            <Shield className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
                        )}
                        <div>
                            <p className="font-semibold text-foreground">
                                {executiveState?.isVacant ? 'Vacância presidencial em curso' : 'Chefia do Executivo regular'}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                                {executiveState?.isVacant
                                    ? `Na vacância, a condução do Executivo passa sucessivamente para ${actingAuthority}.`
                                    : 'Compete privativamente ao Presidente nomear cargos-chave, sancionar ou vetar projetos, promulgar textos aprovados e editar medidas provisórias.'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <Anchor className="w-5 h-5 text-sky-400" />
                        <h4 className="font-semibold text-foreground">Linha de sucessão</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                        {(executiveState?.successionLine || []).map((entry, index) => (
                            <div key={entry.key} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{index + 1}º na ordem</p>
                                <p className="font-semibold text-foreground mt-2">{entry.label}</p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {entry.profile?.full_name || (entry.is_cda ? 'Assunção colegiada excepcional' : 'Sem ocupante definido')}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

const SpecialAppointmentsManager = ({ executiveState, onUpdate, actorId }) => {
    const { toast } = useToast();
    const [availableProfiles, setAvailableProfiles] = useState({});
    const [selectedProfiles, setSelectedProfiles] = useState({});
    const [savingOfficeKey, setSavingOfficeKey] = useState(null);

    useEffect(() => {
        const fetchProfiles = async () => {
            try {
                const entries = await Promise.all(
                    EXECUTIVE_SPECIAL_OFFICES.map(async (office) => {
                        const { data, error } = await supabase
                            .from('profiles')
                            .select('id, full_name, role')
                            .in('role', office.eligibleRoles)
                            .order('full_name', { ascending: true });

                        if (error) {
                            throw error;
                        }

                        return [office.key, data || []];
                    })
                );

                setAvailableProfiles(Object.fromEntries(entries));
            } catch (error) {
                toast({ title: 'Erro ao carregar nomes para nomeação', description: error.message, variant: 'destructive' });
            }
        };

        fetchProfiles();
    }, [toast]);

    const handleAppoint = async (officeKey) => {
        const selectedUserId = selectedProfiles[officeKey];
        if (!selectedUserId) {
            toast({ title: 'Selecione um nome', description: 'Escolha um ocupante antes de concluir a nomeação.', variant: 'destructive' });
            return;
        }

        setSavingOfficeKey(officeKey);
        try {
            await appointExecutiveSpecialOffice(supabase, {
                officeKey,
                userId: selectedUserId,
                actorId,
            });
            toast({ title: 'Nomeação concluída', description: 'O ato foi registrado no Diário Oficial.' });
            await onUpdate();
        } catch (error) {
            toast({ title: 'Erro ao nomear', description: error.message, variant: 'destructive' });
        } finally {
            setSavingOfficeKey(null);
        }
    };

    const handleDismiss = async (officeKey) => {
        setSavingOfficeKey(officeKey);
        try {
            await dismissExecutiveSpecialOffice(supabase, { officeKey, actorId });
            toast({ title: 'Exoneração concluída', description: 'O ato foi registrado no Diário Oficial.' });
            await onUpdate();
        } catch (error) {
            toast({ title: 'Erro ao exonerar', description: error.message, variant: 'destructive' });
        } finally {
            setSavingOfficeKey(null);
        }
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Shield className="w-6 h-6 text-primary" />
                    Nomeações Privativas
                </CardTitle>
                <CardDescription>Defina os ocupantes do comando da Polícia Federal e das Forças Armadas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {EXECUTIVE_SPECIAL_OFFICES.map((office) => {
                    const appointment = executiveState?.settings?.specialAppointmentsDetailed?.[office.key];
                    const officeIcon = office.key === 'armed_forces_commander' ? Anchor : Shield;
                    const OfficeIcon = officeIcon;

                    return (
                        <div key={office.key} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg bg-primary/10">
                                    <OfficeIcon className="w-5 h-5 text-primary" />
                                </div>
                                <div className="flex-1">
                                    <p className="font-semibold text-foreground">{office.label}</p>
                                    <p className="text-sm text-muted-foreground">{office.description}</p>
                                    <p className="text-sm text-foreground mt-2">
                                        Ocupante atual: <span className="font-semibold">{appointment?.profile?.full_name || 'Não designado'}</span>
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_auto] gap-3">
                                <Select value={selectedProfiles[office.key] || ''} onValueChange={(value) => setSelectedProfiles((current) => ({ ...current, [office.key]: value }))}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione um ocupante" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(availableProfiles[office.key] || []).map((profile) => (
                                            <SelectItem key={profile.id} value={profile.id}>
                                                {profile.full_name} ({profile.role})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button onClick={() => handleAppoint(office.key)} disabled={savingOfficeKey === office.key}>
                                    {savingOfficeKey === office.key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                                    Nomear
                                </Button>
                                <Button variant="destructive" onClick={() => handleDismiss(office.key)} disabled={savingOfficeKey === office.key || !appointment}>
                                    {savingOfficeKey === office.key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserX className="mr-2 h-4 w-4" />}
                                    Exonerar
                                </Button>
                            </div>
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
};

const BillReviewManager = ({ executiveState, onUpdate, actorId }) => {
    const { toast } = useToast();
    const [reviewState, setReviewState] = useState(null);
    const [reason, setReason] = useState('');
    const [partialScope, setPartialScope] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const pendingBills = executiveState?.pendingBills || [];
    const recentActions = executiveState?.settings?.billActionsDetailed || [];

    const openReviewDialog = (bill, action) => {
        setReviewState({ bill, action });
        setReason('');
        setPartialScope('');
    };

    const handleConfirm = async () => {
        if (!reviewState?.bill) {
            return;
        }

        if (reviewState.action === 'veto_total' && !reason.trim()) {
            toast({ title: 'Fundamentação obrigatória', description: 'Informe a motivação do veto total.', variant: 'destructive' });
            return;
        }

        if (reviewState.action === 'veto_partial' && (!reason.trim() || !partialScope.trim())) {
            toast({ title: 'Dados incompletos', description: 'Informe a fundamentação e os trechos alcançados pelo veto parcial.', variant: 'destructive' });
            return;
        }

        setIsSaving(true);
        try {
            await reviewPresidentialBill(supabase, {
                bill: reviewState.bill,
                action: reviewState.action,
                actorId,
                reason,
                partialScope,
            });
            toast({ title: 'Ato presidencial registrado', description: 'O projeto foi atualizado e publicado no Diário Oficial.' });
            setReviewState(null);
            await onUpdate();
        } catch (error) {
            toast({ title: 'Erro ao registrar ato presidencial', description: error.message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <FileSignature className="w-6 h-6 text-primary" />
                    Sanção, Promulgação e Veto
                </CardTitle>
                <CardDescription>Projetos aprovados pelo Parlamento aguardam ato presidencial antes de entrarem na ordem jurídica.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {pendingBills.length ? pendingBills.map((bill) => {
                    const isPromulgationOnly = bill.status === 'Aguardando promulgação presidencial' || `${bill.type || ''}`.toUpperCase().includes('PEC');

                    return (
                        <div key={bill.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                            <div className="flex flex-col gap-1">
                                <p className="font-semibold text-foreground">{bill.title}</p>
                                <p className="text-sm text-muted-foreground">
                                    {bill.type || 'Projeto Legislativo'} • {bill.house?.name || 'Casa Legislativa'} • {bill.status}
                                </p>
                                <p className="text-sm text-muted-foreground">{bill.summary || 'Sem ementa cadastrada.'}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button onClick={() => openReviewDialog(bill, isPromulgationOnly ? 'promulgate' : 'sanction')}>
                                    <Megaphone className="mr-2 h-4 w-4" />
                                    {isPromulgationOnly ? 'Promulgar' : 'Sancionar'}
                                </Button>
                                {!isPromulgationOnly && (
                                    <>
                                        <Button variant="outline" onClick={() => openReviewDialog(bill, 'veto_total')}>
                                            Veto total
                                        </Button>
                                        <Button variant="outline" onClick={() => openReviewDialog(bill, 'veto_partial')}>
                                            Veto parcial
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                }) : (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-muted-foreground">
                        Nenhum projeto aguarda ato presidencial neste momento.
                    </div>
                )}

                {recentActions.length ? (
                    <div className="pt-2 space-y-3">
                        <h4 className="font-semibold text-foreground">Últimos atos presidenciais</h4>
                        {recentActions.slice(0, 5).map((action) => (
                            <div key={action.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                                <p className="font-semibold text-foreground">{action.bill_title}</p>
                                <p className="text-sm text-muted-foreground">
                                    Resultado: {action.resulting_status} • {new Date(action.created_at).toLocaleString('pt-BR')}
                                </p>
                                {action.reason ? <p className="text-sm text-muted-foreground mt-1">{action.reason}</p> : null}
                            </div>
                        ))}
                    </div>
                ) : null}
            </CardContent>

            <Dialog open={!!reviewState} onOpenChange={(open) => !open && setReviewState(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {reviewState?.action === 'promulgate' && 'Promulgar texto aprovado'}
                            {reviewState?.action === 'sanction' && 'Sancionar projeto'}
                            {reviewState?.action === 'veto_total' && 'Registrar veto total'}
                            {reviewState?.action === 'veto_partial' && 'Registrar veto parcial'}
                        </DialogTitle>
                        <DialogDescription>
                            {reviewState?.bill?.title}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {(reviewState?.action === 'veto_total' || reviewState?.action === 'veto_partial') && (
                            <div className="grid gap-2">
                                <Label htmlFor="bill-review-reason">Fundamentação</Label>
                                <Textarea
                                    id="bill-review-reason"
                                    rows={5}
                                    value={reason}
                                    onChange={(event) => setReason(event.target.value)}
                                    placeholder="Descreva a motivação constitucional, política ou administrativa do veto."
                                />
                            </div>
                        )}
                        {reviewState?.action === 'veto_partial' && (
                            <div className="grid gap-2">
                                <Label htmlFor="bill-review-scope">Trechos atingidos</Label>
                                <Textarea
                                    id="bill-review-scope"
                                    rows={4}
                                    value={partialScope}
                                    onChange={(event) => setPartialScope(event.target.value)}
                                    placeholder="Liste os dispositivos ou trechos alcançados pelo veto parcial."
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancelar</Button>
                        </DialogClose>
                        <Button onClick={handleConfirm} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirmar ato presidencial
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

const ProvisionalMeasureManager = ({ executiveState, onUpdate, actorId }) => {
    const { toast } = useToast();
    const [formData, setFormData] = useState({ title: '', summary: '', content: '' });
    const [isSaving, setIsSaving] = useState(false);
    const provisionalMeasures = executiveState?.settings?.provisionalMeasuresDetailed || [];

    const handleSubmit = async () => {
        if (!formData.title.trim() || !formData.summary.trim() || !formData.content.trim()) {
            toast({ title: 'Campos obrigatórios', description: 'Preencha título, resumo e conteúdo da medida provisória.', variant: 'destructive' });
            return;
        }

        setIsSaving(true);
        try {
            await createExecutiveProvisionalMeasure(supabase, {
                title: formData.title,
                summary: formData.summary,
                content: formData.content,
                authorId: actorId,
            });
            toast({ title: 'Medida provisória publicada', description: 'A medida provisória passa a valer por até 1 semana, sem prorrogação.' });
            setFormData({ title: '', summary: '', content: '' });
            await onUpdate();
        } catch (error) {
            toast({ title: 'Erro ao criar medida provisória', description: error.message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Clock3 className="w-6 h-6 text-primary" />
                    Medidas Provisórias
                </CardTitle>
                <CardDescription>Medidas provisórias têm força de lei, validade máxima improrrogável de 1 semana e devem ser publicadas oficialmente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="grid gap-2">
                        <Label htmlFor="mp-title">Título</Label>
                        <Input id="mp-title" value={formData.title} onChange={(event) => setFormData((current) => ({ ...current, title: event.target.value }))} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="mp-summary">Resumo</Label>
                        <Textarea id="mp-summary" rows={3} value={formData.summary} onChange={(event) => setFormData((current) => ({ ...current, summary: event.target.value }))} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="mp-content">Conteúdo</Label>
                        <Textarea id="mp-content" rows={8} value={formData.content} onChange={(event) => setFormData((current) => ({ ...current, content: event.target.value }))} />
                    </div>
                    <Button onClick={handleSubmit} disabled={isSaving}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus className="mr-2 h-4 w-4" />}
                        Publicar Medida Provisória
                    </Button>
                </div>

                <div className="space-y-3">
                    <h4 className="font-semibold text-foreground">Histórico recente</h4>
                    {provisionalMeasures.length ? provisionalMeasures.map((measure) => (
                        <div key={measure.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                            <p className="font-semibold text-foreground">{measure.title}</p>
                            <p className="text-sm text-muted-foreground">{measure.summary}</p>
                            <p className="text-xs text-muted-foreground mt-2">
                                Publicada em {new Date(measure.issued_at).toLocaleString('pt-BR')} • Expira em {new Date(measure.expires_at).toLocaleString('pt-BR')} • {measure.status === 'expired' ? 'Expirada' : 'Ativa'}
                            </p>
                        </div>
                    )) : (
                        <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-muted-foreground">
                            Nenhuma medida provisória foi editada no mandato atual.
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

const ResignationManager = ({ onResign }) => {
    const [isSaving, setIsSaving] = useState(false);

    const handleResign = async () => {
        setIsSaving(true);
        await onResign();
        setIsSaving(false);
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle>Ações Presidenciais</CardTitle>
                <CardDescription>Ações de alto nível que afetam seu mandato.</CardDescription>
            </CardHeader>
            <CardContent>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="destructive" className="w-full">
                            <LogOut className="mr-2 h-4 w-4" /> Renunciar ao Cargo
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Confirmar Renúncia</DialogTitle>
                            <DialogDescription>
                                Tem certeza de que deseja renunciar ao cargo de Presidente? Esta ação é irreversível. Você e todos os seus ministros perderão seus cargos e voltarão a ser cidadãos.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                            <Button variant="destructive" onClick={handleResign} disabled={isSaving}>
                                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirmar Renúncia
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};


const PresidentDashboard = () => {
    const { toast } = useToast();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [ministers, setMinisters] = useState([]);
    const [decrees, setDecrees] = useState([]);
    const [budget, setBudget] = useState(null);
    const [taxes, setTaxes] = useState(null);
    const [servicePrices, setServicePrices] = useState(null);
    const [govFinances, setGovFinances] = useState(null);
    const [deficit, setDeficit] = useState(0);
    const [executiveState, setExecutiveState] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [ministersRes, decreesRes, settingsRes, financesRes, executiveStateRes] = await Promise.all([
                supabase.from('ministers').select('*, profile:profiles(id, full_name)'),
                supabase.from('decrees').select('*').order('created_at', { ascending: false }),
                supabase.from('system_settings').select('key, value'),
                supabase.from('government_finances').select('*').single(),
                fetchExecutiveConstitutionalState(supabase),
            ]);

            if (ministersRes.error) throw ministersRes.error;
            if (decreesRes.error) throw decreesRes.error;
            if (settingsRes.error) throw settingsRes.error;
            if (financesRes.error) throw financesRes.error;

            setMinisters(ministersRes.data || []);
            setDecrees(decreesRes.data || []);
            setGovFinances(financesRes.data);
            setExecutiveState(executiveStateRes);

            const settingsMap = settingsRes.data.reduce((acc, item) => {
                acc[item.key] = item.value;
                return acc;
            }, {});

            const budgetData = settingsMap.government_budget || { areas: [] };
            const adjustedBudgetAreas = rebalanceGovernmentBudgetAreas(
                budgetData.areas,
                financesRes.data.treasury_balance
            );
            const normalizedBudgetData = { ...budgetData, areas: adjustedBudgetAreas };

            if (haveGovernmentBudgetAreasChanged(budgetData.areas, adjustedBudgetAreas)) {
                const { error: budgetSaveError } = await supabase
                    .from('system_settings')
                    .update({ value: normalizedBudgetData })
                    .eq('key', 'government_budget');

                if (budgetSaveError) {
                    throw budgetSaveError;
                }
            }

            setBudget(normalizedBudgetData);
            setTaxes(settingsMap.tax_rates || { product_tax: 0, service_tax: 0, transaction_tax: { type: 'percentage', value: 0 } });
            setServicePrices(settingsMap.basic_service_prices || {});

            const totalAllocated = getGovernmentBudgetTotal(adjustedBudgetAreas);
            setDeficit(financesRes.data.treasury_balance - totalAllocated);

        } catch (error) {
            toast({ title: 'Erro ao carregar dados', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleResignation = async () => {
        const { data, error } = await supabase.rpc('resign_presidency');
        if (error || !data.success) {
            toast({ title: 'Erro ao renunciar', description: data?.message || error.message, variant: 'destructive' });
        } else {
            try {
                await markExecutiveOfficeVacancy(supabase, {
                    reason: 'Renúncia presidencial.',
                    triggeredBy: user?.id || null,
                });
            } catch (vacancyError) {
                console.error('Erro ao registrar vacância presidencial:', vacancyError);
            }
            toast({ title: 'Renúncia Aceita', description: data.message });
            navigate('/');
            window.location.reload(); // Forçar recarregamento para atualizar o estado do usuário
        }
    };


    if (loading) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin w-16 h-16" /></div>;
    }

    const cardUsage = govFinances ? (govFinances.corporate_card_used / govFinances.corporate_card_limit) * 100 : 0;
    const loanUsage = govFinances ? (govFinances.loans_balance / govFinances.loan_limit) * 100 : 0;

    const corporateCardValue = govFinances
        ? `${formatCurrency(govFinances.corporate_card_used)} / ${formatCurrency(govFinances.corporate_card_limit)}`
        : 'R$ 0,00';

    const availableTreasury = govFinances
        ? Math.max(0, govFinances.treasury_balance - getGovernmentBudgetTotal(budget?.areas || []))
        : 0;

    return (
        <>
            <Helmet>
                <title>Painel Presidencial - GOV.RP</title>
                <meta name="description" content="Gerencie o governo, ministros, decretos e o orçamento." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Landmark}
                    title="Painel"
                    gradientText="Presidencial"
                    description="O centro de comando da nação. Administre o futuro do país."
                    iconColor="text-amber-400"
                    centered={true}
                />

                <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <div className="overflow-x-auto custom-scrollbar -mx-4 px-4 pb-2">
                        <TabsList className="inline-flex min-w-max w-max gap-2">
                            <TabsTrigger value="overview" className="min-w-[9.5rem] shrink-0">Visão Geral</TabsTrigger>
                            <TabsTrigger value="finances" className="min-w-[8.5rem] shrink-0">Finanças</TabsTrigger>
                            <TabsTrigger value="management" className="min-w-[13rem] shrink-0">Gestão Governamental</TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="overview" className="mt-6 space-y-8">
                        {/* Estatísticas Principais (Cards Superiores) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {govFinances && (
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                                    <FinanceCard title="Cofre Público (Disponível)" value={availableTreasury} icon={University} colorClass="text-emerald-400" />
                                </motion.div>
                            )}
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                                <FinanceCard title={deficit >= 0 ? "Superávit Orçamentário" : "Déficit Orçamentário"} value={Math.abs(deficit)} icon={deficit >= 0 ? TrendingUp : TrendingDown} colorClass={deficit >= 0 ? 'text-green-400' : 'text-red-400'} />
                            </motion.div>
                            {govFinances && (
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                                    <FinanceCard title="Empréstimos Ativos" value={govFinances.loans_balance} icon={Handshake} colorClass="text-amber-400" />
                                </motion.div>
                            )}
                            {govFinances && (
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                                    <FinanceCard title="Uso do Cartão Governamental" value={corporateCardValue} icon={CreditCard} isCurrency={false} colorClass="text-orange-400" />
                                </motion.div>
                            )}
                        </div>

                        {/* Elementos Secundários: Gráficos ou Progresso */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
                            {govFinances && (
                                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }}>
                                    <Card className="glass-effect overflow-hidden border-t-4 border-t-orange-500/50">
                                        <CardHeader className="bg-black/20 pb-4">
                                            <CardTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5 text-orange-400"/> Status do Cartão do Governo</CardTitle>
                                            <CardDescription>Limite total e utilização vigente</CardDescription>
                                        </CardHeader>
                                        <CardContent className="p-6">
                                            <div className="flex justify-between items-end mb-2">
                                                <div>
                                                    <p className="text-3xl font-bold text-orange-400">{formatCurrency(govFinances.corporate_card_used)}</p>
                                                    <p className="text-sm text-muted-foreground mt-1">Utilizado do limite de {formatCurrency(govFinances.corporate_card_limit)}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xl font-bold">{cardUsage.toFixed(1)}%</p>
                                                </div>
                                            </div>
                                            <Progress value={cardUsage} className="h-3 bg-muted" indicatorClassName={`${cardUsage > 80 ? 'bg-red-500' : cardUsage > 50 ? 'bg-orange-500' : 'bg-green-500'}`} />
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )}
                            
                            {govFinances && (
                                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6 }}>
                                    <Card className="glass-effect overflow-hidden border-t-4 border-t-amber-500/50">
                                        <CardHeader className="bg-black/20 pb-4">
                                            <CardTitle className="flex items-center gap-2"><Handshake className="w-5 h-5 text-amber-400"/> Capacidade de Empréstimo</CardTitle>
                                            <CardDescription>Histórico e limites de tomada de crédito</CardDescription>
                                        </CardHeader>
                                        <CardContent className="p-6">
                                            <div className="flex justify-between items-end mb-2">
                                                <div>
                                                    <p className="text-3xl font-bold text-amber-400">{formatCurrency(govFinances.loans_balance)}</p>
                                                    <p className="text-sm text-muted-foreground mt-1">Dívida sobre limite de {formatCurrency(govFinances.loan_limit)}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xl font-bold">{loanUsage.toFixed(1)}%</p>
                                                </div>
                                            </div>
                                            <Progress value={loanUsage} className="h-3 bg-muted" indicatorClassName={`${loanUsage > 80 ? 'bg-red-500' : loanUsage > 50 ? 'bg-amber-500' : 'bg-green-500'}`} />
                                            {loanUsage >= 100 && (
                                                <p className="text-xs text-red-500 mt-4 text-center">Nação atingiu o topo do limite de dívidas permitido no momento.</p>
                                            )}
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )}
                        </div>
                    </TabsContent>

                    <TabsContent value="finances" className="mt-6">
                        <Tabs defaultValue="budget" className="w-full">
                            <div className="overflow-x-auto custom-scrollbar -mx-4 px-4 pb-2 mb-6">
                                <TabsList className="inline-flex min-w-max w-max gap-2 border-b border-border/40 bg-transparent p-0">
                                    <TabsTrigger value="budget" className="min-w-[14rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6">Orçamento Governamental</TabsTrigger>
                                    <TabsTrigger value="taxes" className="min-w-[12rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6">Gestão de Impostos</TabsTrigger>
                                    <TabsTrigger value="prices" className="min-w-[14rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6">Valores de Tarifas Base</TabsTrigger>
                                    <TabsTrigger value="actions" className="min-w-[11rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6">Empréstimos/Cofre</TabsTrigger>
                                </TabsList>
                            </div>

                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                                <TabsContent value="budget" className="mt-0">
                                    <div className="max-w-4xl mx-auto">
                                        {budget && govFinances && <BudgetManager budget={budget} treasuryBalance={govFinances.treasury_balance} onUpdate={fetchData} setActiveTab={setActiveTab} />}
                                    </div>
                                </TabsContent>
                                
                                <TabsContent value="taxes" className="mt-0">
                                    <div className="max-w-3xl mx-auto">
                                        {taxes && <TaxManager taxes={taxes} onUpdate={fetchData} setActiveTab={setActiveTab} />}
                                    </div>
                                </TabsContent>
                                
                                <TabsContent value="prices" className="mt-0">
                                    <div className="max-w-3xl mx-auto">
                                        {servicePrices && <ServicePriceManager servicePrices={servicePrices} onUpdate={fetchData} setActiveTab={setActiveTab} />}
                                    </div>
                                </TabsContent>
                                
                                <TabsContent value="actions" className="mt-0">
                                    <div className="max-w-xl mx-auto pt-8">
                                        <Card className="glass-effect">
                                            <CardHeader className="text-center">
                                                <CardTitle className="text-2xl">Ações de Cofre</CardTitle>
                                                {govFinances && (
                                                    <CardDescription className="text-base">
                                                        Margem atual pré-aprovada para empréstimos: <br/><span className="text-green-400 font-bold text-lg">{formatCurrency(govFinances.loan_limit - govFinances.loans_balance)}</span>
                                                    </CardDescription>
                                                )}
                                            </CardHeader>
                                            <CardContent className="flex justify-center pb-8">
                                                <LoanManager onUpdate={fetchData} setActiveTab={setActiveTab} govFinances={govFinances} />
                                            </CardContent>
                                        </Card>
                                    </div>
                                </TabsContent>
                            </motion.div>
                        </Tabs>
                    </TabsContent>

                    <TabsContent value="management" className="mt-6">
                        <Tabs defaultValue="constitutional" className="w-full">
                            <div className="overflow-x-auto custom-scrollbar -mx-4 px-4 pb-2 mb-6">
                                <TabsList className="inline-flex min-w-max w-max gap-2 border-b border-border/40 bg-transparent p-0">
                                    <TabsTrigger value="constitutional" className="min-w-[14rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6">Constituição Executiva</TabsTrigger>
                                    <TabsTrigger value="ministers" className="min-w-[8rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6">Ministros</TabsTrigger>
                                    <TabsTrigger value="decrees" className="min-w-[14rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6">Decretos Presidenciais</TabsTrigger>
                                    <TabsTrigger value="resignation" className="min-w-[8rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6">Renúncia</TabsTrigger>
                                </TabsList>
                            </div>

                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                                <TabsContent value="constitutional" className="mt-0">
                                    <div className="space-y-6 max-w-5xl mx-auto">
                                        <ConstitutionalStatusCard executiveState={executiveState} />
                                        <SpecialAppointmentsManager executiveState={executiveState} onUpdate={fetchData} actorId={user?.id} />
                                        <BillReviewManager executiveState={executiveState} onUpdate={fetchData} actorId={user?.id} />
                                        <ProvisionalMeasureManager executiveState={executiveState} onUpdate={fetchData} actorId={user?.id} />
                                    </div>
                                </TabsContent>

                                <TabsContent value="ministers" className="mt-0">
                                    <div className="max-w-4xl mx-auto">
                                        <MinisterManager ministers={ministers} onUpdate={fetchData} />
                                    </div>
                                </TabsContent>

                                <TabsContent value="decrees" className="mt-0">
                                    <div className="max-w-4xl mx-auto">
                                        <DecreeManager decrees={decrees} onUpdate={fetchData} />
                                    </div>
                                </TabsContent>

                                <TabsContent value="resignation" className="mt-0">
                                    <div className="max-w-xl mx-auto pt-8">
                                        <ResignationManager onResign={handleResignation} />
                                    </div>
                                </TabsContent>
                            </motion.div>
                        </Tabs>
                    </TabsContent>
                </Tabs>
            </div>
        </>
    );
};

export default PresidentDashboard;
