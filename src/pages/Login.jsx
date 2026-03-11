import React, { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Eye, EyeOff, Lock, User, Loader2, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabaseClient';
import { FaGoogle, FaFacebook, FaDiscord } from 'react-icons/fa';


const Login = () => {
  const [formData, setFormData] = useState({ identifier: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    setLoading(true);
    try {
      const { user } = await login({ identifier: formData.identifier, password: formData.password });
      toast({
        title: "Login realizado com sucesso!",
        description: `Bem-vindo de volta, ${user.full_name || user.username}!`,
      });
      if (user.role === 'Admin') {
        navigate('/admin-dashboard');
      } else {
        navigate('/');
      }
    } catch (error) {
      toast({
        title: "Erro no Login",
        description: error.message || "Credenciais inválidas. Por favor, verifique seu identificador e senha.",
        variant: "destructive",
      });
      
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/`
      }
    });
    if (error) {
      toast({ title: `Erro com ${provider}`, description: error.message, variant: 'destructive' });
    }
  };

  return (
    <>
      <Helmet>
        <title>Login - GOV.RP</title>
        <meta name="description" content="Faça login na sua conta GOV.RP e acesse todos os serviços do ecossistema de roleplay político." />
      </Helmet>

      <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 hero-pattern">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "circOut" }}
          className="max-w-md w-full space-y-8 glass-effect rounded-2xl p-8 shadow-2xl"
        >
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-center"
          >
            <h1 className="text-4xl font-bold gradient-text mb-2">Bem-vindo de Volta</h1>
            <p className="text-gray-300">Acesse sua conta para continuar</p>
          </motion.div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <Label htmlFor="identifier" className="text-gray-300 mb-2 block">Email, Usuário ou Telefone</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                  id="identifier"
                  name="identifier"
                  type="text"
                  required
                  value={formData.identifier}
                  onChange={handleChange}
                  className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="Seu identificador"
                />
              </div>
            </div>

            <div>
               <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-gray-300 mb-2 block">Senha</Label>
                  <Link to="/forgot-password" tabIndex={-1} className="text-sm text-blue-400 hover:underline">Esqueceu a senha?</Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={formData.password}
                  onChange={handleChange}
                  className="w-full pl-10 pr-12 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="Sua senha"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 py-3 text-lg font-medium"
            >
              {loading ? <Loader2 className="animate-spin" /> : <><LogIn className="mr-2 h-5 w-5" /> Entrar</>}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/20"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-background text-gray-400">Ou continue com</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button variant="outline" onClick={() => handleSocialLogin('google')} className="w-full flex justify-center items-center gap-2"><FaGoogle /> <span>Google</span></Button>
            <Button variant="outline" onClick={() => handleSocialLogin('facebook')} className="w-full flex justify-center items-center gap-2"><FaFacebook /> <span>Facebook</span></Button>
            <Button variant="outline" onClick={() => handleSocialLogin('discord')} className="w-full flex justify-center items-center gap-2"><FaDiscord /> <span>Discord</span></Button>
          </div>

          <div className="mt-6 text-center">
            <p className="text-gray-300">
              Não tem uma conta?{' '}
              <Link to="/register" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
                Cadastre-se aqui
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default Login;