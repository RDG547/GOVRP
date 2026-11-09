import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { checkPasswordStrength } from '@/lib/utils';

const UpdatePassword = () => {
  const { session, updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [linkError, setLinkError] = useState('');
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    let mounted = true;
    let completed = false;
    let fallback;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    const explicitError = hash.get('error_description') || query.get('error_description');
    const hasRecoveryLink = Boolean(query.get('code') || hash.get('access_token') || hash.get('type') === 'recovery');

    const accept = (currentSession) => {
      if (!mounted || !currentSession?.user) return;
      completed = true;
      window.clearTimeout(fallback);
      setLinkError('');
      setVerifying(false);
    };

    const { data: authEvent } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && hasRecoveryLink)) {
        accept(currentSession);
      }
    });

    if (explicitError) {
      setLinkError('Este link expirou ou já foi utilizado. Solicite uma nova recuperação de senha.');
      setVerifying(false);
    } else {
      // Supabase JS exchanges both PKCE ?code= and legacy #access_token= links.
      // Never try to change a password with an unverified URL token.
      void supabase.auth.getSession().then(({ data, error }) => {
        if (!mounted || completed) return;
        if (!error && data?.session?.user) { accept(data.session); return; }
        if (hasRecoveryLink) {
          fallback = window.setTimeout(() => {
            if (!mounted || completed) return;
            setLinkError('Não foi possível validar este link de recuperação. Solicite outro e tente novamente.');
            setVerifying(false);
          }, 8000);
        } else {
          setLinkError('Acesse esta página usando o link seguro enviado ao seu e-mail.');
          setVerifying(false);
        }
      }).catch(() => {
        if (!mounted || completed) return;
        setLinkError('Não foi possível verificar sua sessão. Abra novamente o link enviado.');
        setVerifying(false);
      });
    }

    return () => {
      mounted = false;
      window.clearTimeout(fallback);
      authEvent.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session?.user && !linkError) setVerifying(false);
  }, [session?.user?.id, linkError]);

  const submit = async (event) => {
    event.preventDefault();
    if (saving || verifying || linkError) return;
    if (password !== confirmation) {
      toast({ title: 'Senhas diferentes', description: 'Confirme a mesma senha nos dois campos.', variant: 'destructive' });
      return;
    }
    if (password.length < 8 || checkPasswordStrength(password).score < 3) {
      toast({ title: 'Senha fraca', description: 'Use ao menos 8 caracteres e uma senha de complexidade razoável.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await updatePassword(password);
      toast({ title: 'Senha redefinida', description: 'Agora faça login com sua nova senha.' });
      await supabase.auth.signOut({ scope: 'local' });
      navigate('/login', { replace: true });
    } catch (error) {
      toast({ title: 'Erro ao atualizar senha', description: error.message || 'Tente solicitar outro link.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Helmet><title>Redefinir senha - GOV.RP</title></Helmet>
      <main className="flex min-h-screen items-center justify-center px-4 py-12">
        <section className="glass-effect w-full max-w-md space-y-6 rounded-2xl border border-white/10 p-6 sm:p-8">
          <header className="text-center">
            <ShieldCheck aria-hidden="true" className="mx-auto h-9 w-9 text-sky-400" />
            <h1 className="gradient-text mt-3 text-3xl font-bold">Redefinir senha</h1>
            <p className="mt-2 text-sm text-slate-300">Proteja seu acesso ao GOVRP criando uma nova senha.</p>
          </header>
          {verifying ? (
            <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-slate-300">
              <Loader2 className="h-5 w-5 animate-spin" /> Validando seu link de recuperação...
            </div>
          ) : linkError ? (
            <div role="alert" className="space-y-4 text-center">
              <p className="text-sm text-red-300">{linkError}</p>
              <Button asChild className="w-full"><Link to="/forgot-password">Solicitar novo link</Link></Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              {[
                { id:'new-password',label:'Nova senha',value:password,change:setPassword,visible:showPassword,toggle:()=>setShowPassword((v)=>!v) },
                { id:'confirm-new-password',label:'Confirme a nova senha',value:confirmation,change:setConfirmation,visible:showConfirmation,toggle:()=>setShowConfirmation((v)=>!v) },
              ].map((field) => (
                <div key={field.id}>
                  <Label htmlFor={field.id}>{field.label}</Label>
                  <div className="relative mt-2">
                    <Lock aria-hidden="true" className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <Input id={field.id} type={field.visible?'text':'password'} autoComplete="new-password"
                      required minLength={8} maxLength={128} value={field.value}
                      onChange={(event)=>field.change(event.target.value)} className="pl-10 pr-12" />
                    <button type="button" onClick={field.toggle} aria-label={field.visible?'Ocultar senha':'Mostrar senha'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                      {field.visible?<EyeOff className="h-5 w-5"/>:<Eye className="h-5 w-5"/>}
                    </button>
                  </div>
                </div>
              ))}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<KeyRound className="mr-2 h-4 w-4"/>}
                Salvar nova senha
              </Button>
            </form>
          )}
          <p className="text-center text-sm text-slate-400"><Link to="/login" className="text-blue-300 hover:underline">Voltar ao login</Link></p>
        </section>
      </main>
    </>
  );
};

export default UpdatePassword;
