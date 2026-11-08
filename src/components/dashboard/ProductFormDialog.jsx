import {CurrencyInput} from '@/components/ui/currency-input';
import { usePhoneApp } from '@/contexts/PhoneAppContext';
import NeedEffects from '@/components/NeedEffects';
import { NEEDS } from '@/lib/citizenNeedsPresentation';
import { marketplacePolicy } from '@/lib/marketplaceFees';
import ListingCosts from '@/components/business/ListingCosts';
import { useMarketplace } from '@/hooks/use-marketplace';
import { useRef } from 'react';
import { toBrasiliaInput, fromBrasiliaInput } from '@/lib/dateTime';
import { categoryIcon } from '@/lib/commerceIcons';
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, User, Package, FileText, Tag, Coins, Boxes, Image as ImageIcon, Repeat, Calendar, Sparkles, Wine } from 'lucide-react';
import ImageUploader from '@/components/ImageUploader';
import { Switch } from '@/components/ui/switch';
import { parseCurrency, formatCurrency } from '@/lib/utils';
import { buildStoragePath, extractStoragePathFromUrl, detectSupportedImageContentType } from '@/lib/security';

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
  const phone=usePhoneApp();
  const { toast } = useToast();
  const { enterprise: sourceEnterprise } = useMarketplace();
  const [feeConsent, setFeeConsent] = useState(false);
  const requestKey = useRef(null);
  useEffect(()=>{if(isOpen){requestKey.current=crypto.randomUUID();setFeeConsent(false);}},[isOpen]);
  const [loading, setLoading] = useState(false);
  const [consumableEffects,setConsumableEffects]=useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreparing, setImagePreparing] = useState(false);
  const uploadedImage = useRef(null);
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

  const enterprise=marketplacePolicy(sourceEnterprise,Boolean(formData.business_id));
  const listingFee=enterprise?.active_listing_fee_enabled?Number(enterprise.active_listing_fee_amount):0;
  useEffect(()=>{setFeeConsent(false);},[listingFee,enterprise?.active_listing_fee_period,formData.business_id]);

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
        promotion_expires_at: product.promotion_expires_at ? toBrasiliaInput(product.promotion_expires_at) : '',
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
    setConsumableEffects(product?.consumable_effects || product?.metadata?.consumable_effects || {});
    setImageFile(null);
    setImagePreparing(false);
  }, [product, isOpen]);

  useEffect(() => {
    if (!isOpen || !user?.id || phone) return;
    supabase.from('businesses').select('id,name,status').eq('owner_id', user.id).in('status', ['active', 'pending']).order('name')
      .then(({ data, error }) => {
        if (error) {
          toast({ title: 'Não foi possível carregar suas empresas', description: error.message, variant: 'destructive' });
          return;
        }
        setBusinesses(data || []);

      });
  }, [isOpen, toast, user?.id, Boolean(phone)]);

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSelectChange = (id, value) => {
    if (id === 'category') {
      if(value !== 'Bebidas')setConsumableEffects(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>['hunger','thirst'].includes(key))));
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
    if (loading || imagePreparing) return;
    setLoading(true);
    let uploadedPath = null;
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

      if (imageFile && uploadedImage.current?.file === imageFile) {
        finalImageUrl = uploadedImage.current.url;
        uploadedPath = uploadedImage.current.path;
      } else if (imageFile) {
        // Some Android/PWA file pickers incorrectly report valid images as
        // text/plain. Inspect their bytes and send a Blob with a trusted MIME
        // type, instead of forwarding the device-provided Content-Type.
        const imageContentType = await detectSupportedImageContentType(imageFile);
        if (!imageContentType) {
          throw new Error('A imagem selecionada não é válida. Escolha uma imagem JPEG, PNG, WebP, GIF ou AVIF.');
        }

        const imageBlob = imageFile.slice(0, imageFile.size, imageContentType);
        const newFileName = buildStoragePath({ prefix: '', entityId: user.id, fileName: imageFile.name });
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(newFileName, imageBlob, { upsert: false, contentType: imageContentType });

        if (uploadError) throw uploadError;

        finalImageUrl = supabase.storage.from('product-images').getPublicUrl(uploadData.path).data.publicUrl;

        uploadedPath = uploadData.path;
        uploadedImage.current = { file: imageFile, url: finalImageUrl, path: uploadedPath };
      }

      const { data: savedProduct, error } = await supabase.rpc('publish_business_product', {p_confirmed_fee:listingFee,p_period_days:enterprise.active_listing_fee_period,p_idempotency_key:requestKey.current,p_product:{
        p_product_id: product?.id || null,
        p_business_id: formData.business_id || null,
        p_name: formData.name,
        p_description: formData.description,
        p_price: normalizedPrice,
        p_image_url: finalImageUrl,
        p_product_type: formData.product_type,
        p_subscription_interval: formData.product_type === 'subscription' ? formData.subscription_interval : null,
        p_category: finalCategory,
        p_consumable_effects: ['Alimentos','Bebidas'].includes(finalCategory) && formData.product_type==='one-time' ? Object.fromEntries(Object.entries(consumableEffects).filter(([,value])=>Number(value)!==0).map(([key,value])=>[key,Number(value)])) : {},
        p_stock: formData.product_type === 'one-time' ? normalizedStock : null,
        p_promotion_price: showPromotion && normalizedPromotionPrice > 0 ? normalizedPromotionPrice : null,
        p_promotion_expires_at: showPromotion && normalizedPromotionPrice > 0 && formData.promotion_expires_at
          ? fromBrasiliaInput(formData.promotion_expires_at)
          : null,
      }});

      if (error) throw error;

      if (uploadedPath && oldFilePath && uploadedPath !== oldFilePath) await supabase.storage.from('product-images').remove([oldFilePath]);
      toast({ title: `Produto ${product ? 'atualizado' : 'criado'} com sucesso!`, description: savedProduct?.moderation_status === 'pending' ? 'O anúncio aguarda aprovação da gestão do marketplace.' : 'A alteração já está disponível.' });
      onSuccess();
    } catch (error) {
      const unreadable = error?.name === 'NotReadableError' || /requested file could not be read|permission problems.*file/i.test(error?.message || '');
      toast({
        title: 'Erro ao salvar produto',
        description: unreadable
          ? 'O Android não permitiu acessar essa imagem. Selecione novamente pela Galeria ou Arquivos e tente anunciar. Os dados preenchidos foram preservados.'
          : userErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      // A network failure can occur after the database commits. Keep the image and
      // reuse its URL on retry so the same idempotency key preserves the product.
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!loading) setIsOpen(open); }}>
      <DialogContent className="grid-cols-1 [&>*]:min-w-0 sm:max-w-lg max-h-[90vh] overflow-hidden p-0">
        <DialogHeader className="items-center px-6 pt-6 text-center sm:text-center">
          <DialogTitle>{product ? 'Editar Produto' : 'Adicionar Novo Produto'}</DialogTitle>
          <DialogDescription>Defina a oferta e confira os custos antes de publicar.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="max-h-[calc(90vh-5rem)] space-y-4 overflow-y-auto px-6 pb-6 pt-4 custom-scrollbar">
          <div className="space-y-2">
            <Label htmlFor="product-seller" className="inline-flex items-center gap-2"><User className="h-4 w-4"/>Vender como</Label>
            <Select value={formData.business_id || 'citizen'} onValueChange={(value) => handleSelectChange('business_id', value === 'citizen' ? '' : value)}>
              <SelectTrigger id="product-seller"><SelectValue placeholder="Pessoa Física" /></SelectTrigger>
              <SelectContent className="[&>div]:max-h-[192px]">
                <SelectItem value="citizen">Pessoa Física — {user?.full_name || 'Meu cidadão'}</SelectItem>
                {(!phone ? businesses : []).map((business) => <SelectItem key={business.id} value={business.id}>{business.name}{business.status === 'pending' ? ' (aguardando ativação)' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{formData.business_id ? 'A venda será vinculada à empresa selecionada.' : 'Venda em seu nome e receba na sua conta, sem precisar de CNPJ.'}</p>
          </div>
          <ImageUploader
            onUrlChange={(url) => setFormData(p => ({ ...p, image_url: url }))}
            onFileChange={setImageFile}
            cacheSelectedFile
            onPreparingChange={setImagePreparing}
            initialUrl={formData.image_url}
            label="Imagem do Produto (Obrigatório)" labelIcon={ImageIcon}
          />
          <div><Label htmlFor="name" className="inline-flex items-center gap-2"><Package className="h-4 w-4"/>Nome</Label><Input id="name" value={formData.name} onChange={handleChange} required /></div>
          <div>
            <Label htmlFor="price" className="inline-flex items-center gap-2"><Coins className="h-4 w-4"/>Preço</Label>
            <CurrencyInput
              id="price"
              value={formData.price}
              onChange={(e) => handleCurrencyChange(e, 'price')}
              placeholder="R$ 0,00"
              required
            />
          </div>
          <div><Label htmlFor="description" className="inline-flex items-center gap-2"><FileText className="h-4 w-4"/>Descrição</Label><Textarea id="description" value={formData.description} onChange={handleChange} required /></div>
          <div>
            <Label htmlFor="category" className="inline-flex items-center gap-2"><Tag className="h-4 w-4"/>Categoria</Label>
            <Select onValueChange={(value) => handleSelectChange('category', value)} value={formData.category}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="[&>div]:max-h-[192px]">
                {PREDEFINED_CATEGORIES.map(cat => {const Icon=categoryIcon(cat);return <SelectItem key={cat} value={cat}><span className="flex items-center gap-2"><Icon className="h-4 w-4" />{cat}</span></SelectItem>;})}
                <SelectItem value="custom">Outra (Personalizada)</SelectItem>
              </SelectContent>
          </Select>
          </div>
          {['Alimentos','Bebidas'].includes(formData.category) && formData.product_type==='one-time' && <fieldset className="space-y-3 rounded-xl border p-3"><legend>Efeitos ao consumir</legend>
            {formData.category==='Bebidas'&&<label className="flex items-center gap-2 text-sm"><Wine className="h-4 w-4"/><input type="checkbox" checked={Number(consumableEffects.health)<0} onChange={e=>setConsumableEffects(e.target.checked?{thirst:15,happiness:8,health:-3}:{thirst:40})}/>Bebida alcoólica</label>}
            {Number(consumableEffects.health)<0?<><NeedEffects effects={consumableEffects}/><p className="text-xs text-muted-foreground">Efeitos balanceados: recupera menos sede que a água, melhora a socialização e reduz levemente a saúde.</p></>:<><p className="text-xs text-muted-foreground">Defina de 0 a 60 pontos. Zero mantém o produto sem efeito nessa necessidade.</p>{NEEDS.filter(need=>['hunger','thirst'].includes(need.key)).map(({key,name,icon:Icon,text})=><label key={key} className={`block text-sm ${text}`}><span className="flex items-center gap-2"><Icon className="h-4 w-4"/>{name}</span><Input type="number" min="0" max="60" step="1" value={consumableEffects[key]||0} onChange={e=>setConsumableEffects(previous=>({...previous,[key]:e.target.value}))}/></label>)}</>}
          </fieldset>}

          {showCustomCategory && (
            <div><Label htmlFor="custom_category" className="inline-flex items-center gap-2"><Tag className="h-4 w-4"/>Nome da Categoria Personalizada</Label><Input id="custom_category" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} required /></div>
          )}
          <div>
            <Label htmlFor="product_type" className="inline-flex items-center gap-2"><Repeat className="h-4 w-4"/>Tipo</Label>
            <Select onValueChange={(value) => handleSelectChange('product_type', value)} value={formData.product_type}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="[&>div]:max-h-[192px]">
                <SelectItem value="one-time">Compra Única</SelectItem>
                <SelectItem value="subscription">Assinatura</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {formData.product_type === 'subscription' && (
            <div>
              <Label htmlFor="subscription_interval" className="inline-flex items-center gap-2"><Calendar className="h-4 w-4"/>Periodicidade</Label>
              <Select
                onValueChange={(value) => handleSelectChange('subscription_interval', value)}
                value={formData.subscription_interval}
              >
                <SelectTrigger id="subscription_interval"><SelectValue /></SelectTrigger>
                <SelectContent className="[&>div]:max-h-[192px]">
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
            <div><Label htmlFor="stock" className="inline-flex items-center gap-2"><Boxes className="h-4 w-4"/>Estoque</Label><Input id="stock" type="number" value={formData.stock} onChange={handleChange} required /></div>
          )}
          <div className="space-y-2 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="show-promotion" className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4"/>Promoção (Opcional)</Label>
              <Switch id="show-promotion" checked={showPromotion} onCheckedChange={setShowPromotion} />
            </div>
            {showPromotion && (
              <div className="space-y-4 pt-4">
                <div>
                  <Label htmlFor="promotion_price" className="inline-flex items-center gap-2"><Coins className="h-4 w-4"/>Preço Promocional</Label>
                  <CurrencyInput
                    id="promotion_price"
                    value={formData.promotion_price}
                    onChange={(e) => handleCurrencyChange(e, 'promotion_price')}
                    placeholder="R$ 0,00"
                  />
                </div>
                <div><Label htmlFor="promotion_expires_at" className="inline-flex items-center gap-2"><Calendar className="h-4 w-4"/>Fim da Promoção (Brasília)</Label><Input id="promotion_expires_at" type="datetime-local" value={formData.promotion_expires_at} onChange={handleChange} /></div>
              </div>
            )}
          </div>
          <div className="grid gap-3"><ListingCosts enterprise={sourceEnterprise} selected={!formData.business_id}/><ListingCosts enterprise={sourceEnterprise} business selected={Boolean(formData.business_id)}/></div>{!product&&listingFee>0&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={feeConsent} onChange={e=>setFeeConsent(e.target.checked)}/>Autorizo a cobrança da taxa de anúncio exibida, na conta selecionada para a venda.</label>}{product&&<p className="text-xs text-muted-foreground">Editar não renova nem cobra o anúncio. Use Renovar anúncio se o período terminou.</p>}
          <DialogFooter className="sm:justify-center">
            <Button type="submit" disabled={loading || imagePreparing || !enterprise || (!product&&listingFee>0&&!feeConsent) || !formData.image_url && !imageFile}>
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
