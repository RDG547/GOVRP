import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Eye, EyeOff, Mail, Lock, User, Phone, Check, Calendar, FileText, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { generateCPF, generateRG, formatCPF, formatRG, checkPasswordStrength } from '@/lib/utils';
import InputMask from 'react-input-mask';

const PasswordStrengthIndicator = ({ score }) => {
  const levels = [
    { text: 'Muito Fraca', color: 'bg-red-500' },
    { text: 'Fraca', color: 'bg-orange-500' },
    { text: 'Razoável', color: 'bg-yellow-500' },
    { text: 'Forte', color: 'bg-green-500' },
    { text: 'Muito Forte', color: 'bg-emerald-500' },
  ];
  const level = levels[score - 1] || { text: 'Inválida', color: 'bg-gray-500' };

  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="w-full bg-gray-700 rounded-full h-2">
        <motion.div 
          className={`h-2 rounded-full ${level.color}`} 
          initial={{ width: 0 }}
          animate={{ width: `${score * 20}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      <span className="text-xs text-gray-300 whitespace-nowrap">{level.text}</span>
    </div>
  );
};

const Register = () => {
  const [formData, setFormData] = useState({
    fullName: '', username: '', email: '', countryCode: '+55', phone: '',
    dateOfBirth: '', rg: '', cpf: '', password: '', confirmPassword: '', terms: false
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwordScore, setPasswordScore] = useState(0);
  
  const { register } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handlePasswordChange = (e) => {
    const newPassword = e.target.value;
    setFormData({ ...formData, password: newPassword });
    const { score } = checkPasswordStrength(newPassword);
    setPasswordScore(score);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({ ...formData, [name]: type === 'checkbox' ? checked : value });
  };

  const handleGenerateCPF = () => setFormData({ ...formData, cpf: formatCPF(generateCPF()) });
  const handleGenerateRG = () => setFormData({ ...formData, rg: formatRG(generateRG()) });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (passwordScore < 3) {
      toast({ title: "Senha fraca", description: "Sua senha deve ser pelo menos 'Razoável'.", variant: "destructive" });
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      toast({ title: "Erro no cadastro", description: "As senhas não coincidem.", variant: "destructive" });
      return;
    }
    if (!formData.terms) {
      toast({ title: "Erro no cadastro", description: "Você deve aceitar os termos e condições.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      await register({
        email: formData.email,
        password: formData.password,
        fullName: formData.fullName,
        username: formData.username,
        phone: formData.phone.replace(/\D/g, ''),
        countryCode: formData.countryCode,
        dateOfBirth: formData.dateOfBirth,
        rg: formData.rg.replace(/\D/g, ''),
        cpf: formData.cpf.replace(/\D/g, ''),
      });
      toast({
        title: "Cadastro realizado com sucesso!",
        description: "Bem-vindo ao GOV.RP! Você foi logado automaticamente.",
      });
      navigate('/');
    } catch (error) {
      toast({
        title: "Erro no cadastro",
        description: error.message || "Não foi possível realizar o cadastro. Verifique os dados e tente novamente.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };
  
  const currentYear = new Date().getFullYear();
  const minBirthYear = currentYear - 100;
  const maxBirthYear = currentYear - 13;

  const inputClass = "w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all";

  return (
    <>
      <Helmet>
        <title>Cadastro - GOV.RP</title>
        <meta name="description" content="Cadastre-se no GOV.RP e tenha acesso completo ao ecossistema de roleplay político mais avançado." />
      </Helmet>

      <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 hero-pattern">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "circOut" }}
          className="max-w-md w-full space-y-8 glass-effect rounded-2xl p-8 shadow-2xl"
        >
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-center">
            <h1 className="text-4xl font-bold gradient-text mb-2">Crie sua Cidadania</h1>
            <p className="text-gray-300">Junte-se à nação GOV.RP</p>
          </motion.div>

          <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-6">
                <div><Label htmlFor="fullName">Nome Completo</Label><div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="fullName" name="fullName" type="text" required value={formData.fullName} onChange={handleChange} className={inputClass} placeholder="Seu nome completo" /></div></div>
                <div><Label htmlFor="username">Nome de usuário</Label><div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="username" name="username" type="text" required value={formData.username} onChange={handleChange} className={inputClass} placeholder="Ex: joao.silva" /></div></div>
                <div><Label htmlFor="dateOfBirth">Data de Nascimento</Label><div className="relative"><Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="dateOfBirth" name="dateOfBirth" type="date" required value={formData.dateOfBirth} onChange={handleChange} className={inputClass} min={`${minBirthYear}-01-01`} max={`${maxBirthYear}-12-31`} /></div></div>
                <div><Label htmlFor="email">Email</Label><div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="email" name="email" type="email" required value={formData.email} onChange={handleChange} className={inputClass} placeholder="seu@email.com" /></div></div>
                <div><Label htmlFor="phone">Telefone</Label><div className="flex gap-2"><Input id="countryCode" name="countryCode" type="text" required value={formData.countryCode} onChange={handleChange} className={`${inputClass} w-20 pl-4`} placeholder="+55" /><div className="relative flex-grow"><Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><InputMask mask="(99) 99999-9999" value={formData.phone} onChange={handleChange}>{(inputProps) => <Input {...inputProps} id="phone" name="phone" type="tel" required className={inputClass} placeholder="(11) 99999-9999" />}</InputMask></div></div></div>
                <div><Label htmlFor="cpf">CPF</Label><div className="relative"><FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="cpf" name="cpf" type="text" required value={formData.cpf} readOnly className={`${inputClass} pr-10`} placeholder="Clique no ícone para gerar" /><Button type="button" size="icon" variant="ghost" onClick={handleGenerateCPF} className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-gray-400 hover:text-white"><RefreshCw className="w-4 h-4" /></Button></div></div>
                <div><Label htmlFor="rg">RG</Label><div className="relative"><FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="rg" name="rg" type="text" required value={formData.rg} readOnly className={`${inputClass} pr-10`} placeholder="Clique no ícone para gerar" /><Button type="button" size="icon" variant="ghost" onClick={handleGenerateRG} className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-gray-400 hover:text-white"><RefreshCw className="w-4 h-4" /></Button></div></div>
                <div><Label htmlFor="password">Senha</Label><div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="password" name="password" type={showPassword ? 'text' : 'password'} required value={formData.password} onChange={handlePasswordChange} className={`${inputClass} pr-12`} placeholder="Mínimo 8 caracteres" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"><span className="sr-only">Mostrar/Ocultar</span>{showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button></div><PasswordStrengthIndicator score={passwordScore} /></div>
                <div><Label htmlFor="confirmPassword">Confirmar Senha</Label><div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="confirmPassword" name="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} required value={formData.confirmPassword} onChange={handleChange} className={`${inputClass} pr-12`} placeholder="Confirme sua senha" /><button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"><span className="sr-only">Mostrar/Ocultar</span>{showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button></div></div>
                <div className="flex items-start space-x-3"><button type="button" name="terms" onClick={() => setFormData({...formData, terms: !formData.terms})} className={`mt-1 flex-shrink-0 w-5 h-5 rounded border-2 transition-all duration-200 ${formData.terms ? 'bg-blue-600 border-blue-600' : 'bg-transparent border-gray-400'}`}>{formData.terms && <Check className="w-4 h-4 text-white" />}</button><Label htmlFor="terms" className="text-sm text-gray-300">Eu concordo com os <Link to="/terms" className="text-blue-400 hover:underline">Termos de Serviço</Link> e a <Link to="/privacy" className="text-blue-400 hover:underline">Política de Privacidade</Link>.</Label></div>
              </div>
              <Button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 py-3 text-lg font-medium">{loading ? 'Cadastrando...' : 'Criar Conta'}</Button>
          </form>

          <div className="mt-6 text-center"><p className="text-gray-300">Já tem uma conta?{' '}<Link to="/login" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">Entre aqui</Link></p></div>
        </motion.div>
      </div>
    </>
  );
};

export default Register;