
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Edit, Trash2, Shield, Search, PlusCircle, MinusCircle, Wallet } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { parseCurrency, formatCurrency } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"


const ModifyBalanceDialog = ({ user, onFinish }) => {
    const [amount, setAmount] = useState('');
    const [action, setAction] = useState('add');
    const [reason, setReason] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const { toast } = useToast();

    const handleSubmit = async () => {
        setIsProcessing(true);
        const numericAmount = parseCurrency(amount);

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
            toast({ title: "Erro ao modificar saldo", description: data?.message || error.message, variant: "destructive" });
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
                <DialogDescription>Adicione ou remova fundos da conta bancária do usuário.</DialogDescription>
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
                    <Input id="amount" value={amount} onChange={(e) => setAmount(formatCurrency(e.target.value))} placeholder="R$ 0,00" />
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

const UserManagement = () => {
    const { toast } = useToast();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingUser, setEditingUser] = useState(null);
    const [modifyingBalanceUser, setModifyingBalanceUser] = useState(null);
    const [isUpdating, setIsUpdating] = useState(false);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.rpc('admin_get_all_users');
        if (error) {
            toast({ title: "Erro ao buscar usuários", description: error.message, variant: "destructive" });
        } else {
            setUsers(data);
        }
        setLoading(false);
    }, [toast]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);
    
    const handleUpdateUser = async () => {
        setIsUpdating(true);
        const { error } = await supabase.rpc('admin_update_user', {
            p_user_id: editingUser.id,
            p_role: editingUser.role,
            p_full_name: editingUser.full_name,
        });

        if (error) {
            toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso", description: "Usuário atualizado com sucesso." });
            setEditingUser(null);
            fetchUsers();
        }
        setIsUpdating(false);
    };

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


    const filteredUsers = users.filter(user =>
        (user.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (user.username || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (user.email || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">Gerenciamento de Usuários</h2>
            <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5"/>
                <Input 
                    placeholder="Buscar por nome, username ou email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                />
            </div>
            {loading ? (
                 <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
            ) : (
                <div className="overflow-x-auto glass-effect rounded-lg border border-white/10">
                    <table className="w-full text-sm text-left text-gray-300">
                        <thead className="text-xs text-gray-400 uppercase bg-black/20">
                            <tr>
                                <th scope="col" className="px-6 py-3">Nome Completo</th>
                                <th scope="col" className="px-6 py-3">Username</th>
                                <th scope="col" className="px-6 py-3">Cargo</th>
                                <th scope="col" className="px-6 py-3 text-center">Status dos Serviços</th>
                                <th scope="col" className="px-6 py-3 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map(user => (
                                <tr key={user.id} className="border-b border-slate-700 hover:bg-slate-800/50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-white">{user.full_name}</td>
                                    <td className="px-6 py-4">@{user.username}</td>
                                    <td className="px-6 py-4 flex items-center gap-2">
                                        {user.role}
                                        {user.role === 'Admin' && <Shield className="w-4 h-4 text-red-400"/>}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                      <span className={`px-2 py-1 rounded-full text-xs ${user.x_handle ? 'bg-sky-500/20 text-sky-300' : 'bg-gray-500/20 text-gray-300'}`}>X</span>{' '}
                                      <span className={`px-2 py-1 rounded-full text-xs ${user.has_bank_account ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-300'}`}>Banco</span>
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        {user.has_bank_account && (
                                            <Button variant="ghost" size="icon" onClick={() => setModifyingBalanceUser(user)}><Wallet className="w-4 h-4 text-green-400" /></Button>
                                        )}
                                        <Button variant="ghost" size="icon" onClick={() => setEditingUser({...user})}><Edit className="w-4 h-4 text-blue-400" /></Button>
                                        <Dialog>
                                            <DialogTrigger asChild><Button variant="ghost" size="icon"><Trash2 className="w-4 h-4 text-red-400" /></Button></DialogTrigger>
                                            <DialogContent className="glass-effect text-white">
                                                <DialogHeader><DialogTitle>Confirmar Exclusão</DialogTitle><DialogDescription className="text-gray-300">Tem certeza que deseja excluir o usuário {user.full_name}? Esta ação é irreversível e removerá todos os dados associados.</DialogDescription></DialogHeader>
                                                <DialogFooter><DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose><Button variant="destructive" onClick={() => handleDeleteUser(user.id, user.full_name)}>Excluir Permanentemente</Button></DialogFooter>
                                            </DialogContent>
                                        </Dialog>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
             {editingUser && (
                <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
                    <DialogContent className="glass-effect text-white">
                        <DialogHeader><DialogTitle>Editar Usuário: {editingUser.full_name}</DialogTitle></DialogHeader>
                        <div className="py-4 space-y-4">
                            <div>
                                <Label htmlFor="edit-fullname" className="text-gray-300">Nome Completo</Label>
                                <Input id="edit-fullname" value={editingUser.full_name} onChange={(e) => setEditingUser(u => ({...u, full_name: e.target.value}))} />
                            </div>
                             <div>
                                <Label htmlFor="edit-role" className="text-gray-300">Cargo</Label>
                                <Input id="edit-role" value={editingUser.role} onChange={(e) => setEditingUser(u => ({...u, role: e.target.value}))} />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setEditingUser(null)}>Cancelar</Button>
                            <Button onClick={handleUpdateUser} disabled={isUpdating}>{isUpdating && <Loader2 className="animate-spin mr-2 w-4 h-4"/>} Salvar Alterações</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
            {modifyingBalanceUser && (
                <Dialog open={!!modifyingBalanceUser} onOpenChange={() => setModifyingBalanceUser(null)}>
                    <ModifyBalanceDialog user={modifyingBalanceUser} onFinish={handleBalanceModificationFinish} />
                </Dialog>
            )}
        </div>
    );
};

export default UserManagement;
