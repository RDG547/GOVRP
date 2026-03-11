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

const ProductFormDialog = ({ isOpen, setIsOpen, product, onSuccess }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [showPromotion, setShowPromotion] = useState(false);
  const [showCustomCategory, setShowCustomCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    category: 'Outros',
    stock: '1',
    product_type: 'one-time',
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
        name: product.name || '',
        description: product.description || '',
        price: product.price ? formatCurrency(product.price, true) : '',
        category: isPredefined ? product.category : 'custom',
        stock: product.stock === null ? '' : String(product.stock),
        product_type: product.product_type || 'one-time',
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
        name: '',
        description: '',
        price: '',
        category: 'Outros',
        stock: '1',
        product_type: 'one-time',
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

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSelectChange = (id, value) => {
    if (id === 'category') {
      setShowCustomCategory(value === 'custom');
    }
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const getFilePathFromUrl = (url, bucketName) => {
    if (!url) return null;
    try {
      const urlObject = new URL(url);
      const pathSegments = urlObject.pathname.split('/');
      const bucketIndex = pathSegments.indexOf(bucketName);
      if (bucketIndex === -1 || bucketIndex + 1 >= pathSegments.length) return null;
      return pathSegments.slice(bucketIndex + 1).join('/');
    } catch (e) {
      console.error('Invalid URL for file path extraction:', e);
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      let finalImageUrl = formData.image_url;

      if (imageFile) {
        const oldFilePath = product?.image_url ? getFilePathFromUrl(product.image_url, 'product-images') : null;

        const newFileName = `${user.id}/${Date.now()}-${imageFile.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(newFileName, imageFile);

        if (uploadError) throw uploadError;

        finalImageUrl = supabase.storage.from('product-images').getPublicUrl(uploadData.path).data.publicUrl;

        if (oldFilePath) {
          await supabase.storage.from('product-images').remove([oldFilePath]);
        }
      }

      const finalCategory = formData.category === 'custom' ? customCategory : formData.category;

      const productData = {
        ...formData,
        category: finalCategory,
        seller_id: user.id,
        price: parseCurrencyInput(formData.price),
        stock: formData.product_type === 'one-time' ? parseInt(formData.stock, 10) : null,
        image_url: finalImageUrl,
        promotion_price: showPromotion ? parseCurrencyInput(formData.promotion_price) : null,
        promotion_expires_at: showPromotion && formData.promotion_expires_at ? new Date(formData.promotion_expires_at).toISOString() : null,
      };

      delete productData.price_formatted;
      delete productData.promotion_price_formatted;

      const { error } = product
        ? await supabase.from('products').update(productData).eq('id', product.id)
        : await supabase.from('products').insert(productData);

      if (error) throw error;

      toast({ title: `Produto ${product ? 'atualizado' : 'criado'} com sucesso!` });
      onSuccess();
    } catch (error) {
      toast({ title: 'Erro ao salvar produto', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? 'Editar Produto' : 'Adicionar Novo Produto'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
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
          <div><Label htmlFor="description">Descrição</Label><Textarea id="description" value={formData.description} onChange={handleChange} /></div>
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
            <div><Label htmlFor="custom_category">Nome da Categoria Personalizada</Label><Input id="custom_category" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} /></div>
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