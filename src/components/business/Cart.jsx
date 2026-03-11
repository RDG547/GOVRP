import React, { useState } from 'react';
import { useCart } from '@/contexts/CartContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ShoppingCart, Trash2, Plus, Minus, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from '@/contexts/AuthContext';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const CartItem = ({ item, updateQuantity, removeFromCart }) => (
    <div className="flex items-center gap-4 py-2">
        <img src={item.image_url} alt={item.name} className="w-16 h-16 rounded-md object-cover" />
        <div className="flex-1">
            <p className="font-semibold text-sm">{item.name}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(item.price)}</p>
        </div>
        <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQuantity(item.id, item.quantity - 1)}><Minus className="h-3 w-3" /></Button>
            <span className="font-bold text-sm w-4 text-center">{item.quantity}</span>
            <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQuantity(item.id, item.quantity + 1)}><Plus className="h-3 w-3" /></Button>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeFromCart(item.id)}><Trash2 className="h-4 w-4" /></Button>
    </div>
);

const CheckoutDialog = ({ open, onOpenChange, onConfirm, total }) => {
    const [paymentMethod, setPaymentMethod] = useState('balance');
    const [cards, setCards] = useState([]);
    const [selectedCard, setSelectedCard] = useState('');
    const [loading, setLoading] = useState(false);
    const { user } = useAuth();

    React.useEffect(() => {
        if (open && user) {
            const fetchCards = async () => {
                const { data } = await supabase.from('cards').select('*').eq('user_id', user.id).eq('is_active', true);
                setCards(data || []);
            };
            fetchCards();
        }
    }, [open, user]);

    const handleConfirm = () => {
        setLoading(true);
        onConfirm(paymentMethod, selectedCard).finally(() => setLoading(false));
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Finalizar Compra</DialogTitle>
                    <DialogDescription>Confirme os detalhes do seu pedido.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="flex justify-between items-center p-4 rounded-lg bg-muted">
                        <span className="font-semibold">Total do Pedido</span>
                        <span className="font-bold text-lg">{formatCurrency(total)}</span>
                    </div>
                    <div>
                        <label className="text-sm font-medium">Método de Pagamento</label>
                        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="balance">Saldo em Conta</SelectItem>
                                <SelectItem value="card" disabled={cards.length === 0}>Cartão de Crédito</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {paymentMethod === 'card' && (
                        <div>
                            <label className="text-sm font-medium">Selecione o Cartão</label>
                            <Select value={selectedCard} onValueChange={setSelectedCard}>
                                <SelectTrigger><SelectValue placeholder="Selecione um cartão" /></SelectTrigger>
                                <SelectContent>
                                    {cards.map(card => (
                                        <SelectItem key={card.id} value={card.id}>
                                            {card.brand} final {card.card_number.slice(-4)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleConfirm} disabled={loading || (paymentMethod === 'card' && !selectedCard)}>
                        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Confirmar e Pagar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const Cart = () => {
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const { cartItems, updateQuantity, removeFromCart, clearCart } = useCart();
    const { toast } = useToast();
    const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

    const handleCheckout = () => {
        if (cartItems.length === 0) {
            toast({ title: "Carrinho vazio", description: "Adicione itens ao carrinho para comprar.", variant: "destructive" });
            return;
        }
        setIsCheckoutOpen(true);
    };

    const handleConfirmCheckout = async (paymentMethod, cardId) => {
        for (const item of cartItems) {
            for (let i = 0; i < item.quantity; i++) {
                const { data, error } = await supabase.rpc('buy_product', {
                    p_product_id: item.id,
                    p_payment_method: paymentMethod,
                    p_card_id: cardId || null,
                });

                if (error || !data.success) {
                    toast({ title: `Erro na compra de ${item.name}`, description: data?.message || error?.message || "Ocorreu um erro.", variant: "destructive" });
                    return; // Stop checkout process on first error
                }
            }
        }
        toast({ title: "Sucesso!", description: "Todos os itens foram comprados com sucesso." });
        clearCart();
        setIsCheckoutOpen(false);
    };

    return (
        <>
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" className="relative">
                        <ShoppingCart className="w-4 h-4 mr-2" />
                        Carrinho
                        {itemCount > 0 && (
                            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">{itemCount}</span>
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-96" side="bottom" align="end">
                    <Card className="shadow-none border-none">
                        <CardHeader>
                            <CardTitle>Carrinho de Compras</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-64 pr-4">
                                {cartItems.length > 0 ? (
                                    cartItems.map(item => (
                                        <CartItem key={item.id} item={item} updateQuantity={updateQuantity} removeFromCart={removeFromCart} />
                                    ))
                                ) : (
                                    <p className="text-center text-muted-foreground py-10">Seu carrinho está vazio.</p>
                                )}
                            </ScrollArea>
                        </CardContent>
                        <CardFooter className="flex-col items-stretch gap-2">
                            <Separator />
                            <div className="flex justify-between font-bold text-lg pt-2">
                                <span>Total:</span>
                                <span>{formatCurrency(total)}</span>
                            </div>
                            <Button className="w-full" onClick={handleCheckout}>Finalizar Compra</Button>
                        </CardFooter>
                    </Card>
                </PopoverContent>
            </Popover>
            <CheckoutDialog open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen} onConfirm={handleConfirmCheckout} total={total} />
        </>
    );
};

export default Cart;