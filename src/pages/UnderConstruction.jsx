import React from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { HardHat, Wrench } from 'lucide-react';

const UnderConstruction = () => {
  return (
    <>
      <Helmet>
        <title>Em Construção - GOV.RP</title>
        <meta name="description" content="Esta área do site está em construção. Volte em breve para ver as novidades!" />
      </Helmet>
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="relative w-32 h-32 mx-auto mb-8">
            <HardHat className="w-32 h-32 text-yellow-400" />
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
              className="absolute top-0 left-0"
            >
              <Wrench className="w-10 h-10 text-blue-400" />
            </motion.div>
          </div>
          <h1 className="text-5xl font-bold text-white mb-4">Em Construção</h1>
          <p className="text-xl text-gray-300 mb-8 max-w-md mx-auto">
            Nossos melhores engenheiros e arquitetos estão trabalhando duro nesta página. Volte em breve para conferir as novidades!
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

export default UnderConstruction;