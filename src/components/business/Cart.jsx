import CheckoutDialog from '@/components/business/PurchaseDialog';
import React, { useState, useRef } from 'react';
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
import { purchaseErrorMessage } from '@/lib/commerce';
import { ItemTaxDetails, PurchaseTotals } from '@/components/business/PurchaseBreakdown';

const CartItem = ({ item, updateQuantity, removeFromCart }) => (
    <div className="flex flex-wrap items-center gap-2 py-2">
        <img src={item.image_url} alt={item.name} className="w-16 h-16 rounded-md object-cover" />
        <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm break-words">{item.name}</p>
            <ItemTaxDetails item={item}/>
        </div>
        <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label={`Diminuir quantidade de ${item.name}`} onClick={() => updateQuantity(item.id, item.quantity - 1)}><Minus className="h-3 w-3" /></Button>
            <span className="font-bold text-sm w-4 text-center">{item.quantity}</span>
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label={`Aumentar quantidade de ${item.name}`} disabled={item.product_type === 'subscription' || item.quantity >= 100} onClick={() => updateQuantity(item.id, item.quantity + 1)}><Plus className="h-3 w-3" /></Button>
        </div>
        <Button variant="ghost" size="icon" className="h-10 w-10 text-destructive" aria-label={`Remover ${item.name}`} onClick={() => removeFromCart(item.id)}><Trash2 className="h-4 w-4" /></Button>
    </div>
);

const Cart = () => {
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const { cartItems, updateQuantity, removeFromCart, clearCart, quoteReady, refreshPrices } = useCart();
    const { toast } = useToast();
    const total = cartItems.reduce((sum, item) => sum + Number(item.final_price || 0) * item.quantity, 0);
    const blocked = cartItems.some(item => item.unavailable || item.seller?.activity_restricted || (item.product_type === 'one-time' && item.stock < item.quantity));
    const purchaseIntent = useRef(null);
    const checkingOut = useRef(false);
    const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

    const handleCheckout = () => {
        if (cartItems.length === 0) {
            toast({ title: "Carrinho vazio", description: "Adicione itens ao carrinho para comprar.", variant: "destructive" });
            return;
        }
        setIsCheckoutOpen(true);
    };

    const handleConfirmCheckout = async (paymentMethod, cardId) => {
        if (checkingOut.current || blocked || !quoteReady) return;
        checkingOut.current = true;
        try {
            const items=cartItems.map(item=>({product_id:item.id,quantity:item.quantity})).sort((a,b)=>a.product_id.localeCompare(b.product_id));
            const payload={p_items:items,p_payment_method:paymentMethod,p_card_id:paymentMethod==='card'?cardId:null,p_expected_total:Math.round(total*100)/100};
            const signature=JSON.stringify(payload);
            if(purchaseIntent.current?.signature!==signature)purchaseIntent.current={signature,key:crypto.randomUUID()};
            const result=await supabase.rpc('checkout_marketplace_cart',{...payload,p_checkout_id:purchaseIntent.current.key});
            if(result.error)throw result.error;
            if(!result.data?.success)throw new Error('Não foi possível concluir a compra.');
            clearCart();purchaseIntent.current=null;
            toast({ title: 'Sucesso!', description: 'Todos os itens foram comprados com sucesso.' });
            setIsCheckoutOpen(false);
        } catch(error) { console.error('Checkout',error);toast({title:'Compra não concluída',description:purchaseErrorMessage(error),variant:'destructive'}); } finally { checkingOut.current = false; refreshPrices(); }
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
                <PopoverContent className="w-[min(96vw,28rem)]" side="bottom" align="end">
                    <Card className="shadow-none border-none">
                        <CardHeader>
                            <CardTitle className="text-center">Carrinho de Compras</CardTitle>
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
                            <PurchaseTotals items={cartItems}/>
                            <Button className="w-full" onClick={handleCheckout} disabled={!quoteReady || blocked || !cartItems.length}><ShoppingCart className="mr-2 h-4 w-4"/>Finalizar Compra</Button>
                        </CardFooter>
                    </Card>
                </PopoverContent>
            </Popover>
            <CheckoutDialog items={cartItems} open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen} onConfirm={handleConfirmCheckout} total={total} blocked={blocked} quoteReady={quoteReady} />
        </>
    );
};

export default Cart;
