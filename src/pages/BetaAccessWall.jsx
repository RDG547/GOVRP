import React from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Hourglass, ShieldAlert } from 'lucide-react';

const BetaAccessWall = () => {
  return (
    <>
      <Helmet>
        <title>Acesso Restrito - GOV.RP</title>
        <meta name="description" content="Página de acesso restrito para usuários em fase de avaliação." />
      </Helmet>
      <div className="min-h-screen flex items-center justify-center text-center px-4 bg-gradient-to-br from-gray-900 via-slate-900 to-blue-900/50">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-2xl p-8 rounded-2xl glass-effect"
        >
          <Hourglass className="w-24 h-24 mx-auto text-amber-400 mb-6" />
          <h1 className="text-4xl font-bold gradient-text mb-4">Acesso em Breve!</h1>
          <p className="text-xl text-gray-300 mb-4">
            Você ainda não é um Cidadão oficial do GOV.RP e, por isso, seu acesso aos serviços está temporariamente limitado.
          </p>
          <p className="text-lg text-gray-400 mb-8">
            Nossa nação está em fase de construção (BETA) e estamos liberando o acesso gradualmente para garantir a melhor experiência. Não se preocupe, em breve novos cidadãos serão bem-vindos!
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/">
              <Button size="lg" className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                Voltar para a Página Inicial
              </Button>
            </Link>
            <Link to="/community">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                Junte-se à Comunidade
              </Button>
            </Link>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default BetaAccessWall;