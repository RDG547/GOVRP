import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Heart, CheckCircle, Gift, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '@/lib/supabaseClient';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

const donationOptions = [
    { amount: 10.00, title: 'Apoio Básico', priceId: 'price_1RePJdJ1feeiCKW77P1WWyWB' },
    { amount: 25.00, title: 'Contribuidor', priceId: 'price_1RePKIJ1feeiCKW70nkqNqee' },
    { amount: 50.00, title: 'Patrono', priceId: 'price_1RePKjJ1feeiCKW7cdCGORYx' },
    { amount: 100.00, title: 'Benfeitor', priceId: 'price_1RePKVJ1feeiCKW76ZLzhk92' },
];

const DonationPage = () => {
    const { toast } = useToast();
    const { session, user } = useAuth();
    const [selectedAmount, setSelectedAmount] = useState(10.00);
    const [customAmount, setCustomAmount] = useState('');
    const [isCustom, setIsCustom] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSelectAmount = (amount) => {
        setSelectedAmount(amount);
        setCustomAmount('');
        setIsCustom(false);
    };

    const handleCustomAmountChange = (e) => {
        const value = e.target.value.replace(/[^0-9,.]/g, '').replace(',', '.');
        setCustomAmount(value);
        if (parseFloat(value) >= 2) {
            setSelectedAmount(parseFloat(value));
            setIsCustom(true);
        } else {
            setIsCustom(true);
            setSelectedAmount(null);
        }
    };
    
    const handleStripeCheckout = async () => {
        if (!session) {
            toast({
                title: "Acesso Negado",
                description: "Você precisa estar logado para fazer uma doação.",
                variant: "destructive"
            });
            return;
        }

        if (!selectedAmount || selectedAmount < 2) {
            toast({
                title: "Valor Inválido",
                description: "O valor mínimo para doação é de R$ 2,00.",
                variant: "destructive"
            });
            return;
        }
        
        setLoading(true);

        try {
            const priceOption = donationOptions.find(opt => opt.amount === selectedAmount);
            const priceId = priceOption ? priceOption.priceId : null;

            const { data, error: functionError } = await supabase.functions.invoke('create-checkout-session', {
                body: { 
                    amount: isCustom ? selectedAmount : undefined,
                    priceId: priceId,
                    productName: `Doação para GOV.RP`,
                    userEmail: user.email,
                    userId: user.id,
                    successUrl: `${window.location.origin}/support-us?donation=success`,
                    cancelUrl: `${window.location.origin}/donation`,
                }
            });

            if (functionError) {
                const errorBody = await functionError.context.json();
                throw new Error(errorBody.error || functionError.message);
            }
            
            const { sessionId } = data;
            if (!sessionId) throw new Error('ID da sessão não foi recebido da Supabase Function.');

            const stripe = await stripePromise;
            const { error } = await stripe.redirectToCheckout({ sessionId });

            if (error) {
                toast({
                    title: "Erro ao redirecionar",
                    description: error.message,
                    variant: "destructive"
                });
            }
        } catch (error) {
            console.error("Erro no checkout:", error);
            toast({
                title: "Erro Inesperado",
                description: `Não foi possível iniciar o pagamento. Detalhes: ${error.message}`,
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (value) => {
        if (value === null || isNaN(value)) return "0,00";
        return new Intl.NumberFormat('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    };

    return (
        <>
            <Helmet>
                <title>Doação - GOV.RP</title>
                <meta name="description" content="Sua contribuição é o combustível que nos permite construir e manter este universo. Faça parte da nossa missão!" />
            </Helmet>

            <div className="container max-w-5xl mx-auto px-4 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="text-center mb-12"
                >
                    <Heart className="mx-auto h-12 w-12 text-pink-500 mb-4" />
                    <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground">
                        Faça parte da nossa <span className="gradient-text">Missão</span>
                    </h1>
                    <p className="mt-4 max-w-2xl mx-auto text-lg text-muted-foreground">
                        Sua contribuição é o combustível que nos permite construir e manter este universo. Cada doação, não importa o tamanho, faz uma enorme diferença para nós.
                    </p>
                </motion.div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="md:col-span-2 space-y-8">
                        <Card className="glass-effect">
                            <CardHeader>
                                <CardTitle>Selecione um valor</CardTitle>
                            </CardHeader>
                            <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                {donationOptions.map((option) => (
                                    <motion.button
                                        key={option.amount}
                                        onClick={() => handleSelectAmount(option.amount)}
                                        className={cn(
                                            "p-4 rounded-lg border-2 text-left transition-all duration-200 flex flex-col justify-between h-32",
                                            !isCustom && selectedAmount === option.amount 
                                                ? 'border-primary bg-primary/10' 
                                                : 'border-border hover:border-primary/50'
                                        )}
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                    >
                                        <p className="font-semibold text-muted-foreground">{option.title}</p>
                                        <p className="text-2xl font-bold text-foreground">R$ {formatCurrency(option.amount)}</p>
                                    </motion.button>
                                ))}
                            </CardContent>
                        </Card>
                        
                        <Card className="glass-effect">
                            <CardHeader>
                                <CardTitle>Ou doe um valor personalizado</CardTitle>
                                <CardDescription>O valor mínimo para doação é de R$ 2,00.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                 <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span>
                                    <Input 
                                        type="text"
                                        placeholder="2,00"
                                        value={customAmount}
                                        onChange={handleCustomAmountChange}
                                        className={cn(
                                            "pl-10 text-xl h-14",
                                            isCustom ? "border-primary" : ""
                                        )}
                                    />
                                 </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="md:col-span-1">
                        <Card className="glass-effect sticky top-28">
                            <CardHeader>
                                <CardTitle>Resumo da Doação</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex justify-between items-center text-lg">
                                    <span className="text-muted-foreground">Você está doando:</span>
                                    <span className="font-bold text-2xl text-primary">R$ {formatCurrency(selectedAmount)}</span>
                                </div>
                                <Separator />
                                <div>
                                    <h4 className="font-semibold mb-2">Seu apoio nos permite:</h4>
                                    <ul className="space-y-2 text-sm text-muted-foreground">
                                        <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" /> Manter os servidores online 24/7</li>
                                        <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" /> Desenvolver novos recursos</li>
                                        <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" /> Promover eventos na comunidade</li>
                                    </ul>
                                </div>
                            </CardContent>
                            <CardFooter className="flex-col">
                                <Button 
                                    className="w-full text-lg h-12"
                                    onClick={handleStripeCheckout}
                                    disabled={loading || !selectedAmount || selectedAmount < 2}
                                >
                                    {loading ? <Loader2 className="animate-spin mr-2"/> : <Gift className="mr-2" />}
                                    Apoiar com R$ {formatCurrency(selectedAmount)}
                                </Button>
                                <p className="text-xs text-muted-foreground mt-2">Pagamento seguro via Stripe.</p>
                            </CardFooter>
                        </Card>
                    </div>
                </div>
            </div>
        </>
    );
};

export default DonationPage;