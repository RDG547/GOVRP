import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';

const CartContext = createContext();

export const useCart = () => useContext(CartContext);

export const CartProvider = ({ children, storageKey }) => {
    const { toast } = useToast();
    const [cartItems, setCartItems] = useState(() => {
        try {
            const localData = localStorage.getItem(storageKey);
            const items = localData ? JSON.parse(localData) : [];
            return Array.isArray(items) ? items : [];
        } catch (error) {
            console.error("Could not parse cart data from localStorage", error);
            return [];
        }
    });

    useEffect(() => {
        localStorage.setItem(storageKey, JSON.stringify(cartItems));
    }, [cartItems, storageKey]);

    const [quoteReady, setQuoteReady] = useState(false);
    const quoteVersion = useRef(0);
    const itemIds = cartItems.map(item => item.id).sort().join(',');
    const refreshPrices = useCallback(async () => {
        const version = ++quoteVersion.current;
        setQuoteReady(false);
        const { data, error } = await supabase.rpc('get_products_with_final_price');
        if (version !== quoteVersion.current) return;
        if (error) { console.error('cart:quote', error); return; }
        setCartItems(items => items.map(item => {
            const live = data?.find(product => product.id === item.id);
            return live ? { ...live, quantity: item.quantity } : { ...item, unavailable: true };
        }));
        setQuoteReady(true);
    }, []);
    useEffect(() => { if (itemIds) refreshPrices(); }, [itemIds, refreshPrices]);
    useDomainRealtime('marketplace', 'public', ['products', 'businesses', 'government_rules'], refreshPrices, Boolean(itemIds));

    const consumePurchasedItem = (productId) => {
        setCartItems(items => items.flatMap(item => item.id !== productId ? [item] : item.quantity > 1 ? [{ ...item, quantity: item.quantity - 1 }] : []));
    };

    const addToCart = (product) => {
        if (product.unavailable || product.seller?.activity_restricted) {
            toast({ title: 'Compra indisponível', description: 'Este produto está indisponível pela regra vigente.', variant: 'destructive' });
            return false;
        }
        if (product.product_type === 'one-time' && product.stock <= 0) {
            toast({
                title: "Produto Esgotado",
                description: "Este produto não está mais disponível em estoque.",
                variant: "destructive",
            });
            return false;
        }

        setCartItems(prevItems => {
            const existingItem = prevItems.find(item => item.id === product.id);
            if (existingItem) {
                return prevItems.map(item =>
                    item.id === product.id
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                );
            }
            return [...prevItems, { ...product, quantity: 1 }];
        });
        return true;
    };

    const removeFromCart = (productId) => {
        setCartItems(prevItems => prevItems.filter(item => item.id !== productId));
    };

    const updateQuantity = (productId, quantity) => {
        if (quantity <= 0) {
            removeFromCart(productId);
        } else {
            setCartItems(prevItems =>
                prevItems.map(item =>
                    item.id === productId ? { ...item, quantity } : item
                )
            );
        }
    };

    const clearCart = () => {
        setCartItems([]);
    };

    const value = {
        cartItems,
        quoteReady,
        refreshPrices,
        consumePurchasedItem,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
    };

    return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};
