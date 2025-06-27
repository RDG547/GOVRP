
import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { loadStripe } from '@stripe/stripe-js';
import { Button } from '@/components/ui/button';
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { Heart, Loader2, CreditCard, Gift, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/layout/PageHeader';

const stripePromise = loadStripe('pk_live_51PefxOJ1feeiCKW7eG2lJ8O6fB3cWw1Wf0Yo8LKy6G1B9aJ62YJmMbrXFmJ70tq85dYgpb2tWb88sQg3t8qXwVsD00G3x5B1q7'); 

const donationOptions = [
    { amount: 10, label: 'Apoio Básico', priceId: 'price_1RePJdJ1feeiCKW77P1WWyWB' },
    { amount: 25, label: 'Contribuidor', priceId: 'price_1RePKIJ1feeiCKW70nkqNqee' },
    { amount: 50, label: 'Patrono', priceId: 'price_1RePKVJ1feeiCKW76ZLzhk92' },
    { amount: 100, label: 'Benfeitor', priceId: 'price_1RePKjJ1feeiCKW7cdCGORYx' },
];

const Donation = () => {
    const [selectedAmount, setSelectedAmount] = useState(25);
    const [customAmount, setCustomAmount] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const handleCheckout = async () => {
        setIsLoading(true);
        const stripe = await stripePromise;

        const isCustom = selectedAmount === 'custom';
        const finalAmount = isCustom ? parseCurrency(customAmount) : selectedAmount;

        if (finalAmount < 2) {
            toast({ title: "Valor Mínimo", description: "O valor mínimo para doação é de R$ 2,00.", variant: "destructive" });
            setIsLoading(false);
            return;
        }

        let lineItems;
        if (isCustom) {
            toast({
                title: "Doação Personalizada",
                description: "Doações com valor personalizado ainda não estão disponíveis. Por favor, selecione um dos valores pré-definidos.",
                variant: "destructive"
            });
            setIsLoading(false);
            return;
        } else {
            const selectedOption = donationOptions.find(opt => opt.amount === finalAmount);
            if (!selectedOption) {
                toast({ title: "Erro", description: "Opção de doação inválida.", variant: "destructive" });
                setIsLoading(false);
                return;
            }
            lineItems = [{ price: selectedOption.priceId, quantity: 1 }];
        }

        const { error } = await stripe.redirectToCheckout({
            lineItems,
            mode: 'payment',
            successUrl: `${window.location.origin}/donation?success=true`,
            cancelUrl: `${window.location.origin}/donation?canceled=true`,
        });

        if (error) {
            toast({ title: "Erro ao iniciar pagamento", description: error.message, variant: 'destructive' });
            setIsLoading(false);
        }
    };
    
    const finalAmount = selectedAmount === 'custom' ? parseCurrency(customAmount) : selectedAmount;

    return (
        <>
            <Helmet>
                <title>Faça uma Doação - GOV.RP</title>
                <meta name="description" content="Sua doação ajuda a manter o GOV.RP funcionando. Apoie o desenvolvimento e a comunidade." />
            </Helmet>
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
                <PageHeader
                    icon={Heart}
                    title="Faça parte da nossa"
                    gradientText="Missão"
                    description="Sua contribuição é o combustível que nos permite construir e manter este universo. Cada doação, não importa o tamanho, faz uma enorme diferença para nós."
                    iconColor="text-red-400"
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    <Card className="glass-effect">
                        <CardHeader>
                            <CardTitle>Selecione um valor</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                {donationOptions.map(option => (
                                    <Button key={option.amount} variant={selectedAmount === option.amount ? "default" : "outline"} onClick={() => { setSelectedAmount(option.amount); setCustomAmount(''); }} className="h-20 flex flex-col items-center justify-center">
                                        <span className="text-2xl font-bold">R$ {option.amount},00</span>
                                        <span className="text-xs">{option.label}</span>
                                    </Button>
                                ))}
                            </div>
                             <div>
                                <Button variant={selectedAmount === 'custom' ? 'default' : 'outline'} onClick={() => setSelectedAmount('custom')} className="w-full">
                                    Ou doe um valor personalizado
                                </Button>
                                {selectedAmount === 'custom' && (
                                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4">
                                        <Input
                                            type="text"
                                            placeholder="R$ 0,00"
                                            value={customAmount}
                                            onChange={(e) => setCustomAmount(formatCurrency(e.target.value))}
                                            className="text-center text-lg h-12"
                                        />
                                    </motion.div>
                                )}
                                <p className="text-xs text-center text-gray-400 mt-2">O valor mínimo para doação é de R$ 2,00.</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="glass-effect">
                        <CardHeader>
                            <CardTitle>Resumo da Doação</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="text-center">
                                <p className="text-gray-400">Você está doando:</p>
                                <p className="text-5xl font-bold gradient-text">{formatCurrency(finalAmount * 100)}</p>
                            </div>
                            <div>
                                <h4 className="font-semibold text-white mb-2 flex items-center gap-2"><Gift className="w-5 h-5 text-green-400"/> Seu apoio nos permite:</h4>
                                <ul className="list-disc list-inside text-gray-300 space-y-1 text-sm">
                                    <li>Manter os servidores online 24/7</li>
                                    <li>Desenvolver novos recursos</li>
                                    <li>Promover eventos na comunidade</li>
                                </ul>
                            </div>
                            <Button onClick={handleCheckout} disabled={isLoading || (finalAmount < 2)} size="lg" className="w-full bg-gradient-to-r from-green-500 to-emerald-600">
                                {isLoading ? <Loader2 className="animate-spin mr-2" /> : <CreditCard className="mr-2" />}
                                Apoiar com {formatCurrency(finalAmount * 100)}
                            </Button>
                            <div className="text-xs text-gray-400 flex items-center justify-center gap-2">
                                <Shield className="w-4 h-4 text-green-400"/>
                                <span>Pagamento seguro via Stripe.</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
};

export default Donation;
