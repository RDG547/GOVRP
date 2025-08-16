import React from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Frown, ShieldAlert } from 'lucide-react';

const ErrorPage = ({ errorCode = "404", errorTitle = "Página Não Encontrada", errorMessage = "Desculpe, a página que você tentou acessar não existe ou foi movida." }) => {
  const Icon = errorCode === "403" ? ShieldAlert : Frown;

  return (
    <>
      <Helmet>
        <title>{errorCode} {errorTitle} - GOV.RP</title>
        <meta name="description" content={errorMessage} />
      </Helmet>
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Icon className="w-24 h-24 mx-auto text-blue-500 mb-6" />
          <h1 className="text-8xl font-black text-white mb-2">{errorCode}</h1>
          <h2 className="text-4xl font-bold gradient-text mb-4">{errorTitle}</h2>
          <p className="text-xl text-gray-300 mb-8 max-w-md mx-auto">
            {errorMessage}
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