import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Heart, DollarSign, Gift, Loader2 } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/layout/PageHeader';
import { supabase } from '@/lib/supabaseClient';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

const Donation = () => {
    const { toast } = useToast();
    const { user, session } = useAuth();
    const [selectedAmount, setSelectedAmount] = useState(null);
    const [loadingPriceId, setLoadingPriceId] = useState(null);

    const donationOptions = [
        { amount: 10, priceId: 'price_1PQUe9RqXpSijY2pWq8uD4oB' },
        { amount: 25, priceId: 'price_1PQUeVRqXpSijY2p5jI4x7pU' },
        { amount: 50, priceId: 'price_1PQUehRqXpSijY2pguH5Lg23' },
        { amount: 100, priceId: 'price_1PQUfARqXpSijY2p7E9H9h4L' },
    ];

    const handleDonation = async (priceId, amount) => {
        if (!session) {
            toast({
                title: "Acesso Negado",
                description: "Você precisa estar logado para fazer uma doação.",
                variant: "destructive"
            });
            return;
        }

        setLoadingPriceId(priceId);
        try {
            const stripe = await stripePromise;
            const { data: { session: checkoutSession }, error: sessionError } = await supabase.functions.invoke('stripe-checkout', {
                body: {
                    priceId: priceId,
                    successUrl: `${window.location.origin}/support-us?donation=success`,
                    cancelUrl: `${window.location.origin}/donation`,
                    customerEmail: user.email,
                    userId: user.id,
                    donationAmount: amount
                }
            });

            if (sessionError) throw sessionError;

            const { error: stripeError } = await stripe.redirectToCheckout({ sessionId: checkoutSession.id });

            if (stripeError) {
                console.error("Stripe Redirect Error:", stripeError);
                toast({ title: "Erro na Doação", description: stripeError.message, variant: "destructive" });
            }
        } catch (error) {
            console.error("Donation Error:", error);
            toast({ title: "Erro", description: "Ocorreu um erro ao processar sua doação.", variant: "destructive" });
        } finally {
            setLoadingPriceId(null);
        }
    };
    
    return (
        <>
            <Helmet>
                <title>Doação - GOV.RP</title>
                <meta name="description" content="Apoie o desenvolvimento e a manutenção do GOV.RP com uma doação." />
            </Helmet>

            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                 <PageHeader
                    icon={Heart}
                    title="Faça sua"
                    gradientText="Doação"
                    description="Sua contribuição é fundamental para mantermos a plataforma no ar, sempre evoluindo e oferecendo a melhor experiência para todos."
                    iconColor="text-pink-500"
                />

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <Card className="glass-effect">
                        <CardHeader>
                            <CardTitle className="text-2xl text-center">Escolha um valor para apoiar</CardTitle>
                            <CardDescription className="text-center">
                                Cada contribuição faz a diferença.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                                {donationOptions.map(({amount, priceId}) => (
                                    <Button
                                        key={amount}
                                        variant={selectedAmount === amount ? "default" : "outline"}
                                        className={`py-8 text-2xl font-bold transition-all duration-300 ${selectedAmount === amount ? 'bg-gradient-to-r from-pink-500 to-purple-600 scale-105' : ''}`}
                                        onClick={() => setSelectedAmount(amount)}
                                    >
                                        R$ {amount}
                                    </Button>
                                ))}
                            </div>

                            {selectedAmount && (
                                <div className="text-center">
                                    <Button
                                        size="lg"
                                        className="text-lg font-bold bg-green-600 hover:bg-green-700"
                                        onClick={() => {
                                            const option = donationOptions.find(opt => opt.amount === selectedAmount);
                                            handleDonation(option.priceId, option.amount);
                                        }}
                                        disabled={loadingPriceId === donationOptions.find(opt => opt.amount === selectedAmount)?.priceId}
                                    >
                                        {loadingPriceId === donationOptions.find(opt => opt.amount === selectedAmount)?.priceId ? (
                                            <Loader2 className="animate-spin mr-2" />
                                        ) : (
                                            <Gift className="mr-2" />
                                        )}
                                        Apoiar com R$ {selectedAmount.toFixed(2)}
                                    </Button>
                                </div>
                            )}

                        </CardContent>
                    </Card>

                    <div className="mt-12 text-center text-gray-400">
                        <p className="flex items-center justify-center gap-2">
                           <DollarSign className="w-5 h-5 text-green-500" />
                           Todas as transações são seguras e processadas pelo Stripe.
                        </p>
                        <p className="mt-2 text-sm">
                            Ao doar, você concorda com nossos <a href="/terms" className="underline hover:text-white">Termos de Serviço</a>. As doações não são reembolsáveis.
                        </p>
                    </div>

                </motion.div>
            </div>
        </>
    );
};

export default Donation;