
import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { LogIn, UserPlus, ShieldAlert } from 'lucide-react';

const AuthWall = ({ serviceName }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4 py-12"
    >
      <div className="max-w-md w-full glass-effect rounded-2xl p-8 shadow-2xl">
        <ShieldAlert className="mx-auto h-16 w-16 text-yellow-400 mb-6" />
        <h1 className="text-3xl font-bold gradient-text mb-4">Acesso Restrito</h1>
        <p className="text-gray-300 mb-8">
          Para acessar {serviceName || 'este serviço'}, você precisa ser um cidadão registrado e autenticado na plataforma.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/login" className="w-full sm:w-auto">
            <Button size="lg" className="w-full bg-gradient-to-r from-blue-600 to-purple-600">
              <LogIn className="mr-2 h-5 w-5" /> Entrar
            </Button>
          </Link>
          <Link to="/register" className="w-full sm:w-auto">
            <Button size="lg" variant="outline" className="w-full border-white/20 hover:bg-white/10">
              <UserPlus className="mr-2 h-5 w-5" /> Cadastrar-se
            </Button>
          </Link>
        </div>
      </div>
    </motion.div>
  );
};

export default AuthWall;
