import React, { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Calendar, Check, Eye, EyeOff, Loader2, Lock, Mail, Phone, User, UserPlus } from 'lucide-react';
import PhoneNumberInput, { parsePhoneNumber } from 'react-phone-number-input';
import pt from 'react-phone-number-input/locale/pt.json';
import { FaDiscord, FaFacebook, FaGoogle } from 'react-icons/fa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import HCaptchaChallenge from '@/components/auth/HCaptchaChallenge';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { checkPasswordStrength } from '@/lib/utils';
import { isAuthPopupClosedError, signInWithOAuthPopup } from '@/lib/oauthPopup';

const PasswordStrengthIndicator = ({ score }) => {
  const levels = [
    { text: 'Muito fraca', color: 'bg-red-500' },
    { text: 'Fraca', color: 'bg-orange-500' },
    { text: 'Razoável', color: 'bg-yellow-500' },
    { text: 'Forte', color: 'bg-green-500' },
    { text: 'Muito forte', color: 'bg-emerald-500' },
  ];
  const level = levels[score - 1] || { text: 'Inválida', color: 'bg-gray-500' };

  return (
    <div className="mt-2 flex items-center gap-2" aria-live="polite">
      <div className="h-2 w-full rounded-full bg-gray-700">
        <motion.div className={`h-2 rounded-full ${level.color}`} animate={{ width: `${score * 20}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs text-gray-300">{level.text}</span>
    </div>
  );
};

const Register = () => {
  const [formData, setFormData] = useState({
    realFullName: '', realDateOfBirth: '', email: '', phone: '', password: '', confirmPassword: '', terms: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordScore, setPasswordScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [socialLoadingProvider, setSocialLoadingProvider] = useState(null);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const { register } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const captchaEnabled = Boolean(import.meta.env.VITE_HCAPTCHA_SITE_KEY?.trim());
  const handleCaptcha = useCallback((token) => setCaptchaToken(token), []);

  const setField = (name, value) => setFormData((current) => ({ ...current, [name]: value }));
  const handleChange = (event) => setField(event.target.name, event.target.value);
  const handlePasswordChange = (event) => {
    const password = event.target.value;
    setField('password', password);
    setPasswordScore(checkPasswordStrength(password).score);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (captchaEnabled && !captchaToken) {
      toast({ title: 'Verificação necessária', description: 'Conclua o hCaptcha para criar sua conta.', variant: 'destructive' });
      return;
    }
    if (passwordScore < 3 || formData.password !== formData.confirmPassword) {
      toast({ title: 'Revise sua senha', description: passwordScore < 3 ? 'Use uma senha de força razoável ou maior.' : 'As senhas não coincidem.', variant: 'destructive' });
      return;
    }
    if (!formData.terms) {
      toast({ title: 'Aceite os termos', description: 'Você deve aceitar os Termos e a Política de Privacidade.', variant: 'destructive' });
      return;
    }

    const phoneNumber = formData.phone ? parsePhoneNumber(formData.phone) : null;
    if (!phoneNumber?.isValid()) {
      toast({ title: 'Telefone inválido', description: 'Informe um número de telefone válido.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const result = await register({
        email: formData.email,
        password: formData.password,
        realFullName: formData.realFullName,
        realDateOfBirth: formData.realDateOfBirth,
        phone: phoneNumber.nationalNumber,
        phoneCountryCode: `+${phoneNumber.countryCallingCode}`,
        captchaToken,
      });
      toast({
        title: 'Conta GOVRP criada!',
        description: result?.session
          ? 'Agora vamos registrar o cidadão que você irá interpretar.'
          : 'Confirme seu e-mail e entre para criar seu cidadão.',
      });
      navigate(result?.session ? '/registro-cidadania' : '/login', { replace: true });
    } catch (error) {
      setCaptchaResetKey((value) => value + 1);
      toast({ title: 'Erro no cadastro', description: error.message || 'Não foi possível criar sua conta.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider) => {
    setSocialLoadingProvider(provider);
    try {
      await signInWithOAuthPopup(provider);
      toast({ title: 'Conta autenticada!', description: 'Agora vamos registrar o cidadão que você irá interpretar.' });
      navigate('/registro-cidadania', { replace: true });
    } catch (error) {
      if (!isAuthPopupClosedError(error)) {
        toast({ title: `Erro com ${provider}`, description: error.message, variant: 'destructive' });
      }
    } finally {
      setSocialLoadingProvider(null);
    }
  };

  const currentYear = new Date().getFullYear();
  const inputClass = 'w-full border-white/10 bg-white/5 pl-10 text-white placeholder:text-gray-500 focus-visible:ring-blue-500';

  return (
    <>
      <Helmet>
        <title>Criar conta - GOV.RP</title>
        <meta name="description" content="Crie sua conta privada GOVRP. Seu cidadão será registrado separadamente." />
      </Helmet>
      <div className="hero-pattern flex min-h-screen items-center justify-center px-4 py-12">
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="glass-effect w-full max-w-lg space-y-7 rounded-2xl p-6 shadow-2xl sm:p-8">
          <header className="text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">Dados da conta · privados</p>
            <h1 className="gradient-text text-4xl font-bold">Criar sua conta GOVRP</h1>
            <p className="mt-3 text-sm leading-6 text-gray-300">Primeiro criamos sua conta. Depois, você dará nome, origem e história ao cidadão que viverá no GOVRP.</p>
          </header>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="realFullName">Nome completo real</Label>
              <p className="mb-2 mt-1 text-xs text-gray-400">Usado somente para identificação e administração da conta. Não será o nome público do personagem.</p>
              <div className="relative"><User className="absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" /><Input id="realFullName" name="realFullName" autoComplete="name" required minLength={3} maxLength={120} value={formData.realFullName} onChange={handleChange} className={inputClass} /></div>
            </div>
            <div>
              <Label htmlFor="realDateOfBirth">Data de nascimento real</Label>
              <p className="mb-2 mt-1 text-xs text-gray-400">Informação privada da conta, diferente do nascimento do personagem.</p>
              <div className="relative"><Calendar className="absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" /><Input id="realDateOfBirth" name="realDateOfBirth" type="date" required min={`${currentYear - 120}-01-01`} max={`${currentYear - 13}-12-31`} value={formData.realDateOfBirth} onChange={handleChange} className={inputClass} /></div>
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <div className="relative mt-2"><Mail className="absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" /><Input id="email" name="email" type="email" autoComplete="email" required value={formData.email} onChange={handleChange} className={inputClass} /></div>
            </div>
            <div>
              <Label htmlFor="phone">Telefone</Label>
              <div className="relative mt-2"><Phone className="pointer-events-none absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" /><PhoneNumberInput id="phone" international withCountryCallingCode labels={pt} limitMaxLength defaultCountry="BR" value={formData.phone} onChange={(value) => setField('phone', value || '')} className="phone-input-control" /></div>
            </div>
            <div>
              <Label htmlFor="password">Senha</Label>
              <div className="relative mt-2"><Lock className="absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" /><Input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required value={formData.password} onChange={handlePasswordChange} className={`${inputClass} pr-12`} /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button></div>
              <PasswordStrengthIndicator score={passwordScore} />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirmar senha</Label>
              <div className="relative mt-2"><Lock className="absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" /><Input id="confirmPassword" name="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" required value={formData.confirmPassword} onChange={handleChange} className={`${inputClass} pr-12`} /><button type="button" onClick={() => setShowConfirmPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-label={showConfirmPassword ? 'Ocultar confirmação' : 'Mostrar confirmação'}>{showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button></div>
            </div>
            <button type="button" role="checkbox" aria-checked={formData.terms} onClick={() => setField('terms', !formData.terms)} className="flex items-start gap-3 text-left text-sm text-gray-300">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${formData.terms ? 'border-blue-600 bg-blue-600' : 'border-gray-400'}`}>{formData.terms && <Check className="h-4 w-4" />}</span>
              <span>Concordo com os <Link to="/terms" onClick={(event) => event.stopPropagation()} className="text-blue-400 hover:underline">Termos</Link> e a <Link to="/privacy" onClick={(event) => event.stopPropagation()} className="text-blue-400 hover:underline">Política de Privacidade</Link>.</span>
            </button>
            <HCaptchaChallenge onVerify={handleCaptcha} resetKey={captchaResetKey} />
            <Button type="submit" disabled={loading || Boolean(socialLoadingProvider) || (captchaEnabled && !captchaToken)} className="w-full bg-gradient-to-r from-blue-600 to-purple-600 py-3 text-lg">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <><UserPlus className="mr-2 h-5 w-5" />Criar conta</>}
            </Button>
          </form>

          <div className="relative"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/20" /></div><div className="relative flex justify-center text-sm"><span className="bg-background px-2 text-gray-400">Ou autentique com</span></div></div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['google', FaGoogle, 'Google'], ['facebook', FaFacebook, 'Facebook'], ['discord', FaDiscord, 'Discord'],
            ].map(([provider, Icon, label]) => (
              <Button key={provider} variant="outline" onClick={() => handleSocialLogin(provider)} disabled={loading || Boolean(socialLoadingProvider)}>
                {socialLoadingProvider === provider ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2" />}{label}
              </Button>
            ))}
          </div>
          <p className="text-center text-gray-300">Já tem conta? <Link to="/login" className="font-medium text-blue-400 hover:underline">Entrar</Link></p>
        </motion.div>
      </div>
    </>
  );
};

export default Register;
