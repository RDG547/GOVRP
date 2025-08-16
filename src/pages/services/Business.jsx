import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { ShoppingCart, Search, PlusCircle, Loader2, Briefcase, Edit, Trash2, Repeat } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import PageHeader from '@/components/layout/PageHeader';
import { Label } from '@/components/ui/label';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import ImageUploader from '@/components/ImageUploader';

const ProductDialog = ({ open, onOpenChange, product, onSave }) => {
    const [formData, setFormData] = useState({ name: '', description: '', price: '', product_type: 'one-time', subscription_interval: '7 days' });
    const [imageUrl, setImageUrl] = useState('');
    const [imageFile, setImageFile] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const { toast } = useToast();
    const { user } = useAuth();
    const [userHasCnpj, setUserHasCnpj] = useState(false);

    useEffect(() => {
        const checkCnpj = async () => {
            if (user) {
                const { data, error } = await supabase.from('documents').select('id').eq('user_id', user.id).eq('type', 'CNPJ').limit(1);
                if (data && data.length > 0) {
                    setUserHasCnpj(true);
                }
            }
        };
        checkCnpj();
    }, [user]);

    useEffect(() => {
        if (product) {
            setFormData({
                name: product.name || '',
                description: product.description || '',
                price: formatCurrency(product.price * 100) || '',
                product_type: product.product_type || 'one-time',
                subscription_interval: product.subscription_interval || '7 days'
            });
            setImageUrl(product.image_url || '');
        } else {
            setFormData({ name: '', description: '', price: '', product_type: 'one-time', subscription_interval: '7 days' });
            setImageUrl('');
        }
        setImageFile(null);
    }, [product, open]);

    const handleChange = (e) => {
        const { id, value } = e.target;
        if (id === 'price') {
            setFormData(prev => ({ ...prev, [id]: formatCurrency(value) }));
        } else {
            setFormData(prev => ({ ...prev, [id]: value }));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.name || !formData.price) {
            toast({ title: "Campos obrigatórios", description: "Nome e preço são obrigatórios.", variant: "destructive" });
            return;
        }
        if (formData.product_type === 'subscription' && !userHasCnpj) {
            toast({ title: "CNPJ Necessário", description: "Você precisa de um CNPJ para vender serviços de assinatura.", variant: "destructive" });
            return;
        }
        setSubmitting(true);
        
        let finalImageUrl = imageUrl;
        if (imageFile) {
            const fileExt = imageFile.name.split('.').pop();
            const fileName = `${user.id}-${Date.now()}.${fileExt}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('product-images')
                .upload(fileName, imageFile);

            if (uploadError) {
                toast({ title: "Erro no Upload", description: uploadError.message, variant: "destructive" });
                setSubmitting(false);
                return;
            }
            const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(uploadData.path);
            finalImageUrl = urlData.publicUrl;
        }

        const productData = {
            ...formData,
            price: parseCurrency(formData.price),
            image_url: finalImageUrl,
            seller_id: user.id
        };

        let error;
        if (product) {
            const { error: updateError } = await supabase.from('products').update(productData).eq('id', product.id);
            error = updateError;
        } else {
            const { error: insertError } = await supabase.from('products').insert(productData);
            error = insertError;
        }

        if (error) {
            toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: `Produto ${product ? 'atualizado' : 'anunciado'}.` });
            onSave();
        }
        setSubmitting(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-foreground">
                <DialogHeader>
                    <DialogTitle>{product ? 'Editar Produto/Serviço' : 'Anunciar Novo Produto/Serviço'}</DialogTitle>
                    <DialogDescription>Preencha os detalhes do seu item.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div><Label htmlFor="name">Nome</Label><Input id="name" value={formData.name} onChange={handleChange} /></div>
                    <div><Label htmlFor="description">Descrição</Label><Textarea id="description" value={formData.description} onChange={handleChange} /></div>
                    <div><Label htmlFor="price">Preço</Label><Input id="price" value={formData.price} onChange={handleChange} placeholder="R$ 0,00" /></div>
                    <div>
                        <Label htmlFor="product_type">Tipo</Label>
                        <Select value={formData.product_type} onValueChange={(value) => setFormData(p => ({...p, product_type: value}))}>
                            <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="one-time">Pagamento Único</SelectItem>
                                <SelectItem value="subscription">Assinatura</SelectItem>
                            </SelectContent>
                        </Select>
                        {formData.product_type === 'subscription' && !userHasCnpj && (
                            <p className="text-xs text-yellow-400 mt-1">É necessário ter um CNPJ para vender assinaturas.</p>
                        )}
                    </div>
                    {formData.product_type === 'subscription' && (
                        <div>
                            <Label htmlFor="subscription_interval">Cobrança</Label>
                            <Select value={formData.subscription_interval} onValueChange={(value) => setFormData(p => ({...p, subscription_interval: value}))}>
                                <SelectTrigger><SelectValue placeholder="Selecione o intervalo" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="7 days">Semanal</SelectItem>
                                    <SelectItem value="1 month">Mensal</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <ImageUploader onUrlChange={setImageUrl} onFileChange={setImageFile} initialUrl={imageUrl} />
                    <DialogFooter>
                        <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Cancelar</Button>
                        <Button type="submit" disabled={submitting}>{submitting && <Loader2 className="animate-spin mr-2" />}{product ? 'Salvar' : 'Anunciar'}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const Business = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [buyingProduct, setBuyingProduct] = useState(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('products').select('*, seller:profiles(id, username)');
    if (searchTerm) {
      query = query.ilike('name', `%${searchTerm}%`);
    }
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error("Error fetching products:", error);
      toast({ title: "Erro", description: "Não foi possível carregar os produtos.", variant: "destructive" });
    } else {
      setProducts(data);
    }
    setLoading(false);
  }, [searchTerm, toast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleSave = () => {
    setIsDialogOpen(false);
    setEditingProduct(null);
    fetchProducts();
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setIsDialogOpen(true);
  };

  const handleDelete = async (productId) => {
    const { error } = await supabase.from('products').delete().eq('id', productId);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Sucesso!", description: "Produto excluído." });
      fetchProducts();
    }
  };

  const handleBuyProduct = async () => {
    if (!buyingProduct) return;
    const { data, error } = await supabase.rpc('buy_product', { p_product_id: buyingProduct.id });
    if (error || !data.success) {
        toast({ title: "Erro na Compra", description: data?.message || error.message, variant: "destructive" });
    } else {
        toast({ title: "Sucesso!", description: data.message });
    }
    setBuyingProduct(null);
  };

  return (
    <>
      <Helmet>
        <title>Negócios Livres - GOV.RP</title>
        <meta name="description" content="Marketplace do GOV.RP para compra e venda de produtos e serviços." />
      </Helmet>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <PageHeader
            icon={Briefcase}
            title="Negócios"
            gradientText="Livres"
            description="O marketplace oficial do GOV.RP para compra e venda de produtos e serviços."
            iconColor="text-blue-400"
          />
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12">
            <div className="relative w-full md:w-1/2">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                type="text"
                placeholder="O que você está procurando?"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-6 text-lg bg-background/50 border-border rounded-lg"
                />
            </div>
            {user && (
                <Button onClick={() => { setEditingProduct(null); setIsDialogOpen(true); }} className="mt-4 md:mt-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
                    <PlusCircle className="w-5 h-5 mr-2" /> Anunciar
                </Button>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center items-center min-h-[40vh]">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {products.length > 0 ? products.map((product, index) => (
                <motion.div key={product.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                  <Card className="glass-effect h-full flex flex-col overflow-hidden group">
                    <CardHeader className="p-0 relative">
                      <div className="aspect-video bg-secondary overflow-hidden">
                        <img src={product.image_url || 'https://images.unsplash.com/photo-1559223669-e0065fa7f142'} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      </div>
                      {user?.id === product.seller.id && (
                        <div className="absolute top-2 right-2 flex gap-2">
                          <Button size="icon" variant="secondary" className="h-8 w-8" onClick={() => handleEdit(product)}><Edit className="w-4 h-4" /></Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild><Button size="icon" variant="destructive" className="h-8 w-8"><Trash2 className="w-4 h-4" /></Button></AlertDialogTrigger>
                            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle><AlertDialogDescription>Tem certeza que deseja excluir este anúncio?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(product.id)}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                      <div className="p-4">
                        <CardTitle className="text-lg text-foreground truncate">{product.name}</CardTitle>
                        {product.product_type === 'subscription' && <span className="text-xs font-bold text-purple-400 flex items-center gap-1"><Repeat className="w-3 h-3"/> ASSINATURA</span>}
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 flex-grow">
                      <p className="text-sm text-muted-foreground mb-2">Vendido por: @{product.seller.username}</p>
                      <p className="text-sm text-foreground">{product.description}</p>
                    </CardContent>
                    <CardFooter className="p-4 flex justify-between items-center">
                      <div>
                        <p className="text-xl font-bold gradient-text">{formatCurrency(product.price * 100)}</p>
                        {product.product_type === 'subscription' && <p className="text-xs text-muted-foreground">/ {product.subscription_interval === '7 days' ? 'semana' : 'mês'}</p>}
                      </div>
                      <AlertDialog open={!!buyingProduct && buyingProduct.id === product.id} onOpenChange={(open) => !open && setBuyingProduct(null)}>
                        <AlertDialogTrigger asChild>
                            <Button onClick={() => setBuyingProduct(product)} size="sm" disabled={product.seller.id === user?.id}>
                                {product.seller.id === user?.id ? "Seu Produto" : <><ShoppingCart className="w-4 h-4 mr-2" /> Comprar</>}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Confirmar Compra</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Você está prestes a comprar "{product.name}" por {formatCurrency(product.price * 100)}. O valor será debitado da sua conta bancária.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={handleBuyProduct}>Confirmar</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </CardFooter>
                  </Card>
                </motion.div>
              )) : (
                <div className="col-span-full text-center py-16">
                  <p className="text-muted-foreground">Nenhum produto encontrado.</p>
                </div>
              )}
            </div>
          )}
        </motion.div>
        <ProductDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} product={editingProduct} onSave={handleSave} />
      </div>
    </>
  );
};

export default Business;