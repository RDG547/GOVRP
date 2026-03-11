import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import Inventory from '@/components/dashboard/Inventory';
import PageHeader from '@/components/layout/PageHeader';
import { Package, Gift, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';

const GiftItemDialog = ({ isOpen, setIsOpen, onGiftSuccess }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [inventory, setInventory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [gifting, setGifting] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [quantity, setQuantity] = useState(1);
    const [recipientCpf, setRecipientCpf] = useState('');

    const fetchInventory = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('user_inventory')
            .select('*, product:products(name, image_url)')
            .eq('user_id', user.id)
            .gt('quantity', 0);
        if (error) {
            toast({ title: "Erro", description: "Não foi possível carregar seu inventário.", variant: "destructive" });
        } else {
            setInventory(data || []);
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        if (isOpen) {
            fetchInventory();
        }
    }, [isOpen, fetchInventory]);

    const handleGift = async () => {
        if (!selectedItem || !recipientCpf || quantity <= 0) {
            toast({ title: "Dados inválidos", description: "Selecione um item, informe o CPF do destinatário e a quantidade.", variant: "destructive" });
            return;
        }
        setGifting(true);
        const { data, error } = await supabase.rpc('gift_inventory_item', {
            p_inventory_id: selectedItem.id,
            p_recipient_cpf: recipientCpf,
            p_quantity: quantity
        });

        if (error) {
            toast({ title: "Erro ao presentear", description: error.message, variant: "destructive" });
        } else if (!data.success) {
            toast({ title: "Aviso", description: data.message, variant: "default" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            setIsOpen(false);
            onGiftSuccess();
        }
        setGifting(false);
    };

    const currentItem = inventory.find(item => item.id === selectedItem?.id);

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Presentear com um Item</DialogTitle>
                    <DialogDescription>Selecione um item do seu inventário para enviar a outro usuário.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div>
                        <Label>Item</Label>
                        {loading ? <Loader2 className="animate-spin" /> : (
                            <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                                {inventory.map(item => (
                                    <button key={item.id} onClick={() => setSelectedItem(item)} className={`border-2 rounded-lg p-2 text-center ${selectedItem?.id === item.id ? 'border-primary' : 'border-border'}`}>
                                        <img src={item.product.image_url || 'https://via.placeholder.com/150'} alt={item.product.name} className="w-full h-16 object-cover rounded-md mx-auto" />
                                        <p className="text-xs mt-1 truncate">{item.product.name}</p>
                                        <p className="text-xs font-bold">x{item.quantity}</p>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {selectedItem && (
                        <div>
                            <Label htmlFor="quantity">Quantidade</Label>
                            <Input id="quantity" type="number" min="1" max={currentItem?.quantity} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(currentItem?.quantity || 1, parseInt(e.target.value, 10))))} />
                        </div>
                    )}
                    <div>
                        <Label htmlFor="recipientCpf">CPF do Destinatário</Label>
                        <Input id="recipientCpf" placeholder="000.000.000-00" value={recipientCpf} onChange={(e) => setRecipientCpf(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
                    <Button onClick={handleGift} disabled={gifting || !selectedItem || !recipientCpf}>
                        {gifting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Enviar Presente
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const InventoryPage = () => {
    const [isGiftDialogOpen, setIsGiftDialogOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    const handleGiftSuccess = () => {
        setRefreshKey(prev => prev + 1);
    };

    return (
        <>
            <Helmet>
                <title>Meu Inventário - GOV.RP</title>
                <meta name="description" content="Gerencie seus produtos e assinaturas adquiridos na plataforma." />
            </Helmet>
            <div className="container mx-auto p-4 md:p-8">
                {/* ESTRUTURA CORRIGIDA AQUI */}
                <PageHeader
                    icon={Package}
                    title="Meu"
                    gradientText="Inventário"
                    description="Aqui você pode visualizar e gerenciar todos os seus produtos e assinaturas."
                    iconColor="text-orange-400"
                    centered={true}
                />
                <div className="flex justify-end mb-8">
                    <Button onClick={() => setIsGiftDialogOpen(true)}>
                        <Gift className="w-4 h-4 mr-2" /> Presentear
                    </Button>
                </div>
                
                <Inventory key={refreshKey} />

            </div>
            <GiftItemDialog isOpen={isGiftDialogOpen} setIsOpen={setIsGiftDialogOpen} onGiftSuccess={handleGiftSuccess} />
        </>
    );
};

export default InventoryPage;