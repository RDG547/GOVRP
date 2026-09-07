import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';
import ImageUploader from '@/components/ImageUploader';
import { Switch } from '@/components/ui/switch';
import { parseCurrency, formatCurrency } from '@/lib/utils';
import { buildStoragePath, extractStoragePathFromUrl } from '@/lib/security';

const PREDEFINED_CATEGORIES = [
  "Eletrônicos",
  "Vestuário",
  "Alimentos",
  "Bebidas",
  "Casa",
  "Veículos",
  "Serviços",
  "Outros"
];

const SUBSCRIPTION_INTERVALS = [
  { value: '7 days', label: 'Semanal' },
  { value: '30 days', label: 'Mensal' },
];

const ProductFormDialog = ({ isOpen, setIsOpen, product, onSuccess }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [showPromotion, setShowPromotion] = useState(false);
  const [showCustomCategory, setShowCustomCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState('');
  const [businesses, setBusinesses] = useState([]);
  const [formData, setFormData] = useState({
    business_id: '',
    name: '',
    description: '',
    price: '',
    category: 'Outros',
    stock: '1',
    product_type: 'one-time',
    subscription_interval: '30 days',
    image_url: '',
    promotion_price: '',
    promotion_expires_at: '',
  });

  const formatCurrencyInput = (value) => {
    // Remove tudo que não é dígito
    const digits = value.replace(/\D/g, '');

    // Se não há dígitos, retorna R$ 0,00
    if (!digits) return 'R$ 0,00';

    // Converte para número e divide por 100 para obter os centavos
    const numericValue = parseInt(digits, 10) / 100;

    // Formata como moeda brasileira
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2
    }).format(numericValue);
  };

  const parseCurrencyInput = (formattedValue) => {
    // Remove "R$", espaços e substitui vírgula por ponto
    const numericString = formattedValue
      .replace('R$', '')
      .replace(/\./g, '')
      .replace(',', '.')
      .trim();

    return parseFloat(numericString) || 0;
  };

  const handleCurrencyChange = (e, field) => {
    const inputValue = e.target.value;
    const formattedValue = formatCurrencyInput(inputValue);
    setFormData(prev => ({ ...prev, [field]: formattedValue }));
  };

  useEffect(() => {
    if (product) {
      const isPredefined = PREDEFINED_CATEGORIES.includes(product.category);
      setFormData({
        business_id: product.business_id || product.seller?.business_id || '',
        name: product.name || '',
        description: product.description || '',
        price: product.price ? formatCurrency(product.price, true) : '',
        category: isPredefined ? product.category : 'custom',
        stock: product.stock === null ? '' : String(product.stock),
        product_type: product.product_type || 'one-time',
        subscription_interval: product.subscription_interval || '30 days',
        image_url: product.image_url || '',
        promotion_price: product.promotion_price ? formatCurrency(product.promotion_price, true) : '',
        promotion_expires_at: product.promotion_expires_at ? new Date(product.promotion_expires_at).toISOString().slice(0, 16) : '',
      });
      setShowPromotion(!!product.promotion_price);
      setShowCustomCategory(!isPredefined);
      if (!isPredefined) {
        setCustomCategory(product.category || '');
      }
    } else {
      setFormData({
        business_id: '',
        name: '',
        description: '',
        price: '',
        category: 'Outros',
        stock: '1',
        product_type: 'one-time',
        subscription_interval: '30 days',
        image_url: '',
        promotion_price: '',
        promotion_expires_at: '',
      });
      setShowPromotion(false);
      setShowCustomCategory(false);
      setCustomCategory('');
    }
    setImageFile(null);
  }, [product, isOpen]);

  useEffect(() => {
    if (!isOpen || !user?.id) return;
    supabase.from('businesses').select('id,name,status').eq('owner_id', user.id).in('status', ['active', 'pending']).order('name')
      .then(({ data, error }) => {
        if (error) {
          toast({ title: 'Não foi possível carregar suas empresas', description: error.message, variant: 'destructive' });
          return;
        }
        setBusinesses(data || []);

      });
  }, [isOpen, toast, user?.id]);

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSelectChange = (id, value) => {
    if (id === 'category') {
      setShowCustomCategory(value === 'custom');
    }

    if (id === 'product_type') {
      setFormData(prev => ({
        ...prev,
        product_type: value,
        stock: value === 'one-time' ? prev.stock || '1' : '',
        subscription_interval: value === 'subscription' ? prev.subscription_interval || '30 days' : '',
      }));
      return;
    }

    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    let uploadedPath = null;
    let saved = false;
    const oldFilePath = product?.image_url ? extractStoragePathFromUrl(product.image_url, 'product-images') : null;

    try {
      let finalImageUrl = formData.image_url;
      const finalCategory = formData.category === 'custom' ? customCategory.trim() : formData.category;
      const normalizedPrice = parseCurrencyInput(formData.price);
      const normalizedStock = parseInt(formData.stock, 10);
      const normalizedPromotionPrice = parseCurrencyInput(formData.promotion_price);

      if (formData.name.trim().length < 3) {
        throw new Error('Informe um nome com pelo menos 3 caracteres.');
      }


      if (!finalImageUrl && !imageFile) {
        throw new Error('Informe uma imagem do produto por URL ou upload.');
      }

      if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
        throw new Error('Informe um preço maior que zero.');
      }

      if (showPromotion) {
        const promotionError = validatePromotion(normalizedPrice, normalizedPromotionPrice, formData.promotion_expires_at);
        if (promotionError) throw new Error(promotionError);
      }

      if (formData.description.trim().length < 5) {
        throw new Error('Descreva o produto com pelo menos 5 caracteres.');
      }

      if (!finalCategory) {
        throw new Error('Informe a categoria do produto.');
      }

      if (!formData.product_type) {
        throw new Error('Informe o tipo do produto.');
      }

      if (formData.product_type === 'one-time' && (!Number.isInteger(normalizedStock) || (normalizedStock < 0 || (!product && normalizedStock < 1)))) {
        throw new Error('Informe um estoque válido para compra única.');
      }

      if (formData.product_type === 'subscription' && !formData.subscription_interval) {
        throw new Error('Defina a periodicidade da assinatura antes de anunciar o produto.');
      }

      if (imageFile) {

        const newFileName = buildStoragePath({ prefix: '', entityId: user.id, fileName: imageFile.name });
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(newFileName, imageFile);

        if (uploadError) throw uploadError;

        finalImageUrl = supabase.storage.from('product-images').getPublicUrl(uploadData.path).data.publicUrl;

        uploadedPath = uploadData.path;
      }

      const { error } = await supabase.rpc('save_business_product', {
        p_product_id: product?.id || null,
        p_business_id: formData.business_id || null,
        p_name: formData.name,
        p_description: formData.description,
        p_price: normalizedPrice,
        p_image_url: finalImageUrl,
        p_product_type: formData.product_type,
        p_subscription_interval: formData.product_type === 'subscription' ? formData.subscription_interval : null,
        p_category: finalCategory,
        p_stock: formData.product_type === 'one-time' ? normalizedStock : null,
        p_promotion_price: showPromotion && normalizedPromotionPrice > 0 ? normalizedPromotionPrice : null,
        p_promotion_expires_at: showPromotion && normalizedPromotionPrice > 0 && formData.promotion_expires_at
          ? new Date(formData.promotion_expires_at).toISOString()
          : null,
      });

      if (error) throw error;

      saved = true;
      if (uploadedPath && oldFilePath && uploadedPath !== oldFilePath) await supabase.storage.from('product-images').remove([oldFilePath]);
      toast({ title: `Produto ${product ? 'atualizado' : 'criado'} com sucesso!` });
      onSuccess();
    } catch (error) {
      toast({ title: 'Erro ao salvar produto', description: userErrorMessage(error), variant: 'destructive' });
    } finally {
      if (!saved && uploadedPath) await supabase.storage.from('product-images').remove([uploadedPath]);
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!loading) setIsOpen(open); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{product ? 'Editar Produto' : 'Adicionar Novo Produto'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="max-h-[calc(90vh-5rem)] space-y-4 overflow-y-auto px-6 pb-6 pt-4 custom-scrollbar">
          <div className="space-y-2">
            <Label>Vender como</Label>
            <Select value={formData.business_id || 'citizen'} onValueChange={(value) => handleSelectChange('business_id', value === 'citizen' ? '' : value)}>
              <SelectTrigger><SelectValue placeholder="Pessoa Física" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="citizen">Pessoa Física — {user?.full_name || 'Meu cidadão'}</SelectItem>
                {businesses.map((business) => <SelectItem key={business.id} value={business.id}>{business.name}{business.status === 'pending' ? ' (aguardando ativação)' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{formData.business_id ? 'A venda será vinculada à empresa selecionada.' : 'Venda em seu nome e receba na sua conta, sem precisar de CNPJ.'}</p>
          </div>
          <ImageUploader
            onUrlChange={(url) => setFormData(p => ({ ...p, image_url: url }))}
            onFileChange={setImageFile}
            initialUrl={formData.image_url}
            label="Imagem do Produto (Obrigatório)"
          />
          <div><Label htmlFor="name">Nome</Label><Input id="name" value={formData.name} onChange={handleChange} required /></div>
          <div>
            <Label htmlFor="price">Preço</Label>
            <Input
              id="price"
              value={formData.price}
              onChange={(e) => handleCurrencyChange(e, 'price')}
              placeholder="R$ 0,00"
              required
            />
          </div>
          <div><Label htmlFor="description">Descrição</Label><Textarea id="description" value={formData.description} onChange={handleChange} required /></div>
          <div>
            <Label htmlFor="category">Categoria</Label>
            <Select onValueChange={(value) => handleSelectChange('category', value)} value={formData.category}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PREDEFINED_CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                <SelectItem value="custom">Outra (Personalizada)</SelectItem>
              </SelectContent>
          </Select>
          </div>
          {showCustomCategory && (
            <div><Label htmlFor="custom_category">Nome da Categoria Personalizada</Label><Input id="custom_category" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} required /></div>
          )}
          <div>
            <Label htmlFor="product_type">Tipo</Label>
            <Select onValueChange={(value) => handleSelectChange('product_type', value)} value={formData.product_type}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="one-time">Compra Única</SelectItem>
                <SelectItem value="subscription">Assinatura</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {formData.product_type === 'subscription' && (
            <div>
              <Label htmlFor="subscription_interval">Periodicidade</Label>
              <Select
                onValueChange={(value) => handleSelectChange('subscription_interval', value)}
                value={formData.subscription_interval}
              >
                <SelectTrigger id="subscription_interval"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUBSCRIPTION_INTERVALS.map((interval) => (
                    <SelectItem key={interval.value} value={interval.value}>
                      {interval.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {formData.product_type === 'one-time' && (
            <div><Label htmlFor="stock">Estoque</Label><Input id="stock" type="number" value={formData.stock} onChange={handleChange} required /></div>
          )}
          <div className="space-y-2 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="show-promotion">Promoção (Opcional)</Label>
              <Switch id="show-promotion" checked={showPromotion} onCheckedChange={setShowPromotion} />
            </div>
            {showPromotion && (
              <div className="space-y-4 pt-4">
                <div>
                  <Label htmlFor="promotion_price">Preço Promocional</Label>
                  <Input
                    id="promotion_price"
                    value={formData.promotion_price}
                    onChange={(e) => handleCurrencyChange(e, 'promotion_price')}
                    placeholder="R$ 0,00"
                  />
                </div>
                <div><Label htmlFor="promotion_expires_at">Fim da Promoção</Label><Input id="promotion_expires_at" type="datetime-local" value={formData.promotion_expires_at} onChange={handleChange} /></div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading || !formData.image_url && !imageFile}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {product ? 'Salvar Alterações' : 'Anunciar Produto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ProductFormDialog;
import { userErrorMessage, validatePromotion } from '@/lib/userErrors';
