import React from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Frown } from 'lucide-react';

const ErrorPage = () => {
  return (
    <>
      <Helmet>
        <title>Página não encontrada - GOV.RP</title>
        <meta name="description" content="Oops! A página que você está procurando não foi encontrada." />
      </Helmet>
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Frown className="w-24 h-24 mx-auto text-blue-500 mb-6" />
          <h1 className="text-8xl font-black text-white mb-2">404</h1>
          <h2 className="text-4xl font-bold gradient-text mb-4">Página Não Encontrada</h2>
          <p className="text-xl text-gray-300 mb-8 max-w-md mx-auto">
            Desculpe, a página que você tentou acessar não existe ou foi movida.
          </p>
          <Link to="/">
            <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
              Voltar para a Página Inicial
            </Button>
          </Link>
        </motion.div>
      </div>
    </>
  );
};

export default ErrorPage;