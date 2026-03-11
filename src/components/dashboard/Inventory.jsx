import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Package, Repeat, Calendar, Info, Trash2, Repeat2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const Inventory = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [inventory, setInventory] = useState([]);
    const [subscriptions, setSubscriptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedSubscription, setSelectedSubscription] = useState(null);
    const [isCancelling, setIsCancelling] = useState(false);

    const fetchInventory = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        const { data: inventoryData, error: inventoryError } = await supabase
            .from('user_inventory')
            .select('*, product:products(*, seller:profiles(username))')
            .eq('user_id', user.id)
            .gt('quantity', 0);

        const { data: subscriptionsData, error: subscriptionsError } = await supabase
            .from('user_subscriptions')
            .select('*, product:products(*, seller:profiles(username))')
            .eq('user_id', user.id);

        if (inventoryError) console.error('Error fetching inventory:', inventoryError);
        if (subscriptionsError) console.error('Error fetching subscriptions:', subscriptionsError);

        setInventory(inventoryData || []);
        setSubscriptions(subscriptionsData || []);
        setLoading(false);
    }, [user]);

    useEffect(() => {
        fetchInventory();
    }, [fetchInventory]);

    const handleCancelSubscription = async () => {
        if (!selectedSubscription) return;
        setIsCancelling(true);
        const { error } = await supabase.rpc('cancel_subscription', { p_subscription_id: selectedSubscription.id });

        if (error) {
            toast({
                title: 'Erro ao cancelar',
                description: error.message,
                variant: 'destructive'
            });
        } else {
            toast({
                title: 'Sucesso',
                description: 'Assinatura cancelada com sucesso.'
            });
            fetchInventory();
        }
        setIsCancelling(false);
        setDialogOpen(false);
        setSelectedSubscription(null);
    };

    const openCancelDialog = (subscription) => {
        setSelectedSubscription(subscription);
        setDialogOpen(true);
    };
    
    const handleResell = (item) => {
        toast({
            title: '🚧 Em construção',
            description: 'A funcionalidade de revenda está sendo implementada.'
        })
    }

    if (loading) {
        return (
            <Card className="glass-effect">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Package /> Inventário</CardTitle>
                    <CardDescription>Seus itens e assinaturas.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center items-center h-40">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </CardContent>
            </Card>
        );
    }

    return (
        <>
            <Card className="glass-effect">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Package /> Inventário</CardTitle>
                    <CardDescription>Seus itens e assinaturas.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="products">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="products">Produtos</TabsTrigger>
                            <TabsTrigger value="subscriptions">Assinaturas</TabsTrigger>
                        </TabsList>
                        <TabsContent value="products" className="mt-4">
                            {inventory.length > 0 ? (
                                <div className="space-y-4 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                                    {inventory.map(item => (
                                        <div key={item.id} className="flex items-center gap-4 p-3 rounded-lg bg-secondary/50">
                                            <img src={item.product.image_url || 'https://via.placeholder.com/150'} alt={item.product.name} className="w-16 h-16 rounded-md object-cover" />
                                            <div className="flex-1">
                                                <p className="font-semibold text-foreground">{item.product.name} <span className="text-muted-foreground font-normal">x{item.quantity}</span></p>
                                                <p className="text-sm text-muted-foreground">Vendido por: @{item.product.seller.username}</p>
                                                <p className="text-xs text-muted-foreground">Adquirido em: {new Date(item.acquired_at).toLocaleDateString('pt-BR')}</p>
                                            </div>
                                            <Button variant="outline" size="sm" onClick={() => handleResell(item)}><Repeat2 className="w-4 h-4 mr-2" /> Revender</Button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <p>Você não possui nenhum produto.</p>
                                </div>
                            )}
                        </TabsContent>
                        <TabsContent value="subscriptions" className="mt-4">
                            {subscriptions.length > 0 ? (
                                <div className="space-y-4 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                                    {subscriptions.map(sub => (
                                        <div key={sub.id} className="flex items-start gap-4 p-3 rounded-lg bg-secondary/50">
                                            <img src={sub.product.image_url || 'https://via.placeholder.com/150'} alt={sub.product.name} className="w-16 h-16 rounded-md object-cover" />
                                            <div className="flex-1">
                                                <p className="font-semibold text-foreground">{sub.product.name}</p>
                                                <p className="text-sm text-muted-foreground">Vendido por: @{sub.product.seller.username}</p>
                                                <div className="text-xs mt-1 space-y-1">
                                                    <span className="flex items-center gap-1"><Info className="w-3 h-3" /> Status: <span className={`font-medium ${sub.status === 'active' ? 'text-green-400' : 'text-red-400'}`}>{sub.status === 'active' ? 'Ativa' : 'Cancelada'}</span></span>
                                                    {sub.status === 'active' && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Próx. Cobrança: {new Date(sub.next_payment_date).toLocaleDateString('pt-BR')}</span>}
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-2">
                                                <div className="text-right">
                                                    <p className="font-bold text-primary">{formatCurrency(sub.product.price)}</p>
                                                    <p className="text-xs text-muted-foreground">/ {sub.product.subscription_interval === '7 days' ? 'semana' : 'mês'}</p>
                                                </div>
                                                {sub.status === 'active' && 
                                                    <Button variant="destructive" size="sm" onClick={() => openCancelDialog(sub)}>
                                                        <Trash2 className="w-4 h-4 mr-2" /> Cancelar
                                                    </Button>
                                                }
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <p>Você não possui nenhuma assinatura ativa.</p>
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

            <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancelar Assinatura</AlertDialogTitle>
                  <AlertDialogDescription>
                    Você tem certeza que deseja cancelar a assinatura de "{selectedSubscription?.product.name}"? Esta ação não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isCancelling}>Voltar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCancelSubscription} disabled={isCancelling} className="bg-red-600 hover:bg-red-700">
                    {isCancelling ? <Loader2 className="animate-spin mr-2" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Confirmar Cancelamento
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default Inventory;