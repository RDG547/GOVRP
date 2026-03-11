import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, ShoppingCart, Star, MessageSquare, Send, Share2, Copy, ArrowLeft, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatCurrency, formatCNPJ } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { useCart } from '@/contexts/CartContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const StarRating = ({ rating, setRating, interactive = true }) => {
    return (
        <div className="flex items-center">
            {[1, 2, 3, 4, 5].map((star) => (
                <Star
                    key={star}
                    className={`w-5 h-5 ${interactive ? 'cursor-pointer' : ''} ${star <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400'}`}
                    onClick={() => interactive && setRating(star)}
                />
            ))}
        </div>
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

  const finalPrice = product.final_price;

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

const ProductDetails = () => {
    const { productId } = useParams();
    const { user } = useAuth();
    const { toast } = useToast();
    const { addToCart } = useCart();
    const navigate = useNavigate();
    const [product, setProduct] = useState(null);
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newReview, setNewReview] = useState('');
    const [newRating, setNewRating] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isBuyDialogOpen, setIsBuyDialogOpen] = useState(false);

    const fetchProductDetails = useCallback(async () => {
        setLoading(true);
        const { data: allProducts, error: productError } = await supabase
            .rpc('get_products_with_final_price');

        if (productError) {
            toast({ title: "Erro", description: "Produto não encontrado.", variant: "destructive" });
            setLoading(false);
            return;
        }

        const productData = allProducts.find(p => p.id === productId);

        if (!productData) {
            toast({ title: "Erro", description: "Produto não encontrado.", variant: "destructive" });
            setLoading(false);
            return;
        }
        
        setProduct(productData);

        const { data: reviewsData, error: reviewsError } = await supabase
            .from('product_reviews')
            .select('*, author:profiles(id, full_name, avatar_url)')
            .eq('product_id', productId)
            .order('created_at', { ascending: false });

        if (reviewsError) {
            console.error("Review fetch error:", reviewsError);
            toast({ title: "Erro", description: "Não foi possível carregar as avaliações.", variant: "destructive" });
        } else {
            setReviews(reviewsData);
        }

        setLoading(false);
    }, [productId, toast]);

    useEffect(() => {
        fetchProductDetails();
    }, [fetchProductDetails]);

    const handleReviewSubmit = async () => {
        if (!newReview.trim() || newRating === 0) {
            toast({ title: "Avaliação incompleta", description: "Por favor, escreva um comentário e selecione uma nota.", variant: "destructive" });
            return;
        }
        setIsSubmitting(true);
        const { error } = await supabase.from('product_reviews').insert({
            product_id: productId,
            user_id: user.id,
            rating: newRating,
            comment: newReview,
        });
        setIsSubmitting(false);
        if (error) {
            toast({ title: "Erro ao enviar avaliação", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Avaliação enviada com sucesso!" });
            setNewReview('');
            setNewRating(0);
            fetchProductDetails();
        }
    };
    
    const handleCopyLink = () => {
        const url = window.location.href;
        navigator.clipboard.writeText(url);
        toast({ title: 'Link copiado!', description: 'O link para o produto foi copiado.' });
    };

    const handleSocialShare = (platform) => {
        const url = encodeURIComponent(window.location.href);
        const text = encodeURIComponent(product.name);
        let shareUrl = '';
        switch(platform) {
            case 'twitter': shareUrl = `https://twitter.com/intent/tweet?url=${url}&text=${text}`; break;
            case 'facebook': shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${url}`; break;
            case 'whatsapp': shareUrl = `https://api.whatsapp.com/send?text=${text}%20${url}`; break;
            default: return;
        }
        window.open(shareUrl, '_blank');
    };

    const handleConfirmBuy = async (paymentMethod, cardId) => {
        if (!product) return;

        const { data, error } = await supabase.rpc('buy_product', {
            p_product_id: product.id,
            p_payment_method: paymentMethod,
            p_card_id: cardId || null,
        });

        if (error || !data.success) {
            toast({ title: "Erro na compra", description: data?.message || error?.message || "Ocorreu um erro.", variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            fetchProductDetails();
        }
        setIsBuyDialogOpen(false);
    };

    if (loading) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="w-16 h-16 animate-spin text-primary" /></div>;
    }

    if (!product) {
        return <div className="text-center py-20">Produto não encontrado.</div>;
    }

    const seller = product.seller;
    const isBusiness = seller.role === 'PJ';
    const businessName = isBusiness && seller.documents && seller.documents.length > 0 ? seller.documents[0]?.metadata?.trade_name : null;
    const businessCnpj = isBusiness && seller.documents && seller.documents.length > 0 ? seller.documents[0]?.document_number : null;
    const isSubscription = product.product_type === 'subscription';
    const isOutOfStock = product.product_type === 'one-time' && product.stock <= 0;
    const finalPrice = product.final_price;
    const basePrice = product.promotion_price && new Date(product.promotion_expires_at) > new Date() ? product.promotion_price : product.price;

    return (
        <>
            <Helmet>
                <title>{product.name} - Negócios Livres</title>
                <meta name="description" content={product.description} />
            </Helmet>
            <div className="container mx-auto p-4 md:p-8">
                <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12">
                    <div className="lg:col-span-3">
                        <img src={product.image_url} alt={product.name} className="w-full rounded-lg shadow-lg aspect-video object-cover" />
                    </div>
                    <div className="lg:col-span-2 flex flex-col">
                        <h1 className="text-3xl lg:text-4xl font-bold mb-2">{product.name}</h1>
                        <div className="text-sm text-muted-foreground mb-4">
                            Vendido por: <Link to={`/services/x/profile/${seller.x_handle}`} className="text-primary hover:underline">{businessName || seller.full_name}</Link>
                            {isBusiness && businessCnpj && <span className="text-xs block">CNPJ: {formatCNPJ(businessCnpj)}</span>}
                        </div>
                        <p className="text-4xl font-bold mb-1">{formatCurrency(finalPrice)} {isSubscription && <span className="text-lg text-muted-foreground">/mês</span>}</p>
                        {product.tax_rate > 0 && <p className="text-xs text-muted-foreground mb-4">Inclui {formatCurrency(finalPrice - basePrice)} de impostos</p>}
                        
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
                            <Button size="lg" className="w-full sm:w-auto" onClick={() => setIsBuyDialogOpen(true)} disabled={isOutOfStock}>
                                {isOutOfStock ? 'Esgotado' : (isSubscription ? <><Star className="mr-2 h-5 w-5" /> Assinar</> : <><ShoppingBag className="mr-2 h-5 w-5" /> Comprar Agora</>)}
                            </Button>
                            {!isSubscription && (
                                <Button size="lg" variant="outline" className="w-full sm:w-auto" onClick={() => { addToCart(product); toast({ title: 'Adicionado ao carrinho!' }); }} disabled={isOutOfStock}>
                                    <ShoppingCart className="mr-2 h-5 w-5" /> Adicionar ao Carrinho
                                </Button>
                            )}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button size="lg" variant="ghost" className="w-full sm:w-auto"><Share2 className="h-5 w-5" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <DropdownMenuItem onClick={handleCopyLink}><Copy className="mr-2 h-4 w-4" />Copiar Link</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => handleSocialShare('twitter')}>Compartilhar no X</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleSocialShare('facebook')}>Compartilhar no Facebook</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleSocialShare('whatsapp')}>Compartilhar no WhatsApp</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        <p className="text-muted-foreground mb-6 flex-grow">{product.description}</p>
                    </div>
                </div>

                <div className="mt-12">
                    <h2 className="text-2xl font-bold mb-6">Avaliações e Comentários</h2>
                    <Card className="glass-effect">
                        <CardHeader>
                            <CardTitle>Deixe sua avaliação</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <StarRating rating={newRating} setRating={setNewRating} />
                                <Textarea
                                    placeholder="Escreva seu comentário..."
                                    value={newReview}
                                    onChange={(e) => setNewReview(e.target.value)}
                                />
                                <Button onClick={handleReviewSubmit} disabled={isSubmitting}>
                                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                    Enviar Avaliação
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="mt-8 space-y-6">
                        {reviews.length > 0 ? reviews.map(review => (
                            <Card key={review.id} className="glass-effect">
                                <CardContent className="p-6">
                                    <div className="flex items-start gap-4">
                                        <Avatar>
                                            <AvatarImage src={review.author.avatar_url} />
                                            <AvatarFallback>{review.author.full_name.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-center">
                                                <p className="font-semibold">{review.author.full_name}</p>
                                                <StarRating rating={review.rating} interactive={false} />
                                            </div>
                                            <p className="text-xs text-muted-foreground mb-2">{new Date(review.created_at).toLocaleDateString('pt-BR')}</p>
                                            <p className="text-sm text-muted-foreground">{review.comment}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )) : (
                            <p className="text-center text-muted-foreground py-8">Este produto ainda não tem avaliações.</p>
                        )}
                    </div>
                </div>
                <BuyDialog
                    product={product}
                    open={isBuyDialogOpen}
                    onOpenChange={setIsBuyDialogOpen}
                    onConfirm={handleConfirmBuy}
                />
            </div>
        </>
    );
};

export default ProductDetails;