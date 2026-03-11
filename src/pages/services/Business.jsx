import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, PlusCircle, Search, ShoppingCart, Package, Star, Store, MoreVertical, Edit, Trash2, ChevronDown, TrendingUp, CheckCircle, ShoppingBag, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatCNPJ } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import ProductFormDialog from '@/components/dashboard/ProductFormDialog';
import { useCart } from '@/contexts/CartContext';
import Cart from '@/components/business/Cart';
import { cn } from '@/lib/utils';

const StockBadge = ({ stock }) => {
  if (stock === null) return null;
  if (stock <= 0) {
    return <Badge variant="destructive" className="absolute top-2 right-2">Esgotado</Badge>;
  }
  if (stock === 1) {
    return <Badge variant="destructive" className="absolute top-2 right-2">ÚLTIMA UNIDADE</Badge>;
  }
  if (stock <= 3) {
    return <Badge variant="destructive" className="absolute top-2 right-2">ÚLTIMAS {stock} UNIDADES</Badge>;
  }
  if (stock <= 5) {
    return <Badge className="absolute top-2 right-2 bg-orange-500 text-white">ÚLTIMAS {stock} UNIDADES</Badge>;
  }
  return null;
};

const ProductCard = ({ product, onAddToCart, onBuy, onEdit, onDelete, isOwner }) => {
  const navigate = useNavigate();
  
  const hasPromotion = product.promotion_price && new Date(product.promotion_expires_at) > new Date();

  const originalPriceWithTax = product.price * (1 + product.tax_rate);
  const promotionalPriceWithTax = hasPromotion ? product.promotion_price * (1 + product.tax_rate) : null;
  const finalPrice = promotionalPriceWithTax ?? originalPriceWithTax;

  const seller = product.seller;
  const isBusiness = seller.role === 'PJ';
  const businessDoc = seller.documents?.find(d => d.type === 'CNPJ');
  const businessName = isBusiness ? businessDoc?.metadata?.company_name : null;
  const businessCnpj = isBusiness ? businessDoc?.document_number : null;

  const handleCardClick = (e) => {
    if (e.target.closest('button, a, .no-navigate')) {
      return;
    }
    navigate(`/services/business/product/${product.id}`);
  };

  const isOutOfStock = product.product_type === 'one-time' && product.stock <= 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col"
    >
      <Card 
        className={cn(
          "glass-effect flex-grow flex flex-col cursor-pointer transition-all",
          isOutOfStock && "opacity-50"
        )} 
        onClick={handleCardClick}
      >
        <CardHeader className="p-4">
          <div className="relative aspect-video rounded-lg overflow-hidden mb-4">
            <img
              alt={product.name}
              className="w-full h-full object-cover"
             src={product.image_url || "https://images.unsplash.com/photo-1671376354106-d8d21e55dddd"} />
            {product.category && (
              <Badge variant="secondary" className="absolute top-2 left-2">{product.category}</Badge>
            )}
            <StockBadge stock={product.stock} />
            {isOwner && (
              <div className="absolute bottom-2 right-2 no-navigate z-20">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(product); }}><Edit className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(product); }} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Excluir</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
          <CardTitle className="text-lg font-bold leading-tight whitespace-normal break-words">{product.name}</CardTitle>
          
          {product.product_type === 'subscription' ? (
            <span className="text-xs font-bold text-purple-400 flex items-center gap-1 mt-1">
              <Repeat className="w-3 h-3"/> ASSINATURA
            </span>
          ) : (
            <span className="text-xs font-bold text-blue-400 flex items-center gap-1 mt-1">
              <ShoppingBag className="w-3 h-3"/> PRODUTO
            </span>
          )}

          <CardDescription className="text-sm text-muted-foreground flex flex-col items-start gap-1 mt-2">
            <span>Vendido por: <Link to={`/services/x/profile/${seller.x_handle}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline no-navigate">{businessName || seller.full_name}</Link></span>
            {isBusiness && businessCnpj && <span className="text-xs">CNPJ: {formatCNPJ(businessCnpj)}</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 flex-grow">
          <p className="text-sm text-muted-foreground line-clamp-3 max-h-20 overflow-y-auto custom-scrollbar">{product.description}</p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
            {product.product_type === 'subscription' ? (
              <span className="flex items-center gap-1"><Star className="w-3 h-3" /> {product.subscribers_count || 0} assinantes</span>
            ) : (
              <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {product.sales_count || 0} vendidos</span>
            )}
          </div>
        </CardContent>
        <CardFooter className="p-4 pt-0 flex-col items-start gap-2">
          <div className="w-full">
            {hasPromotion ? (
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold text-white">{formatCurrency(finalPrice)}</p>
                <p className="text-lg font-medium text-muted-foreground line-through">{formatCurrency(originalPriceWithTax)}</p>
              </div>
            ) : (
              <p className="text-2xl font-bold text-white">{formatCurrency(finalPrice)}</p>
            )}
            {product.tax_rate > 0 && <p className="text-xs text-muted-foreground">Inclui {formatCurrency(finalPrice - (promotionalPriceWithTax ? product.promotion_price : product.price))} de impostos</p>}
            {product.product_type === 'subscription' && <p className="text-xs text-muted-foreground">/mês</p>}
          </div>
          {isOwner ? (
            <Button className="w-full" variant="outline" disabled>
              <CheckCircle className="w-4 h-4 mr-2 text-green-400" />
              Seu Produto
            </Button>
          ) : (
            <div className="w-full flex flex-col gap-2 no-navigate">
                <Button className="w-full" onClick={(e) => { e.stopPropagation(); onBuy(product); }} disabled={isOutOfStock}>
                    {isOutOfStock ? 'Esgotado' : (product.product_type === 'subscription' ? <><Star className="w-4 h-4 mr-2" /> Assinar</> : <><ShoppingBag className="w-4 h-4 mr-2" />Comprar</>)}
                </Button>
                {product.product_type !== 'subscription' && (
                    <Button variant="outline" className="w-full" onClick={(e) => { e.stopPropagation(); onAddToCart(product); }} disabled={isOutOfStock}>
                        <ShoppingCart className="w-4 h-4 mr-2" /> Adicionar ao Carrinho
                    </Button>
                )}
            </div>
          )}
        </CardFooter>
      </Card>
    </motion.div>
  );
};

const BuyDialog = ({ product, open, onOpenChange, onConfirm }) => {
  const [paymentMethod, setPaymentMethod] = useState('balance');
  const [cards, setCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState('');
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
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

  if (!product) return null;

  const hasPromotion = product.promotion_price && new Date(product.promotion_expires_at) > new Date();
  const finalPrice = hasPromotion ? product.promotion_price * (1 + product.tax_rate) : product.price * (1 + product.tax_rate);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar Compra</DialogTitle>
          <DialogDescription>Você está prestes a adquirir "{product.name}".</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex justify-between items-center p-4 rounded-lg bg-muted">
            <span className="font-semibold">{product.name}</span>
            <span className="font-bold text-lg">{formatCurrency(finalPrice)}</span>
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

const Business = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productToEdit, setProductToEdit] = useState(null);
  const [productToDelete, setProductToDelete] = useState(null);
  const [isBuyDialogOpen, setIsBuyDialogOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const { user } = useAuth();
  const { toast } = useToast();
  const { addToCart } = useCart();

  const fetchProductsAndCategories = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase.rpc('get_products_with_final_price');

    if (error) {
        toast({ title: "Erro ao buscar produtos", description: error.message, variant: "destructive" });
        setProducts([]);
    } else {
        let filteredData = data;
        if (searchTerm) {
            filteredData = filteredData.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
        }
        if (selectedCategory !== 'all') {
            filteredData = filteredData.filter(p => p.category === selectedCategory);
        }
        setProducts(filteredData || []);

        const uniqueCategories = [...new Set((data || []).map(p => p.category).filter(Boolean))];
        setCategories(uniqueCategories);
    }
    setLoading(false);
  }, [searchTerm, selectedCategory, toast]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchProductsAndCategories();
    }, 300);
    return () => clearTimeout(debounce);
  }, [fetchProductsAndCategories]);

  const handleBuyClick = (product) => {
    if (!user) {
      toast({ title: "Ação necessária", description: "Você precisa estar logado para comprar.", variant: "destructive" });
      return;
    }
    setSelectedProduct(product);
    setIsBuyDialogOpen(true);
  };

  const handleAddToCart = (product) => {
    if (!user) {
      toast({ title: "Ação necessária", description: "Você precisa estar logado para adicionar ao carrinho.", variant: "destructive" });
      return;
    }
    addToCart(product);
    toast({ title: "Produto adicionado!", description: `${product.name} foi adicionado ao seu carrinho.` });
  };

  const handleConfirmBuy = async (paymentMethod, cardId) => {
    if (!selectedProduct) return;

    const { data, error } = await supabase.rpc('buy_product', {
      p_product_id: selectedProduct.id,
      p_payment_method: paymentMethod,
      p_card_id: cardId || null,
    });

    if (error || !data.success) {
      toast({ title: "Erro na compra", description: data?.message || error?.message || "Ocorreu um erro.", variant: "destructive" });
    } else {
      toast({ title: "Sucesso!", description: data.message });
      fetchProductsAndCategories();
    }
    setIsBuyDialogOpen(false);
    setSelectedProduct(null);
  };

  const handleDeleteClick = (product) => {
    setProductToDelete(product);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!productToDelete) return;
    const { error } = await supabase.from('products').delete().eq('id', productToDelete.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Sucesso", description: "Produto excluído." });
      fetchProductsAndCategories();
    }
    setIsDeleteConfirmOpen(false);
    setProductToDelete(null);
  };

  const handleEditClick = (product) => {
    setProductToEdit(product);
    setIsFormOpen(true);
  };

  const handleAddClick = () => {
    setProductToEdit(null);
    setIsFormOpen(true);
  };

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setProductToEdit(null);
    fetchProductsAndCategories();
  };

  return (
    <div className="container mx-auto p-4 md:p-8">
      <Helmet>
        <title>Negócios Livres - GOV.RP</title>
        <meta name="description" content="Compre e venda produtos e serviços na plataforma GOV.RP." />
      </Helmet>

      <PageHeader
        icon={Store}
        title="Negócios"
        gradientText="Livres"
        description="O marketplace oficial para comprar e vender produtos e serviços."
        iconColor="text-blue-400"
        centered={true}
      />

      <div className="mb-8 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Buscar produtos..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Cart />
            <Link to="/services/inventory">
              <Button variant="outline"><Package className="w-4 h-4 mr-2" /> Meu Inventário</Button>
            </Link>
            <Button onClick={handleAddClick}>
              <PlusCircle className="w-4 h-4 mr-2" /> Vender Produto
            </Button>
          </div>
        </div>
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full md:w-auto">
              Categorias <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-wrap gap-2 p-4 bg-muted/50 rounded-lg mt-2">
              <Button variant={selectedCategory === 'all' ? 'default' : 'secondary'} onClick={() => setSelectedCategory('all')}>Todas</Button>
              {categories.map(cat => (
                <Button key={cat} variant={selectedCategory === cat ? 'default' : 'secondary'} onClick={() => setSelectedCategory(cat)}>{cat}</Button>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
        </div>
      ) : (
        <AnimatePresence>
          {products.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {products.map(product => (
                <ProductCard 
                  key={product.id} 
                  product={product} 
                  onAddToCart={handleAddToCart}
                  onBuy={handleBuyClick}
                  onEdit={handleEditClick}
                  onDelete={handleDeleteClick}
                  isOwner={user?.id === product.seller_id}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-20 glass-effect rounded-lg">
              <h3 className="text-2xl font-bold">Nenhum produto encontrado</h3>
              <p className="text-muted-foreground mt-2">Tente ajustar sua busca ou volte mais tarde.</p>
            </div>
          )}
        </AnimatePresence>
      )}

      <BuyDialog
        product={selectedProduct}
        open={isBuyDialogOpen}
        onOpenChange={setIsBuyDialogOpen}
        onConfirm={handleConfirmBuy}
      />

      <ProductFormDialog
        isOpen={isFormOpen}
        setIsOpen={setIsFormOpen}
        product={productToEdit}
        onSuccess={handleFormSuccess}
      />

      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o produto "{productToDelete?.name}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Business;