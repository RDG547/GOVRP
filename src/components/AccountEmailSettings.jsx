import React, { useState } from 'react';
import { CheckCircle2, Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { getAppRedirectUrl } from '@/lib/nativeLinks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AccountEmailSettings() {
  const { session } = useAuth();
  const [nextEmail, setNextEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const currentEmail = session?.user?.email || '';

  const requestChange = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSuccess(false);
    setError('');
    const newEmail = nextEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      setError('Informe um e-mail válido.');
      return;
    }
    if (newEmail === currentEmail.toLowerCase()) {
      setError('Escolha um endereço diferente do atual.');
      return;
    }
    setSubmitting(true);
    try {
      // Supabase Auth owns the email field. Never update auth.users or public
      // profiles directly; Secure Email Change verifies the addresses.
      const { error: authError } = await supabase.auth.updateUser(
        { email: newEmail },
        { emailRedirectTo: (() => {
          const requested = getAppRedirectUrl('/settings?email-change=confirmed');
          // Native routes currently allow /auth/callback and /update-password,
          // not /settings. Use the verified web domain for email confirmations.
          return requested.startsWith('br.com.govrp.app:')
            ? 'https://govrp.vercel.app/settings?email-change=confirmed'
            : requested;
        })() }
      );
      if (authError) throw authError;
      setSuccess(true);
      setNextEmail('');
    } catch (cause) {
      const message = cause?.message || '';
      setError(/rate limit|too many|429/i.test(message)
        ? 'Muitas solicitações em pouco tempo. Aguarde antes de tentar novamente.'
        : message || 'Não foi possível iniciar a alteração de e-mail.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border bg-card p-5 sm:p-8">
      <div className="mb-4 flex items-center gap-2">
        <MailCheck className="h-6 w-6 text-sky-400" aria-hidden="true" />
        <h2 className="text-xl font-semibold">Alterar e-mail da conta</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Seu endereço de login atual é <strong>{currentEmail || 'não disponível'}</strong>.
        A troca utiliza as mensagens de verificação do GOVRP.
      </p>
      <form onSubmit={requestChange} className="space-y-4">
        <div>
          <Label htmlFor="new-account-email">Novo endereço de e-mail</Label>
          <Input id="new-account-email" type="email" autoComplete="email" required maxLength={254}
            placeholder="novo@email.com" value={nextEmail} onChange={(event) => setNextEmail(event.target.value)} />
        </div>
        <Button type="submit" disabled={!currentEmail || submitting}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          Solicitar alteração segura
        </Button>
      </form>
      {success && (
        <p role="status" className="mt-4 flex items-start gap-2 text-sm text-emerald-400">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          Solicitação enviada. Verifique seu e-mail atual e o novo e confirme os links, se ambos forem solicitados pelo Supabase. O e-mail de login só muda após a verificação.
        </p>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </section>
  );
}
