
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Edit, Trash2, Shield } from 'lucide-react';
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

const UserManagement = () => {
    const { toast } = useToast();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingUser, setEditingUser] = useState(null);
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

    const handleDeleteUser = async (userId) => {
        const { error } = await supabase.rpc('admin_delete_user', { p_user_id: userId });
        if (error) {
            toast({ title: 'Erro ao excluir', description: error.message, variant: "destructive" });
        } else {
            toast({ title: 'Usuário excluído!' });
            fetchUsers();
        }
    };

    const filteredUsers = users.filter(user =>
        user.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">Gerenciamento de Usuários</h2>
            <Input 
                placeholder="Buscar por nome, username ou email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
            />
            {loading ? (
                 <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : (
                <div className="overflow-x-auto glass-effect rounded-lg">
                    <table className="w-full text-sm text-left text-gray-300">
                        <thead className="text-xs text-gray-400 uppercase bg-black/20">
                            <tr>
                                <th scope="col" className="px-6 py-3">Nome Completo</th>
                                <th scope="col" className="px-6 py-3">Username</th>
                                <th scope="col" className="px-6 py-3">Cargo</th>
                                <th scope="col" className="px-6 py-3 text-center">Status</th>
                                <th scope="col" className="px-6 py-3 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map(user => (
                                <tr key={user.id} className="border-b border-slate-700 hover:bg-slate-800/50">
                                    <td className="px-6 py-4 font-medium text-white">{user.full_name}</td>
                                    <td className="px-6 py-4">@{user.username}</td>
                                    <td className="px-6 py-4">{user.role}</td>
                                    <td className="px-6 py-4 text-center">
                                      <span className={`px-2 py-1 rounded-full text-xs ${user.x_handle ? 'bg-sky-500/20 text-sky-300' : 'bg-gray-500/20 text-gray-300'}`}>X</span>{' '}
                                      <span className={`px-2 py-1 rounded-full text-xs ${user.has_bank_account ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-300'}`}>Banco</span>
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        <Button variant="ghost" size="icon" onClick={() => setEditingUser({...user})}><Edit className="w-4 h-4" /></Button>
                                        <Dialog>
                                            <DialogTrigger asChild><Button variant="destructive" size="icon"><Trash2 className="w-4 h-4" /></Button></DialogTrigger>
                                            <DialogContent>
                                                <DialogHeader><DialogTitle>Confirmar Exclusão</DialogTitle><DialogDescription>Tem certeza que deseja excluir o usuário {user.full_name}? Esta ação é irreversível.</DialogDescription></DialogHeader>
                                                <DialogFooter><DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose><Button variant="destructive" onClick={() => handleDeleteUser(user.id)}>Excluir</Button></DialogFooter>
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
                    <DialogContent>
                        <DialogHeader><DialogTitle>Editar Usuário</DialogTitle></DialogHeader>
                        <div className="py-4 space-y-4">
                            <div>
                                <label className="text-sm font-medium text-gray-300">Nome Completo</label>
                                <Input value={editingUser.full_name} onChange={(e) => setEditingUser(u => ({...u, full_name: e.target.value}))} />
                            </div>
                             <div>
                                <label className="text-sm font-medium text-gray-300">Cargo</label>
                                <Input value={editingUser.role} onChange={(e) => setEditingUser(u => ({...u, role: e.target.value}))} />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setEditingUser(null)}>Cancelar</Button>
                            <Button onClick={handleUpdateUser} disabled={isUpdating}>{isUpdating && <Loader2 className="animate-spin mr-2"/>} Salvar</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
};

export default UserManagement;
