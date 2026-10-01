import { usePublicCompanyChanges } from '@/hooks/use-public-company-changes';
import ListingCosts from '@/components/business/ListingCosts';
import { brandFont } from '@/lib/brandFonts';
import ReportProduct from '@/components/business/ReportProduct';
import { useMarketplace } from '@/hooks/use-marketplace';
import BuyDialog from '@/components/business/PurchaseDialog';
import { categoryIcon } from '@/lib/commerceIcons';
import { useRef } from 'react';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
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
import { cn, formatCurrency, formatCNPJ } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import ProductFormDialog from '@/components/dashboard/ProductFormDialog';
import { useCart } from '@/contexts/CartContext';
import Cart from '@/components/business/Cart';
import { executeProductPurchase } from '@/lib/commerce';

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

const ProductCard = ({ now, product, onAddToCart, onBuy, onEdit, onDelete, isOwner }) => {
  const navigate = useNavigate();

  const hasPromotion = product.promotion_price && new Date(product.promotion_expires_at) > new Date();

  const finalPrice = Number(product.final_price);
  const basePrice = Number(hasPromotion ? product.promotion_price : product.price);
  const isRestricted = Boolean(product.seller?.activity_restricted);

  const seller = product.seller || { full_name: 'Cidadão indisponível' };
  const isBusiness = Boolean(product.business_id || seller.business_id);
  const businessDoc = seller.documents?.find(d => d.type === 'CNPJ');
  const businessName = product.business?.name || seller.business_name || (isBusiness ? businessDoc?.metadata?.company_name : null);
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
            <StockBadge stock={product.stock} />{product.stock<=0&&now<Date.parse(product.metadata?.stock_depleted_at)+5000&&<span role="status" className="absolute bottom-2 right-2 flex h-11 w-11 items-center justify-center rounded-full border-4 border-red-400 bg-background font-bold" aria-label="Movendo para esgotados">{Math.max(1,Math.ceil((Date.parse(product.metadata.stock_depleted_at)+5000-now)/1000))}</span>}
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
            <span>{isBusiness ? 'Empresa' : 'Pessoa Física'} · Vendido por: <Link to={isBusiness ? `/services/companies/${product.business_id||seller.business_id}` : `/services/x/profile/${seller.x_handle}`} style={isBusiness?{fontFamily:brandFont(seller.business_font_key)}:undefined} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline no-navigate">{businessName || seller.full_name}</Link></span>
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
                <span className="text-xs text-emerald-400">Em promoção</span>
              </div>
            ) : (
              <p className="text-2xl font-bold text-white">{formatCurrency(finalPrice)}</p>
            )}
            {product.tax_rate > 0 && <p className="text-xs text-muted-foreground">Inclui {formatCurrency(finalPrice - basePrice)} de impostos</p>}
            {product.product_type === 'subscription' && <p className="text-xs text-muted-foreground">/mês</p>}
          </div>
          {isOwner ? (
            <Button className="w-full" variant="outline" disabled>
              <CheckCircle className="w-4 h-4 mr-2 text-green-400" />
              Seu Produto
            </Button>
          ) : (
            <div className="w-full flex flex-col gap-2 no-navigate">
                <Button className={`w-full ${product.product_type === 'subscription' ? 'bg-purple-600 hover:bg-purple-500 text-white' : ''}`} onClick={(e) => { e.stopPropagation(); onBuy(product); }} disabled={isOutOfStock || isRestricted}>
                    {isRestricted ? 'Atividade suspensa por norma vigente' : isOutOfStock ? 'Esgotado' : (product.product_type === 'subscription' ? <><Repeat className="w-4 h-4 mr-2" /> Assinar</> : <><ShoppingBag className="w-4 h-4 mr-2" />Comprar</>)}
                </Button>
                <ReportProduct product={product} />
                {product.product_type !== 'subscription' && (
                    <Button variant="outline" className="w-full" onClick={(e) => { e.stopPropagation(); onAddToCart(product); }} disabled={isOutOfStock || isRestricted}>
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

const Business = () => {
  const { enterprise } = useMarketplace();
  const [serverOffset,setServerOffset] = useState(0);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [stockTab,setStockTab] = useState('available');
  const [now,setNow] = useState(Date.now);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()+serverOffset),250);return()=>clearInterval(timer);},[serverOffset]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productToEdit, setProductToEdit] = useState(null);
  const [productToDelete, setProductToDelete] = useState(null);
  const [isBuyDialogOpen, setIsBuyDialogOpen] = useState(false);
    const purchaseIntent = useRef(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const { user } = useAuth();
  const { toast } = useToast();
  const { addToCart } = useCart();

  const requestVersion = useRef(0);
  const fetchProductsAndCategories = useCallback(async () => {
    const version = ++requestVersion.current;

    const [result, clock] = await Promise.all([supabase.rpc('get_products_with_final_price'),supabase.rpc('get_server_now')]);
    const {data,error}=result;
    if(clock.data&&!clock.error)setServerOffset(Date.parse(clock.data)-Date.now());

    if (version !== requestVersion.current) return;
    if (error) {
        console.error('marketplace:products', error);
        toast({ title: "Erro ao buscar produtos", description: 'Não foi possível atualizar os produtos. Tente novamente.', variant: "destructive" });
    } else {
        setProducts(data || []);
        setSelectedProduct(current => current ? data?.find(product => product.id === current.id) || { ...current, unavailable: true } : null);

        const uniqueCategories = [...new Set((data || []).map(p => p.category).filter(Boolean))];
        setCategories(uniqueCategories);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchProductsAndCategories();
    }, 300);
    return () => clearTimeout(debounce);
  }, [fetchProductsAndCategories]);

  useDomainRealtime('marketplace', 'public', ['products', 'businesses', 'government_rules', 'state_enterprises'], fetchProductsAndCategories);
  usePublicProfileChanges(fetchProductsAndCategories);
  usePublicCompanyChanges(fetchProductsAndCategories);
  const inStockTab = product => {const depleted=product.product_type==='one-time'&&product.stock<=0;const moved=depleted&&(!product.metadata?.stock_depleted_at||now>=Date.parse(product.metadata.stock_depleted_at)+5000);return stockTab==='sold-out'?moved:!moved;};
  const visibleProducts = products.filter(product => inStockTab(product) && (!searchTerm || product.name.toLocaleLowerCase('pt-BR').includes(searchTerm.toLocaleLowerCase('pt-BR'))) && (selectedCategory === 'all' || product.category === selectedCategory));

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
    if (!addToCart(product)) return;
    toast({ title: "Produto adicionado!", description: `${product.name} foi adicionado ao seu carrinho.` });
  };

  const handleConfirmBuy = async (paymentMethod, cardId) => {
    if (!selectedProduct) return;

    const signature = JSON.stringify([user.id, selectedProduct.id, paymentMethod, cardId || null]);
    if (purchaseIntent.current?.signature !== signature) purchaseIntent.current = { signature, key: crypto.randomUUID() };
    const result = await executeProductPurchase({
      supabase,
      productId: selectedProduct.id,
      paymentMethod,
      cardId,
      idempotencyKey: purchaseIntent.current.key,
    });

    if (!result.success) {
      toast({ title: "Erro na compra", description: result.message, variant: "destructive" });
      return;
    } else {
      toast({ title: "Sucesso!", description: result.message });
      fetchProductsAndCategories();
    }
    purchaseIntent.current = null;
    setIsBuyDialogOpen(false);
    setSelectedProduct(null);
  };

  const handleDeleteClick = (product) => {
    setProductToDelete(product);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!productToDelete) return;
    const { error } = await supabase.rpc('archive_my_product',{p_product_id:productToDelete.id});
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

      <div className="mb-4 flex flex-wrap gap-3"><Button asChild variant="outline"><Link to="/dashboard/citizen?tab=business">Meus anúncios e renovações</Link></Button></div><div className="grid gap-3 sm:grid-cols-2"><ListingCosts enterprise={enterprise}/><ListingCosts enterprise={enterprise} business/></div>
      {enterprise && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><p className="text-sm">{enterprise.is_privatized ? 'Marketplace privatizado' : 'Marketplace estatal'} · Taxas conforme Pessoa Física ou Jurídica · {enterprise.publication_mode === 'approval' ? 'Anúncios sujeitos à aprovação' : 'Publicação automática'}{!enterprise.is_active ? ' · Operação suspensa' : ''}</p></div>}
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
          <div className="flex flex-wrap items-center gap-2">
            <Cart />
            <Link to="/services/inventory">
              <Button variant="outline"><Package className="w-4 h-4 mr-2" /> Meu Inventário</Button>
            </Link>
            <Button onClick={handleAddClick}>
              <PlusCircle className="w-4 h-4 mr-2" /> Vender Produto
            </Button>
          </div>
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}><SelectTrigger aria-label="Categoria dos produtos" className="w-full md:w-72"><SelectValue /></SelectTrigger><SelectContent className="[&>div]:max-h-[192px]"><SelectItem value="all">Todas as categorias</SelectItem>{categories.map(category=>{const Icon=categoryIcon(category);return <SelectItem key={category} value={category}><span className="flex items-center gap-2"><Icon className="h-4 w-4" />{category}</span></SelectItem>;})}</SelectContent></Select>
      </div>

      <div role="tablist" aria-label="Disponibilidade de produtos" className="mb-5 flex gap-2"><Button role="tab" aria-selected={stockTab==='available'} variant={stockTab==='available'?'default':'outline'} className="gap-2 text-emerald-400" onClick={()=>setStockTab('available')}><CheckCircle className="h-4 w-4"/>Disponíveis</Button><Button role="tab" aria-selected={stockTab==='sold-out'} variant={stockTab==='sold-out'?'default':'outline'} className="gap-2 text-red-400" onClick={()=>setStockTab('sold-out')}><Package className="h-4 w-4"/>Esgotados</Button></div>
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
        </div>
      ) : (
        <AnimatePresence>
          {visibleProducts.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {visibleProducts.map(product => (
                <ProductCard
                  key={product.id}
                  now={now}
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
