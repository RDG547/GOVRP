import React, { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Eye, EyeOff, Mail, Lock, User, Phone, Check, Calendar, FileText, RefreshCw, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { generateCPF, generateRG, formatCPF, formatRG, checkPasswordStrength } from '@/lib/utils';
import PhoneNumberInput, { parsePhoneNumber } from 'react-phone-number-input';
import pt from 'react-phone-number-input/locale/pt.json';
import { FaGoogle, FaFacebook, FaDiscord } from 'react-icons/fa';
import { isAuthPopupClosedError, signInWithOAuthPopup } from '@/lib/oauthPopup';
import HCaptchaChallenge from '@/components/auth/HCaptchaChallenge';

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
    fullName: '', username: '', email: '', phone: '',
    dateOfBirth: '', rg: '', cpf: '', password: '', confirmPassword: '', terms: false
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwordScore, setPasswordScore] = useState(0);
  const [socialLoadingProvider, setSocialLoadingProvider] = useState(null);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const captchaEnabled = Boolean(import.meta.env.VITE_HCAPTCHA_SITE_KEY?.trim());
  const handleCaptcha = useCallback((token) => setCaptchaToken(token), []);

  const { register } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const providerLabels = {
    google: 'Google',
    facebook: 'Facebook',
    discord: 'Discord',
  };

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

  const handlePhoneChange = (value) => {
    setFormData({ ...formData, phone: value });
  };

  const handleGenerateCPF = () => setFormData({ ...formData, cpf: formatCPF(generateCPF()) });
  const handleGenerateRG = () => setFormData({ ...formData, rg: formatRG(generateRG()) });

  const validateUsername = (username) => {
    if (!username || username.length < 3) {
      return 'O nome de usuário deve ter no mínimo 3 caracteres.';
    }
    if (username.length > 20) {
      return 'O nome de usuário deve ter no máximo 20 caracteres.';
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      return 'O nome de usuário só pode conter letras, números, ponto, underline ou hífen.';
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (captchaEnabled && !captchaToken) {
      toast({ title: 'Verificação necessária', description: 'Conclua o hCaptcha para criar sua conta.', variant: 'destructive' });
      return;
    }

    const usernameError = validateUsername(formData.username);
    if (usernameError) {
      toast({ title: "Erro no cadastro", description: usernameError, variant: "destructive" });
      return;
    }

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

    const phoneNumber = formData.phone ? parsePhoneNumber(formData.phone) : null;
    if (!phoneNumber || !phoneNumber.isValid()) {
      toast({ title: "Erro no cadastro", description: "Por favor, insira um número de telefone válido.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      await register({
        email: formData.email,
        password: formData.password,
        fullName: formData.fullName,
        username: formData.username,
        phone: phoneNumber.nationalNumber,
        countryCode: `+${phoneNumber.countryCallingCode}`,
        dateOfBirth: formData.dateOfBirth,
        rg: formData.rg.replace(/\D/g, ''),
        cpf: formData.cpf.replace(/\D/g, ''),
        captchaToken,
      });
      toast({
        title: "Cadastro realizado com sucesso!",
        description: "Bem-vindo ao GOV.RP! Você foi logado automaticamente.",
      });
      navigate('/');
    } catch (error) {
      setCaptchaResetKey((value) => value + 1);
      toast({
        title: "Erro no cadastro",
        description: error.message || "Não foi possível realizar o cadastro. Verifique os dados e tente novamente.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider) => {
    const providerLabel = providerLabels[provider] || provider;

    setSocialLoadingProvider(provider);

    try {
      await signInWithOAuthPopup(provider);
      toast({
        title: 'Autenticacao realizada!',
        description: `Sua conta com ${providerLabel} foi conectada com sucesso.`,
      });
      navigate('/');
    } catch (error) {
      if (isAuthPopupClosedError(error)) {
        return;
      }

      toast({
        title: `Erro com ${providerLabel}`,
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSocialLoadingProvider(null);
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
              <div>
                <Label htmlFor="fullName">Nome Completo</Label>
                <p className="text-xs text-gray-400 mb-1.5">Seu nome da vida real</p>
                <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 z-10" /><Input id="fullName" name="fullName" type="text" required value={formData.fullName} onChange={handleChange} className={inputClass} placeholder="Seu nome completo" /></div>
              </div>
              <div>
                <Label htmlFor="username">Nome de usuário</Label>
                <p className="text-xs text-gray-400 mb-1.5">O nome do seu personagem no RP</p>
                <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 z-10" /><Input id="username" name="username" type="text" required minLength={3} maxLength={20} value={formData.username} onChange={handleChange} className={inputClass} placeholder="Ex: joao.silva" /></div>
                <p className="text-xs text-gray-500 mt-1.5">De 3 a 20 caracteres. Use letras, números, ponto, underline ou hífen.</p>
              </div>
              <div><Label htmlFor="dateOfBirth">Data de Nascimento</Label><div className="relative"><Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 z-10" /><Input id="dateOfBirth" name="dateOfBirth" type="date" required value={formData.dateOfBirth} onChange={handleChange} className={inputClass} min={`${minBirthYear}-01-01`} max={`${maxBirthYear}-12-31`} /></div></div>
              <div><Label htmlFor="email">Email</Label><div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 z-10" /><Input id="email" name="email" type="email" required value={formData.email} onChange={handleChange} className={inputClass} placeholder="seu@email.com" /></div></div>

              {/* CAMPO DE TELEFONE CORRIGIDO COM OS DOIS ÍCONES */}
              <div>
                <Label htmlFor="phone">Telefone</Label>
                <div className="relative">
                  {/* Ícone de Telefone */}
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 z-10 pointer-events-none" />
                  {/* Componente de Telefone */}
                  <PhoneNumberInput
                    id="phone"
                    international
                    withCountryCallingCode
                    labels={pt}
                    limitMaxLength
                    defaultCountry="BR"
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    className="phone-input-control"
                    placeholder="Seu número de telefone"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="cpf">CPF</Label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 z-10" />
                    <Input id="cpf" name="cpf" type="text" required value={formData.cpf} readOnly className={`${inputClass} pr-10`} placeholder="Clique no ícone para gerar" />
                    <div className="absolute right-1 top-1/2 -translate-y-1/2">
                      <Button type="button" size="icon" variant="ghost" onClick={handleGenerateCPF} className="h-8 w-8 text-gray-400 hover:text-white">
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                <div>
                  <Label htmlFor="rg">RG</Label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 z-10" />
                    <Input id="rg" name="rg" type="text" required value={formData.rg} readOnly className={`${inputClass} pr-10`} placeholder="Clique no ícone para gerar" />
                    <div className="absolute right-1 top-1/2 -translate-y-1/2">
                      <Button type="button" size="icon" variant="ghost" onClick={handleGenerateRG} className="h-8 w-8 text-gray-400 hover:text-white">
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
              <div><Label htmlFor="password">Senha</Label><div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 z-10" /><Input id="password" name="password" type={showPassword ? 'text' : 'password'} required value={formData.password} onChange={handlePasswordChange} className={`${inputClass} pr-12`} placeholder="Mínimo 8 caracteres" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"><span className="sr-only">Mostrar/Ocultar</span>{showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button></div><PasswordStrengthIndicator score={passwordScore} /></div>
              <div><Label htmlFor="confirmPassword">Confirmar Senha</Label><div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 z-10" /><Input id="confirmPassword" name="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} required value={formData.confirmPassword} onChange={handleChange} className={`${inputClass} pr-12`} placeholder="Confirme sua senha" /><button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"><span className="sr-only">Mostrar/Ocultar</span>{showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button></div></div>
              <div className="flex items-start space-x-3"><button type="button" name="terms" onClick={() => setFormData({ ...formData, terms: !formData.terms })} className={`mt-1 flex-shrink-0 w-5 h-5 rounded border-2 transition-all duration-200 ${formData.terms ? 'bg-blue-600 border-blue-600' : 'bg-transparent border-gray-400'}`}>{formData.terms && <Check className="w-4 h-4 text-white" />}</button><Label htmlFor="terms" className="text-sm text-gray-300">Eu concordo com os <Link to="/terms" className="text-blue-400 hover:underline">Termos de Serviço</Link> e a <Link to="/privacy" className="text-blue-400 hover:underline">Política de Privacidade</Link>.</Label></div>
              <HCaptchaChallenge onVerify={handleCaptcha} resetKey={captchaResetKey} />
            </div>
            <Button type="submit" disabled={loading || Boolean(socialLoadingProvider) || (captchaEnabled && !captchaToken)} className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 py-3 text-lg font-medium">{loading ? <Loader2 className="animate-spin" /> : <><UserPlus className="mr-2 h-5 w-5" />Criar Conta</>}</Button>
          </form>
          <div className="relative my-6"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/20"></div></div><div className="relative flex justify-center text-sm"><span className="px-2 bg-background text-gray-400">Ou cadastre-se com</span></div></div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button variant="outline" onClick={() => handleSocialLogin('google')} disabled={loading || Boolean(socialLoadingProvider)} className="w-full flex justify-center items-center gap-2">
              {socialLoadingProvider === 'google' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FaGoogle />}
              <span>Google</span>
            </Button>
            <Button variant="outline" onClick={() => handleSocialLogin('facebook')} disabled={loading || Boolean(socialLoadingProvider)} className="w-full flex justify-center items-center gap-2">
              {socialLoadingProvider === 'facebook' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FaFacebook />}
              <span>Facebook</span>
            </Button>
            <Button variant="outline" onClick={() => handleSocialLogin('discord')} disabled={loading || Boolean(socialLoadingProvider)} className="w-full flex justify-center items-center gap-2">
              {socialLoadingProvider === 'discord' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FaDiscord />}
              <span>Discord</span>
            </Button>
          </div>
          <div className="mt-6 text-center"><p className="text-gray-300">Já tem uma conta?{' '}<Link to="/login" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">Entre aqui</Link></p></div>
        </motion.div>
      </div>
    </>
  );
};

export default Register;
