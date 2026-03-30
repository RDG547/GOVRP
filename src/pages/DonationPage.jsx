import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import {
  CheckCircle,
  Copy,
  CreditCard,
  Gift,
  Heart,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const donationOptions = [
  { amount: 5, title: 'Apoio Inicial', description: 'Ajuda a manter custos básicos ativos.' },
  { amount: 10, title: 'Apoio Básico', description: 'Fortalece a manutenção diária da plataforma.' },
  { amount: 25, title: 'Contribuidor', description: 'Acelera ajustes, melhorias e estabilidade.' },
  { amount: 50, title: 'Patrono', description: 'Impulsiona novas entregas e expansão.' },
  { amount: 100, title: 'Benfeitor', description: 'Sustenta ciclos maiores de evolução do projeto.' },
];

const impactItems = [
  {
    icon: ShieldCheck,
    title: 'Infraestrutura',
    description: 'Serviços essenciais, disponibilidade e operação contínua.',
    color: 'text-emerald-400',
  },
  {
    icon: Sparkles,
    title: 'Evolução',
    description: 'Novos recursos, refinamentos visuais e mais qualidade.',
    color: 'text-blue-400',
  },
  {
    icon: Wallet,
    title: 'Comunidade',
    description: 'Suporte, eventos e melhorias para a experiência coletiva.',
    color: 'text-pink-400',
  },
];

const paymentMethods = [
  {
    id: 'card',
    icon: CreditCard,
    title: 'Cartão',
    description: 'Pagamento com redirecionamento para um checkout seguro.',
  },
  {
    id: 'pix',
    icon: QrCode,
    title: 'PIX',
    description: 'QR Code instantâneo com código copia-e-cola e status em tempo real.',
  },
];

const MIN_DONATION_AMOUNT = 5;

const PIX_STATUS_LABELS = {
  PENDING: 'Aguardando pagamento',
  PAID: 'Pagamento confirmado',
  EXPIRED: 'Código expirado',
  CANCELLED: 'Pagamento cancelado',
  REFUNDED: 'Pagamento estornado',
};

const formatCurrency = (value) => {
  if (value === null || Number.isNaN(value)) return '0,00';

  return new Intl.NumberFormat('pt-BR', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const sanitizeCurrencyInput = (value) => {
  const cleanValue = value.replace(/\./g, ',').replace(/[^0-9,]/g, '');
  const [integerPart = '', decimalPart = ''] = cleanValue.split(',');
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '') || integerPart;

  if (!cleanValue.includes(',')) {
    return normalizedInteger;
  }

  return `${normalizedInteger},${decimalPart.slice(0, 2)}`;
};

const parseCurrencyInput = (value) => {
  if (!value) return null;

  const parsed = Number.parseFloat(value.replace(',', '.'));

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
};

const getPixStatusStyles = (status) => {
  switch (status) {
    case 'PAID':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'EXPIRED':
    case 'CANCELLED':
      return 'border-red-500/30 bg-red-500/10 text-red-200';
    case 'REFUNDED':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    default:
      return 'border-blue-500/30 bg-blue-500/10 text-blue-200';
  }
};

const isFinishedPixStatus = (status) => ['PAID', 'EXPIRED', 'CANCELLED', 'REFUNDED'].includes(status);

const fetchPixStatus = async (chargeId) => {
  const response = await fetch(`/api/donations/pix-status?id=${encodeURIComponent(chargeId)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível consultar o status do PIX.');
  }

  return payload.status;
};

const DonationPage = () => {
  const { toast } = useToast();
  const { session, user } = useAuth();
  const [selectedAmount, setSelectedAmount] = useState(10);
  const [customAmount, setCustomAmount] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [cardLoading, setCardLoading] = useState(false);
  const [pixLoading, setPixLoading] = useState(false);
  const [pixStatusLoading, setPixStatusLoading] = useState(false);
  const [pixCharge, setPixCharge] = useState(null);

  const resetPixState = () => {
    setPixCharge(null);
    setPixLoading(false);
    setPixStatusLoading(false);
  };

  const ensureAuthenticated = () => {
    if (!session) {
      toast({
        title: 'Acesso Negado',
        description: 'Você precisa estar logado para fazer uma doação.',
        variant: 'destructive',
      });
      return false;
    }

    return true;
  };

  const ensureValidAmount = () => {
    if (!selectedAmount || selectedAmount < MIN_DONATION_AMOUNT) {
      toast({
        title: 'Valor Inválido',
        description: 'O valor mínimo para doação é de R$ 5,00.',
        variant: 'destructive',
      });
      return false;
    }

    return true;
  };

  const handleSelectAmount = (amount) => {
    setSelectedAmount(amount);
    setCustomAmount('');
    setIsCustom(false);
    resetPixState();
  };

  const handleCustomAmountChange = (event) => {
    const value = sanitizeCurrencyInput(event.target.value);
    const parsedValue = parseCurrencyInput(value);

    setCustomAmount(value);
    setIsCustom(true);
    resetPixState();

    if (parsedValue >= MIN_DONATION_AMOUNT) {
      setSelectedAmount(parsedValue);
      return;
    }

    setSelectedAmount(null);
  };

  const handleStripeCheckout = async () => {
    if (!ensureAuthenticated() || !ensureValidAmount()) {
      return;
    }

    setCardLoading(true);

    try {
      const response = await fetch('/api/donations/stripe-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: selectedAmount,
          userEmail: user?.email,
          userId: user?.id,
          successUrl: `${window.location.origin}/support-us?donation=success`,
          cancelUrl: `${window.location.origin}/donation`,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Não foi possível iniciar o pagamento com cartão.');
      }

      if (!payload.checkoutUrl) {
        throw new Error('A URL do checkout não foi recebida.');
      }

      window.location.assign(payload.checkoutUrl);
    } catch (error) {
      console.error('Erro no checkout:', error);
      toast({
        title: 'Erro ao iniciar pagamento',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setCardLoading(false);
    }
  };

  const handleCreatePixCharge = async () => {
    if (!ensureAuthenticated() || !ensureValidAmount()) {
      return;
    }

    setPixLoading(true);

    try {
      const response = await fetch('/api/donations/pix-charge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: selectedAmount,
          userEmail: user?.email,
          userId: user?.id,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Não foi possível gerar o código PIX agora.');
      }

      setPixCharge(payload.charge);

      toast({
        title: 'Código PIX gerado',
        description: 'Use o QR code ou copie o código para concluir a doação.',
      });
    } catch (error) {
      console.error('Erro ao gerar PIX:', error);
      toast({
        title: 'Erro ao gerar PIX',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setPixLoading(false);
    }
  };

  const handleRefreshPixStatus = async (silent = false) => {
    if (!pixCharge?.id) {
      return;
    }

    if (!silent) {
      setPixStatusLoading(true);
    }

    try {
      const status = await fetchPixStatus(pixCharge.id);

      setPixCharge((currentCharge) => {
        if (!currentCharge) {
          return currentCharge;
        }

        return {
          ...currentCharge,
          ...status,
        };
      });

      if (!silent && status?.status === 'PAID') {
        toast({
          title: 'Pagamento confirmado',
          description: 'Recebemos a sua doação. Obrigado pelo apoio.',
        });
      }
    } catch (error) {
      console.error('Erro ao consultar status do PIX:', error);

      if (!silent) {
        toast({
          title: 'Erro ao consultar PIX',
          description: error.message,
          variant: 'destructive',
        });
      }
    } finally {
      if (!silent) {
        setPixStatusLoading(false);
      }
    }
  };

  const handleCopyPixCode = async () => {
    if (!pixCharge?.brCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pixCharge.brCode);
      toast({
        title: 'Código copiado',
        description: 'Agora é só colar no app do seu banco.',
      });
    } catch {
      toast({
        title: 'Não foi possível copiar',
        description: 'Copie o código manualmente abaixo.',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (!pixCharge?.id || isFinishedPixStatus(pixCharge.status)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      fetchPixStatus(pixCharge.id)
        .then((status) => {
          setPixCharge((currentCharge) => {
            if (!currentCharge) {
              return currentCharge;
            }

            return {
              ...currentCharge,
              ...status,
            };
          });
        })
        .catch((error) => {
          console.error('Erro ao atualizar PIX em segundo plano:', error);
        });
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pixCharge?.id, pixCharge?.status]);

  return (
    <>
      <Helmet>
        <title>Doação - GOV.RP</title>
        <meta name="description" content="Sua contribuição é o combustível que nos permite construir e manter este universo. Faça parte da nossa missão!" />
      </Helmet>

      <div className="overflow-x-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <PageHeader
            icon={Heart}
            title="Faça parte da nossa"
            gradientText="Missão"
            description="Sua contribuição é o combustível que nos permite construir e manter este universo. Cada doação, não importa o tamanho, faz uma enorme diferença para nós."
            iconColor="text-pink-500"
            centered={true}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            <div className="lg:col-span-2 space-y-8">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
              >
                <Card className="glass-effect border-white/10 overflow-hidden">
                  <CardHeader>
                    <CardTitle>Escolha como quer apoiar</CardTitle>
                    <CardDescription>
                      Selecione um valor sugerido ou defina uma contribuição personalizada a partir de R$ 5,00.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {donationOptions.map((option, index) => (
                        <motion.button
                          key={option.amount}
                          onClick={() => handleSelectAmount(option.amount)}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.12 + index * 0.05 }}
                          className={cn(
                            'group rounded-2xl border p-5 text-left transition-all duration-300 bg-black/20',
                            !isCustom && selectedAmount === option.amount
                              ? 'border-primary bg-primary/10 shadow-[0_0_30px_-12px_rgba(59,130,246,0.55)]'
                              : 'border-white/10 hover:border-primary/40 hover:bg-white/5'
                          )}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-lg font-semibold text-white">{option.title}</p>
                              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{option.description}</p>
                            </div>
                            <div className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white">
                              R$ {formatCurrency(option.amount)}
                            </div>
                          </div>
                        </motion.button>
                      ))}
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-white">Valor personalizado</h3>
                          <p className="text-sm text-muted-foreground">
                            Defina o valor exato da sua contribuição.
                          </p>
                        </div>
                        <div className="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-muted-foreground">
                          Mínimo de R$ 5,00
                        </div>
                      </div>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span>
                        <Input
                          type="text"
                          placeholder="5,00"
                          value={customAmount}
                          onChange={handleCustomAmountChange}
                          className={cn(
                            'h-14 rounded-xl border-white/10 bg-background/60 pl-12 text-xl',
                            isCustom ? 'border-primary' : ''
                          )}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.18 }}
              >
                <Card className="glass-effect border-white/10">
                  <CardHeader>
                    <CardTitle>Forma de pagamento</CardTitle>
                    <CardDescription>
                      Escolha a experiência que faz mais sentido para você.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {paymentMethods.map((method) => (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(method.id);
                          if (method.id !== 'pix') {
                            resetPixState();
                          }
                        }}
                        className={cn(
                          'rounded-2xl border p-5 text-left transition-all duration-300 bg-black/20',
                          paymentMethod === method.id
                            ? 'border-primary bg-primary/10 shadow-[0_0_30px_-12px_rgba(59,130,246,0.55)]'
                            : 'border-white/10 hover:border-primary/30 hover:bg-white/5'
                        )}
                      >
                        <div className="flex items-start gap-4">
                          <div className="rounded-xl bg-white/10 p-3">
                            <method.icon className="h-6 w-6 text-white" />
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-white">{method.title}</h3>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{method.description}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.26 }}
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {impactItems.map((item, index) => (
                    <Card key={item.title} className="glass-effect border-white/10 h-full">
                      <CardContent className="p-6">
                        <div className="inline-flex rounded-2xl bg-white/10 p-3 mb-4">
                          <item.icon className={cn('h-6 w-6', item.color)} />
                        </div>
                        <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                        <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.22 }}
            >
              <Card className="glass-effect border-white/10 sticky top-28 overflow-hidden">
                <CardHeader className="pb-4">
                  <CardTitle>Resumo da Doação</CardTitle>
                  <CardDescription>
                    Revise os detalhes antes de continuar.
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                    <p className="text-sm text-muted-foreground mb-2">Valor selecionado</p>
                    <div className="flex items-end justify-between gap-3">
                      <span className="text-3xl font-bold text-white">R$ {formatCurrency(selectedAmount)}</span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {isCustom ? 'personalizado' : 'sugerido'}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                    <p className="text-sm text-muted-foreground mb-3">Método escolhido</p>
                    <div className="flex items-center gap-3">
                      {paymentMethod === 'card' ? (
                        <CreditCard className="h-5 w-5 text-blue-400" />
                      ) : (
                        <QrCode className="h-5 w-5 text-emerald-400" />
                      )}
                      <span className="font-semibold text-white">
                        {paymentMethod === 'card' ? 'Pagamento com cartão' : 'Pagamento por PIX'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                      Seu apoio ajuda a:
                    </h3>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 text-sm text-muted-foreground">
                        <CheckCircle className="h-4 w-4 mt-0.5 text-emerald-400" />
                        <span>Manter a plataforma disponível e estável.</span>
                      </div>
                      <div className="flex items-start gap-3 text-sm text-muted-foreground">
                        <CheckCircle className="h-4 w-4 mt-0.5 text-emerald-400" />
                        <span>Continuar lançando melhorias com mais consistência.</span>
                      </div>
                      <div className="flex items-start gap-3 text-sm text-muted-foreground">
                        <CheckCircle className="h-4 w-4 mt-0.5 text-emerald-400" />
                        <span>Fortalecer a experiência da comunidade no longo prazo.</span>
                      </div>
                    </div>
                  </div>

                  {paymentMethod === 'pix' && pixCharge && (
                    <>
                      <Separator />
                      <div className="space-y-4">
                        <div className={cn('rounded-xl border px-3 py-2 text-xs font-semibold', getPixStatusStyles(pixCharge.status))}>
                          {PIX_STATUS_LABELS[pixCharge.status] || pixCharge.status}
                        </div>

                        <div className="rounded-2xl bg-white p-4 shadow-2xl">
                          {pixCharge.brCodeBase64 ? (
                            <img
                              src={pixCharge.brCodeBase64}
                              alt="QR Code PIX para doação"
                              className="w-full rounded-xl"
                            />
                          ) : (
                            <QRCodeSVG
                              value={pixCharge.brCode}
                              size={220}
                              className="h-auto w-full"
                              includeMargin={true}
                            />
                          )}
                        </div>

                        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                            Código copia-e-cola
                          </p>
                          <p className="break-all text-xs leading-relaxed text-white">{pixCharge.brCode}</p>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          Expira em:{' '}
                          {pixCharge.expiresAt ? new Date(pixCharge.expiresAt).toLocaleString('pt-BR') : 'não informado'}
                        </p>
                      </div>
                    </>
                  )}
                </CardContent>

                <CardFooter className="flex-col gap-3">
                  {paymentMethod === 'card' ? (
                    <>
                      <Button
                        className="w-full h-12 text-base bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                        onClick={handleStripeCheckout}
                        disabled={cardLoading || !selectedAmount || selectedAmount < MIN_DONATION_AMOUNT}
                      >
                        {cardLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
                        Continuar com cartão
                      </Button>
                      <p className="text-center text-xs text-muted-foreground">
                        Você será redirecionado para concluir o pagamento em ambiente seguro.
                      </p>
                    </>
                  ) : (
                    <>
                      <Button
                        className="w-full h-12 text-base bg-emerald-600 hover:bg-emerald-700"
                        onClick={handleCreatePixCharge}
                        disabled={pixLoading || !selectedAmount || selectedAmount < MIN_DONATION_AMOUNT}
                      >
                        {pixLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
                        Gerar código PIX
                      </Button>

                      {pixCharge && (
                        <>
                          <Button variant="outline" className="w-full" onClick={handleCopyPixCode} disabled={!pixCharge.brCode}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copiar código
                          </Button>
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => handleRefreshPixStatus(false)}
                            disabled={pixStatusLoading}
                          >
                            {pixStatusLoading ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            Atualizar status
                          </Button>
                        </>
                      )}

                      <p className="text-center text-xs text-muted-foreground">
                        O código é gerado na hora e pode ser pago pelo app do seu banco.
                      </p>
                    </>
                  )}
                </CardFooter>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>
    </>
  );
};

export default DonationPage;
