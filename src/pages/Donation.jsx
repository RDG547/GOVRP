
import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Heart, CreditCard, Barcode, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from "@/components/ui/use-toast";
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'YOUR_STRIPE_PUBLISHABLE_KEY');

const Donation = () => {
    const { toast } = useToast();

    const donationOptions = [
        { amount: 10, label: "Apoio Básico", description: "Ajuda a manter nossos servidores ativos.", priceId: "YOUR_PRICE_ID_10" },
        { amount: 25, label: "Contribuidor", description: "Contribui para novos recursos e melhorias.", priceId: "YOUR_PRICE_ID_25" },
        { amount: 50, label: "Patrono", description: "Um grande impulso para o futuro do GOV.RP.", priceId: "YOUR_PRICE_ID_50" }
    ];

    const handleDonate = async (priceId) => {
        if (!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || priceId.startsWith('YOUR_')) {
             toast({
                title: "🚧 Pagamento não configurado",
                description: "O sistema de doação ainda não foi configurado pelo administrador. Volte mais tarde!",
                variant: "destructive"
            });
            return;
        }

        const stripe = await stripePromise;
        const { error } = await stripe.redirectToCheckout({
            lineItems: [{ price: priceId, quantity: 1 }],
            mode: 'payment',
            successUrl: `${window.location.origin}/donation?success=true`,
            cancelUrl: `${window.location.origin}/donation?canceled=true`,
        });

        if (error) {
            console.error("Stripe Checkout error:", error);
            toast({
                title: "Erro na doação",
                description: "Houve um problema ao processar sua doação. Tente novamente.",
                variant: "destructive"
            });
        }
    };

  return (
    <>
      <Helmet>
        <title>Doação - GOV.RP</title>
        <meta name="description" content="Apoie o desenvolvimento e a manutenção do GOV.RP. Sua doação é fundamental para mantermos a plataforma gratuita e em constante evolução." />
      </Helmet>

      <div className="min-h-screen py-20">
        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">
              Faça uma <span className="gradient-text">Doação</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
              O GOV.RP é um projeto mantido pela comunidade. Sua contribuição é vital para manter a plataforma funcionando, gratuita e em constante evolução.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {donationOptions.map((option, index) => (
              <motion.div
                key={option.amount}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + index * 0.1 }}
                className="glass-effect rounded-2xl p-8 flex flex-col text-center"
              >
                <h3 className="text-2xl font-bold text-white mb-2">{option.label}</h3>
                <p className="text-gray-300 mb-6 flex-grow">{option.description}</p>
                <p className="text-4xl font-bold gradient-text mb-6">R$ {option.amount}</p>
                <Button onClick={() => handleDonate(option.priceId)} size="lg" className="w-full">
                  Doar Agora <Heart className="w-5 h-5 ml-2" />
                </Button>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="glass-effect rounded-2xl p-8"
          >
            <h2 className="text-3xl font-bold text-white mb-6 text-center">Métodos de Pagamento Seguros</h2>
            <div className="flex flex-col md:flex-row justify-center items-center gap-8 text-gray-300">
                <div className="flex items-center gap-3">
                    <img src="https://logopng.com.br/logos/pix-106.png" alt="Pix" className="h-6 filter grayscale brightness-200" />
                    <span className="text-lg">Pix</span>
                </div>
                 <div className="flex items-center gap-3">
                    <CreditCard className="w-8 h-8"/>
                    <span className="text-lg">Cartão de Crédito</span>
                </div>
                 <div className="flex items-center gap-3">
                    <Barcode className="w-8 h-8"/>
                    <span className="text-lg">Boleto Bancário</span>
                </div>
            </div>
            <p className="text-center text-sm text-gray-500 mt-6">Todos os pagamentos são processados de forma segura pelo Stripe.</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="text-center mt-16"
          >
            <p className="text-gray-300">Prefere apoiar de outras formas?</p>
            <Link to="/support-us">
              <Button variant="link" className="text-blue-400 text-lg">
                Veja outras formas de ajudar <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
          </motion.div>
        </section>
      </div>
    </>
  );
};

export default Donation;
