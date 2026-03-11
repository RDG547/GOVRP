import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Edit, Trash2, Search, Wallet, Crown, KeyRound, Filter, CreditCard, User, Shield, Scale, Gavel, Briefcase, GraduationCap, Building, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from "@/components/ui/dialog";
import { parseCurrency, formatCurrency } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';

const ModifyBalanceDialog = ({ user, onFinish }) => {
    const [amount, setAmount] = useState('');
    const [action, setAction] = useState('add');
    const [reason, setReason] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const { toast } = useToast();

    const formatCurrencyInput = (value) => {
        // Remove tudo que não é dígito
        const digits = value.replace(/\D/g, '');
        
        // Se não há dígitos, retorna R$ 0,00
        if (!digits) return 'R$ 0,00';
        
        // Converte para número e divide por 100 para obter os centavos
        const numericValue = parseInt(digits, 10) / 100;
        
        // Formata como moeda brasileira
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 2
        }).format(numericValue);
    };

    const handleAmountChange = (e) => {
        const inputValue = e.target.value;
        const formattedValue = formatCurrencyInput(inputValue);
        setAmount(formattedValue);
    };

    const parseCurrencyInput = (formattedValue) => {
        // Remove "R$", espaços e substitui vírgula por ponto
        const numericString = formattedValue
            .replace('R$', '')
            .replace(/\./g, '')
            .replace(',', '.')
            .trim();
        
        return parseFloat(numericString) || 0;
    };

    const handleSubmit = async () => {
        setIsProcessing(true);
        const numericAmount = parseCurrencyInput(amount);

        if (numericAmount <= 0 || !reason) {
            toast({ title: 'Erro de Validação', description: 'Por favor, insira um valor válido e um motivo.', variant: 'destructive' });
            setIsProcessing(false);
            return;
        }

        const { data, error } = await supabase.rpc('admin_modify_balance', {
            p_user_id: user.id,
            p_amount: numericAmount,
            p_action: action,
            p_reason: reason
        });

        if (error || !data.success) {
            toast({ title: "Erro ao modificar saldo", description: data?.message || error?.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso", description: data.message });
            onFinish();
        }
        setIsProcessing(false);
    };
    
    return (
        <DialogContent className="glass-effect text-white">
            <DialogHeader>
                <DialogTitle>Modificar Saldo de {user.full_name}</DialogTitle>
                <DialogDescription>
                    Adicione ou remova fundos da conta. Saldo atual: <span className="font-bold text-green-400">{formatCurrency(user.balance ?? 0)}</span>
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div>
                    <Label htmlFor="action">Ação</Label>
                    <Select value={action} onValueChange={setAction}>
                        <SelectTrigger id="action" className="w-full">
                            <SelectValue placeholder="Selecione uma ação" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="add">Adicionar Dinheiro</SelectItem>
                            <SelectItem value="remove">Remover Dinheiro</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label htmlFor="amount">Valor</Label>
                    <Input 
                        id="amount" 
                        value={amount} 
                        onChange={handleAmountChange}
                        placeholder="R$ 0,00" 
                    />
                </div>
                <div>
                    <Label htmlFor="reason">Motivo</Label>
                    <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: Prêmio de evento" />
                </div>
            </div>
            <DialogFooter>
                <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                <Button onClick={handleSubmit} disabled={isProcessing}>{isProcessing && <Loader2 className="animate-spin mr-2 w-4 h-4"/>} Confirmar</Button>
            </DialogFooter>
        </DialogContent>
    );
};

const EditUserDialog = ({ user, onFinish, onUpdate }) => {
    const [formData, setFormData] = useState({
        full_name: user.full_name || '',
        username: user.username || '',
        role: user.role || 'Cidadão',
        titles: user.titles?.join(', ') || ''
    });
    const [isProcessing, setIsProcessing] = useState(false);
    const { toast } = useToast();

    const handleChange = (e) => {
        setFormData(prev => ({ ...prev, [e.target.id]: e.target.value }));
    };
    
    const handleRoleChange = (newRole) => {
        setFormData(prev => ({...prev, role: newRole}));
    };

    const handleSubmit = async () => {
        setIsProcessing(true);
        const titlesArray = formData.titles.split(',').map(t => t.trim()).filter(Boolean);
        
        const { data, error } = await supabase.rpc('admin_update_user', {
            p_user_id: user.id,
            p_full_name: formData.full_name,
            p_username: formData.username,
            p_role: formData.role,
            p_titles: titlesArray
        });

        if (error || !data.success) {
            toast({ title: "Erro ao atualizar", description: data?.message || error?.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso", description: data.message });
            onUpdate();
            onFinish();
        }
        setIsProcessing(false);
    };

    const availableRoles = ['Usuário', 'Cidadão', 'Admin', 'Presidente', 'Presidente da Câmara', 'Presidente do Senado', 'Deputado', 'Senador', 'Juiz', 'Policial', 'Ministro', 'Agente Secreto', 'Militar'];

    return (
        <DialogContent className="glass-effect text-white">
            <DialogHeader>
                <DialogTitle>Editar Usuário: {user.full_name}</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div><Label htmlFor="full_name">Nome Completo</Label><Input id="full_name" value={formData.full_name} onChange={handleChange} /></div>
                <div><Label htmlFor="username">Username</Label><Input id="username" value={formData.username} onChange={handleChange} /></div>
                <div>
                    <Label htmlFor="role">Cargo</Label>
                    <Select value={formData.role} onValueChange={handleRoleChange}>
                        <SelectTrigger id="role"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-[200px] overflow-y-auto">
                            {availableRoles.map(role => (
                                <SelectItem key={role} value={role}>{role}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div><Label htmlFor="titles">Títulos (separados por vírgula)</Label><Input id="titles" value={formData.titles} onChange={handleChange} /></div>
            </div>
            <DialogFooter>
                <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                <Button onClick={handleSubmit} disabled={isProcessing}>{isProcessing && <Loader2 className="animate-spin mr-2 w-4 h-4"/>} Salvar</Button>
            </DialogFooter>
        </DialogContent>
    );
};

const ChangePasswordDialog = ({ user, onFinish }) => {
    const [newPassword, setNewPassword] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const { toast } = useToast();

    const handleSubmit = async () => {
        setIsProcessing(true);
        if (newPassword.length < 6) {
            toast({ title: 'Senha muito curta', description: 'A nova senha deve ter no mínimo 6 caracteres.', variant: 'destructive' });
            setIsProcessing(false);
            return;
        }

        try {
            const { data, error } = await supabase.functions.invoke('admin-update-user-password', {
                body: { userId: user.id, newPassword },
            });

            if (error) throw error;
            
            toast({ title: 'Sucesso!', description: `A senha de ${user.full_name} foi alterada.` });
            onFinish();

        } catch (error) {
             toast({ title: 'Erro ao alterar senha', description: error.message, variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <DialogContent className="glass-effect text-white">
            <DialogHeader>
                <DialogTitle>Alterar Senha de {user.full_name}</DialogTitle>
                <DialogDescription>Digite a nova senha para o usuário. Ele será desconectado e precisará usar a nova senha para entrar.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div>
                    <Label htmlFor="new-password">Nova Senha</Label>
                    <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
                </div>
            </div>
            <DialogFooter>
                <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                <Button onClick={handleSubmit} disabled={isProcessing}>{isProcessing && <Loader2 className="animate-spin mr-2 w-4 h-4"/>} Definir Nova Senha</Button>
            </DialogFooter>
        </DialogContent>
    );
};

const ManageCardLimitDialog = ({ user, onFinish, onUpdate }) => {
    const [cards, setCards] = useState([]);
    const [selectedCard, setSelectedCard] = useState(null);
    const [newLimit, setNewLimit] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        const fetchCards = async () => {
            setLoading(true);
            const { data, error } = await supabase.from('cards').select('*').eq('user_id', user.id);
            if (error) {
                toast({ title: "Erro ao buscar cartões", variant: "destructive" });
            } else {
                setCards(data);
                if (data.length > 0) {
                    setSelectedCard(data[0]);
                    setNewLimit(formatCurrency(data[0].card_limit, true));
                }
            }
            setLoading(false);
        };
        fetchCards();
    }, [user.id, toast]);

    const handleCardChange = (cardId) => {
        const card = cards.find(c => c.id === cardId);
        setSelectedCard(card);
        setNewLimit(formatCurrency(card.card_limit, true));
    };

    const handleSave = async () => {
        setSaving(true);
        const limit = parseCurrency(newLimit);
        const { error } = await supabase.from('cards').update({ card_limit: limit }).eq('id', selectedCard.id);
        if (error) {
            toast({ title: "Erro ao atualizar limite", variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: "Limite do cartão atualizado." });
            onUpdate();
            onFinish();
        }
        setSaving(false);
    };

    return (
        <DialogContent className="glass-effect text-white">
            <DialogHeader>
                <DialogTitle>Gerenciar Limite de Crédito</DialogTitle>
                <DialogDescription>Ajuste o limite dos cartões de crédito de {user.full_name}.</DialogDescription>
            </DialogHeader>
            {loading ? <Loader2 className="animate-spin mx-auto" /> : (
                <div className="py-4 space-y-4">
                    <Select onValueChange={handleCardChange} value={selectedCard?.id}>
                        <SelectTrigger><SelectValue placeholder="Selecione um cartão" /></SelectTrigger>
                        <SelectContent>
                            {cards.map(c => <SelectItem key={c.id} value={c.id}>{c.brand} final {c.card_number.slice(-4)}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    {selectedCard && (
                        <div>
                            <Label htmlFor="new-limit">Novo Limite</Label>
                            <Input id="new-limit" value={newLimit} onChange={e => setNewLimit(formatCurrency(e.target.value, true))} />
                            <p className="text-xs text-muted-foreground mt-1">Limite atual: {formatCurrency(selectedCard.card_limit)}</p>
                        </div>
                    )}
                </div>
            )}
            <DialogFooter>
                <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                <Button onClick={handleSave} disabled={saving || !selectedCard}>{saving && <Loader2 className="animate-spin mr-2"/>} Salvar Limite</Button>
            </DialogFooter>
        </DialogContent>
    );
};

const roleConfig = {
    'Admin': { color: 'text-red-400', bg: 'bg-red-500/80', icon: Crown },
    'Presidente': { color: 'text-yellow-400', bg: 'bg-yellow-500/80', icon: Crown },
    'Presidente da Câmara': { color: 'text-sky-300', bg: 'bg-sky-600/80', icon: Gavel },
    'Presidente do Senado': { color: 'text-blue-300', bg: 'bg-blue-600/80', icon: Gavel },
    'Ministro': { color: 'text-purple-400', bg: 'bg-purple-500/80', icon: Briefcase },
    'Senador': { color: 'text-blue-400', bg: 'bg-blue-500/80', icon: Scale },
    'Deputado': { color: 'text-sky-400', bg: 'bg-sky-500/80', icon: Scale },
    'Juiz': { color: 'text-gray-300', bg: 'bg-gray-400/80', icon: Gavel },
    'Policial': { color: 'text-indigo-400', bg: 'bg-indigo-500/80', icon: Shield },
    'Agente Secreto': { color: 'text-zinc-300', bg: 'bg-zinc-600/80', icon: User },
    'Militar': { color: 'text-green-400', bg: 'bg-green-600/80', icon: Shield },
    'Usuário': { color: 'text-gray-400', bg: 'bg-gray-500/50', icon: User },
    'Cidadão': { color: 'text-gray-400', bg: 'bg-gray-500/50', icon: User },
    'default': { color: 'text-gray-400', bg: 'bg-gray-500/50', icon: User }
};

const USERS_PER_PAGE = 12;

const UserManagement = () => {
    const { user: adminUser } = useAuth();
    const { toast } = useToast();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingUser, setEditingUser] = useState(null);
    const [modifyingBalanceUser, setModifyingBalanceUser] = useState(null);
    const [changingPasswordUser, setChangingPasswordUser] = useState(null);
    const [managingCardLimitUser, setManagingCardLimitUser] = useState(null);
    const [filters, setFilters] = useState({ letter: 'all', role: 'all', balance: [0, 1000000] });
    const [maxBalance, setMaxBalance] = useState(1000000);
    const [currentPage, setCurrentPage] = useState(1);

    const fetchUsers = useCallback(async () => {
        const { data, error } = await supabase.rpc('admin_get_all_users');
        if (error) {
            toast({ title: "Erro ao buscar usuários", description: error.message, variant: "destructive" });
        } else {
            setUsers(data || []);
            const max = Math.max(...data.map(u => u.balance || 0), 1000000);
            setMaxBalance(max);
            setFilters(f => ({ ...f, balance: [f.balance[0], max] }));
        }
        setLoading(false);
    }, [toast]);

    useEffect(() => {
        if(adminUser?.role === 'Admin') {
            setLoading(true);
            fetchUsers();
        } else {
            setLoading(false);
        }
    }, [fetchUsers, adminUser]);
    
    const handleDeleteUser = async (userId, userName) => {
        const { error } = await supabase.rpc('admin_delete_user', { p_user_id: userId });
        if (error) {
            toast({ title: 'Erro ao excluir', description: error.message, variant: "destructive" });
        } else {
            toast({ title: 'Usuário excluído!', description: `O usuário ${userName} foi removido.` });
            fetchUsers();
        }
    };
    
    const handleBalanceModificationFinish = () => {
        setModifyingBalanceUser(null);
        fetchUsers();
    };

    const roleOrder = [
        'Admin', 'Presidente', 'Presidente da Câmara', 'Presidente do Senado', 'Ministro', 'Senador', 'Deputado', 
        'Juiz', 'Policial', 'Agente Secreto', 'Militar', 'Cidadão', 'Usuário'
    ];

    const sortedAndFilteredUsers = useMemo(() => {
        return users
            .filter(user => {
                const nameMatch = (user.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                                  (user.username || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                                  (user.email || '').toLowerCase().includes(searchTerm.toLowerCase());
                const letterMatch = filters.letter === 'all' || (user.full_name || ' ').toLowerCase().startsWith(filters.letter);
                const roleMatch = filters.role === 'all' || user.role === filters.role;
                const balanceMatch = (user.balance || 0) >= filters.balance[0] && (user.balance || 0) <= filters.balance[1];
                return nameMatch && letterMatch && roleMatch && balanceMatch;
            })
            .sort((a, b) => {
                const roleAIndex = roleOrder.indexOf(a.role || 'Usuário');
                const roleBIndex = roleOrder.indexOf(b.role || 'Usuário');
                const finalRoleAIndex = roleAIndex === -1 ? roleOrder.length : roleAIndex;
                const finalRoleBIndex = roleBIndex === -1 ? roleOrder.length : roleBIndex;
                if (finalRoleAIndex !== finalRoleBIndex) {
                    return finalRoleAIndex - finalRoleBIndex;
                }
                return (a.full_name || '').localeCompare(b.full_name || '');
            });
    }, [users, searchTerm, filters, roleOrder]);

    const totalPages = Math.ceil(sortedAndFilteredUsers.length / USERS_PER_PAGE);

    const paginatedUsers = useMemo(() => {
        const startIndex = (currentPage - 1) * USERS_PER_PAGE;
        return sortedAndFilteredUsers.slice(startIndex, startIndex + USERS_PER_PAGE);
    }, [sortedAndFilteredUsers, currentPage]);

    if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>;
    if (adminUser?.role !== 'Admin') return <div className="text-center py-10 text-white">Acesso não autorizado.</div>;

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const allRoles = [...new Set(users.map(u => u.role).filter(Boolean))].sort();

    let lastRole = null;

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">Gerenciamento de Usuários</h2>
            <div className="flex flex-wrap gap-4 items-center">
                <div className="relative flex-grow max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5"/>
                    <Input placeholder="Buscar por nome, username ou email..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} className="pl-10" />
                </div>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline"><Filter className="w-4 h-4 mr-2" />Filtros</Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80">
                        <div className="grid gap-4">
                            <div className="space-y-2">
                                <h4 className="font-medium leading-none">Filtros</h4>
                                <p className="text-sm text-muted-foreground">Ajuste os filtros de exibição.</p>
                            </div>
                            <div className="grid gap-2">
                                <Label>Letra Inicial</Label>
                                <Select value={filters.letter} onValueChange={(v) => { setFilters(f => ({...f, letter: v})); setCurrentPage(1); }}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Todas</SelectItem>
                                        {alphabet.map(l => <SelectItem key={l} value={l.toLowerCase()}>{l}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Cargo</Label>
                                <Select value={filters.role} onValueChange={(v) => { setFilters(f => ({...f, role: v})); setCurrentPage(1); }}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Todos</SelectItem>
                                        {allRoles.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Saldo ({formatCurrency(filters.balance[0])} - {formatCurrency(filters.balance[1])})</Label>
                                <Slider
                                    defaultValue={[filters.balance[0], filters.balance[1]]}
                                    max={maxBalance}
                                    step={1000}
                                    onValueChange={(value) => { setFilters(f => ({...f, balance: value})); setCurrentPage(1); }}
                                />
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
            <div className="overflow-x-auto rounded-lg border border-white/10 w-full">
                <table className="w-full text-sm text-left text-gray-300 table-fixed">
                    <thead className="text-xs text-gray-400 uppercase bg-black/20">
                        <tr>
                            <th scope="col" className="px-6 py-3 w-[25%]">Usuário</th>
                            <th scope="col" className="px-6 py-3 w-[25%]">Email</th>
                            <th scope="col" className="px-6 py-3 w-[15%]">Saldo</th>
                            <th scope="col" className="px-6 py-3 text-center w-[15%]">Cargo</th>
                            <th scope="col" className="px-6 py-3 text-right w-[20%]">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedUsers.length > 0 ? paginatedUsers.map((user, index) => {
                             const showSeparator = user.role !== lastRole && lastRole !== null;
                             lastRole = user.role;
                             const roleColorClass = roleConfig[user.role]?.color || roleConfig.default.color;
                             return (
                                <React.Fragment key={user.id}>
                                {showSeparator && (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-2">
                                            <div className="flex items-center overflow-hidden">
                                                <Separator className="flex-1 bg-border min-w-0" />
                                                <span className={`px-4 text-xs font-semibold uppercase whitespace-nowrap ${roleColorClass}`}>{user.role}s</span>
                                                <Separator className="flex-1 bg-border min-w-0" />
                                            </div>
                                        </td>
                                    </tr>
                                )}
                                <UserRow user={user} adminUser={adminUser} setModifyingBalanceUser={setModifyingBalanceUser} setChangingPasswordUser={setChangingPasswordUser} setEditingUser={setEditingUser} handleDeleteUser={handleDeleteUser} setManagingCardLimitUser={setManagingCardLimitUser} />
                               </React.Fragment>
                             )
                        }) : (
                            <tr><td colSpan="5" className="text-center py-8 text-muted-foreground">Nenhum usuário encontrado com os filtros aplicados.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            {totalPages > 1 && (
                <div className="flex justify-center items-center gap-4 mt-4">
                    <Button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} variant="outline"><ChevronLeft className="w-4 h-4" /></Button>
                    <span className="text-sm text-muted-foreground">Página {currentPage} de {totalPages}</span>
                    <Button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} variant="outline"><ChevronRight className="w-4 h-4" /></Button>
                </div>
            )}
            {editingUser && (
                <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
                    <EditUserDialog user={editingUser} onFinish={() => setEditingUser(null)} onUpdate={fetchUsers} />
                </Dialog>
            )}
            {modifyingBalanceUser && (
                <Dialog open={!!modifyingBalanceUser} onOpenChange={() => setModifyingBalanceUser(null)}>
                    <ModifyBalanceDialog user={modifyingBalanceUser} onFinish={handleBalanceModificationFinish} />
                </Dialog>
            )}
            {changingPasswordUser && (
                <Dialog open={!!changingPasswordUser} onOpenChange={() => setChangingPasswordUser(null)}>
                    <ChangePasswordDialog user={changingPasswordUser} onFinish={() => setChangingPasswordUser(null)} />
                </Dialog>
            )}
            {managingCardLimitUser && (
                <Dialog open={!!managingCardLimitUser} onOpenChange={() => setManagingCardLimitUser(null)}>
                    <ManageCardLimitDialog user={managingCardLimitUser} onFinish={() => setManagingCardLimitUser(null)} onUpdate={fetchUsers} />
                </Dialog>
            )}
        </div>
    );
};

const UserRow = ({ user, adminUser, setModifyingBalanceUser, setChangingPasswordUser, setEditingUser, handleDeleteUser, setManagingCardLimitUser }) => {
    const config = roleConfig[user.role] || roleConfig.default;
    const Icon = config.icon;

    return (
        <tr className="border-b border-slate-700 hover:bg-slate-800/50 transition-colors">
            <td className="px-6 py-4">
                <div className="font-medium text-white">{user.full_name}</div>
                <div className="text-xs text-gray-400">@{user.username}</div>
            </td>
            <td className="px-6 py-4 text-gray-400 truncate">{user.email}</td>
            <td className="px-6 py-4 font-mono text-green-400">
                {user.has_bank_account ? formatCurrency(user.balance ?? 0) : <span className="text-gray-500">N/A</span>}
            </td>
            <td className="px-6 py-4 text-center">
              <Badge className={`text-white ${config.bg}`}>
                <Icon className="w-3 h-3 mr-1"/>
                {user.role}
              </Badge>
            </td>
            <td className="px-6 py-4 text-right space-x-2">
                {user.has_bank_account && (
                    <>
                        <Button variant="ghost" size="icon" onClick={() => setModifyingBalanceUser(user)} title="Modificar Saldo">
                            <Wallet className="w-4 h-4 text-green-400" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setManagingCardLimitUser(user)} title="Gerenciar Limite do Cartão">
                            <CreditCard className="w-4 h-4 text-purple-400" />
                        </Button>
                    </>
                )}
                <Button variant="ghost" size="icon" onClick={() => setChangingPasswordUser(user)} title="Alterar Senha">
                    <KeyRound className="w-4 h-4 text-yellow-400" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setEditingUser({...user})} title="Editar Usuário">
                    <Edit className="w-4 h-4 text-blue-400" />
                </Button>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={user.id === adminUser.id} title="Excluir Usuário">
                            <Trash2 className="w-4 h-4 text-red-400" />
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="glass-effect text-white">
                        <DialogHeader><DialogTitle>Confirmar Exclusão</DialogTitle><DialogDescription className="text-gray-300">Tem certeza que deseja excluir o usuário {user.full_name}? Esta ação é irreversível e removerá todos os dados associados.</DialogDescription></DialogHeader>
                        <DialogFooter><DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose><Button variant="destructive" onClick={() => handleDeleteUser(user.id, user.full_name)}>Excluir Permanentemente</Button></DialogFooter>
                    </DialogContent>
                </Dialog>
            </td>
        </tr>
    );
};

export default UserManagement;