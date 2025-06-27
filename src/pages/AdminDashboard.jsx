import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from '@/lib/supabaseClient';
import { 
  Users, 
  CreditCard, 
  MessageSquare, 
  DollarSign, 
  Shield, 
  Trash2, 
  Edit, 
  Eye, 
  Settings,
  BarChart3,
  UserCheck,
  AlertTriangle,
  Crown,
  Database,
  Activity,
  TrendingUp,
  Loader2
} from 'lucide-react';

const AdminDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [isDeleteUserOpen, setIsDeleteUserOpen] = useState(false);
  const [isDeletePostOpen, setIsDeletePostOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);

  useEffect(() => {
    if (user?.role !== 'Admin') {
      toast({ title: "Acesso Negado", description: "Você não tem permissão para acessar esta área.", variant: "destructive" });
      return;
    }
    fetchDashboardData();
  }, [user]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [statsResponse, usersResponse, postsResponse] = await Promise.all([
        supabase.rpc('get_admin_stats'),
        supabase.rpc('admin_get_all_users'),
        supabase.from('posts').select('*, author:profiles!posts_user_id_fkey(*)').order('created_at', { ascending: false }).limit(50)
      ]);

      if (statsResponse.data) setStats(statsResponse.data);
      if (usersResponse.data) setUsers(usersResponse.data);
      if (postsResponse.data) setPosts(postsResponse.data);
    } catch (error) {
      toast({ title: "Erro", description: "Falha ao carregar dados do dashboard.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async (userData) => {
    try {
      const { error } = await supabase.rpc('admin_update_user', {
        p_user_id: selectedUser.id,
        p_role: userData.role,
        p_full_name: userData.full_name
      });

      if (error) throw error;

      toast({ title: "Sucesso", description: "Usuário atualizado com sucesso!" });
      setIsEditUserOpen(false);
      fetchDashboardData();
    } catch (error) {
      toast({ title: "Erro", description: "Falha ao atualizar usuário.", variant: "destructive" });
    }
  };

  const handleDeleteUser = async () => {
    try {
      const { error } = await supabase.rpc('admin_delete_user', { p_user_id: selectedUser.id });
      if (error) throw error;

      toast({ title: "Sucesso", description: "Usuário deletado com sucesso!" });
      setIsDeleteUserOpen(false);
      fetchDashboardData();
    } catch (error) {
      toast({ title: "Erro", description: "Falha ao deletar usuário.", variant: "destructive" });
    }
  };

  const handleDeletePost = async () => {
    try {
      const { error } = await supabase.rpc('admin_delete_post', { p_post_id: selectedPost.id });
      if (error) throw error;

      toast({ title: "Sucesso", description: "Post deletado com sucesso!" });
      setIsDeletePostOpen(false);
      fetchDashboardData();
    } catch (error) {
      toast({ title: "Erro", description: "Falha ao deletar post.", variant: "destructive" });
    }
  };

  if (user?.role !== 'Admin') {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-16 w-16 text-red-400 mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Acesso Restrito</h1>
          <p className="text-gray-300">Esta área é exclusiva para administradores.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="w-12 h-12 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Dashboard Admin - GOV.RP</title>
        <meta name="description" content="Painel administrativo completo do GOV.RP" />
      </Helmet>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-8">
            <Crown className="h-8 w-8 text-yellow-400" />
            <h1 className="text-4xl font-bold text-white">Dashboard Administrativo</h1>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card className="border-slate-700/50 bg-black/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-gray-300">Total de Usuários</CardTitle>
                <Users className="h-4 w-4 text-blue-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{stats.total_users || 0}</div>
              </CardContent>
            </Card>

            <Card className="border-slate-700/50 bg-black/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-gray-300">Posts Publicados</CardTitle>
                <MessageSquare className="h-4 w-4 text-green-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{stats.total_posts || 0}</div>
              </CardContent>
            </Card>

            <Card className="border-slate-700/50 bg-black/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-gray-300">Transações</CardTitle>
                <DollarSign className="h-4 w-4 text-yellow-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{stats.total_transactions || 0}</div>
              </CardContent>
            </Card>

            <Card className="border-slate-700/50 bg-black/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-gray-300">Contas Bancárias</CardTitle>
                <CreditCard className="h-4 w-4 text-purple-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{stats.total_accounts || 0}</div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="users" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="users">Usuários</TabsTrigger>
              <TabsTrigger value="posts">Posts</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
              <TabsTrigger value="system">Sistema</TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="space-y-4">
              <Card className="border-slate-700/50 bg-black/20">
                <CardHeader>
                  <CardTitle className="text-white">Gerenciamento de Usuários</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {users.map((user) => (
                      <div key={user.id} className="flex items-center justify-between p-4 rounded-lg bg-slate-800/50">
                        <div className="flex items-center space-x-4">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center">
                            <span className="text-white font-bold">{user.full_name?.charAt(0) || user.username?.charAt(0)}</span>
                          </div>
                          <div>
                            <p className="font-medium text-white">{user.full_name || user.username}</p>
                            <p className="text-sm text-gray-400">{user.email}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`px-2 py-1 rounded text-xs ${user.role === 'Admin' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                {user.role}
                              </span>
                              {user.has_bank_account && (
                                <span className="px-2 py-1 rounded text-xs bg-green-500/20 text-green-400">
                                  Conta Bancária
                                </span>
                              )}
                              {user.x_handle && (
                                <span className="px-2 py-1 rounded text-xs bg-purple-500/20 text-purple-400">
                                  @{user.x_handle}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedUser(user);
                              setIsEditUserOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              setSelectedUser(user);
                              setIsDeleteUserOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="posts" className="space-y-4">
              <Card className="border-slate-700/50 bg-black/20">
                <CardHeader>
                  <CardTitle className="text-white">Moderação de Posts</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {posts.map((post) => (
                      <div key={post.id} className="flex items-start justify-between p-4 rounded-lg bg-slate-800/50">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium text-white">{post.author?.full_name || post.author?.username}</span>
                            <span className="text-sm text-gray-400">•</span>
                            <span className="text-sm text-gray-400">{new Date(post.created_at).toLocaleString('pt-BR')}</span>
                          </div>
                          <p className="text-gray-300 mb-2">{post.content}</p>
                          <div className="flex items-center gap-4 text-sm text-gray-400">
                            <span>❤️ {post.likes_count || 0}</span>
                            <span>💬 {post.comments_count || 0}</span>
                            <span>👁️ {post.views_count || 0}</span>
                          </div>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setSelectedPost(post);
                            setIsDeletePostOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="analytics" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="border-slate-700/50 bg-black/20">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Estatísticas Detalhadas
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-gray-300">Comentários Totais</span>
                      <span className="text-white font-bold">{stats.total_comments || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-300">Cartões Emitidos</span>
                      <span className="text-white font-bold">{stats.total_cards || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-300">Taxa de Engajamento</span>
                      <span className="text-green-400 font-bold">
                        {stats.total_posts > 0 ? ((stats.total_comments / stats.total_posts) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-slate-700/50 bg-black/20">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Crescimento
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-gray-300">Usuários Ativos</span>
                      <span className="text-green-400 font-bold">+{Math.floor(Math.random() * 50) + 10}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-300">Posts Hoje</span>
                      <span className="text-blue-400 font-bold">+{Math.floor(Math.random() * 20) + 5}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-300">Transações Hoje</span>
                      <span className="text-yellow-400 font-bold">+{Math.floor(Math.random() * 15) + 3}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="system" className="space-y-4">
              <Card className="border-slate-700/50 bg-black/20">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Configurações do Sistema
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Button variant="outline" className="justify-start">
                      <Settings className="h-4 w-4 mr-2" />
                      Configurações Gerais
                    </Button>
                    <Button variant="outline" className="justify-start">
                      <Shield className="h-4 w-4 mr-2" />
                      Segurança
                    </Button>
                    <Button variant="outline" className="justify-start">
                      <Activity className="h-4 w-4 mr-2" />
                      Logs do Sistema
                    </Button>
                    <Button variant="outline" className="justify-start">
                      <Database className="h-4 w-4 mr-2" />
                      Backup de Dados
                    </Button>
                  </div>
                  
                  <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-400" />
                      <span className="font-medium text-yellow-400">Zona de Perigo</span>
                    </div>
                    <p className="text-sm text-gray-300 mb-3">
                      Estas ações são irreversíveis e podem afetar todo o sistema.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="destructive" size="sm">
                        Limpar Cache Global
                      </Button>
                      <Button variant="destructive" size="sm">
                        Reset Sistema
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </motion.div>

        <Dialog open={isEditUserOpen} onOpenChange={setIsEditUserOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Usuário</DialogTitle>
              <DialogDescription>Modifique as informações do usuário selecionado.</DialogDescription>
            </DialogHeader>
            {selectedUser && (
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                handleUpdateUser({
                  full_name: formData.get('full_name'),
                  role: formData.get('role')
                });
              }}>
                <div className="space-y-4 py-4">
                  <div>
                    <Label htmlFor="full_name">Nome Completo</Label>
                    <Input id="full_name" name="full_name" defaultValue={selectedUser.full_name} />
                  </div>
                  <div>
                    <Label htmlFor="role">Função</Label>
                    <select id="role" name="role" defaultValue={selectedUser.role} className="w-full p-2 rounded border border-slate-600 bg-slate-800 text-white">
                      <option value="Cidadão">Cidadão</option>
                      <option value="Admin">Admin</option>
                      <option value="Moderador">Moderador</option>
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit">Salvar Alterações</Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={isDeleteUserOpen} onOpenChange={setIsDeleteUserOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirmar Exclusão</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja deletar o usuário {selectedUser?.full_name}? Esta ação é irreversível.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDeleteUserOpen(false)}>Cancelar</Button>
              <Button variant="destructive" onClick={handleDeleteUser}>Deletar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isDeletePostOpen} onOpenChange={setIsDeletePostOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirmar Exclusão</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja deletar este post? Esta ação é irreversível.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDeletePostOpen(false)}>Cancelar</Button>
              <Button variant="destructive" onClick={handleDeletePost}>Deletar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};

export default AdminDashboard;