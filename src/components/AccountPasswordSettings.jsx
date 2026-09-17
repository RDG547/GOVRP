import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, supabaseUrl, supabasePublishableKey } from '@/lib/supabaseClient';
import { getAppRedirectUrl } from '@/lib/nativeLinks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AccountPasswordSettings() {
  const { session } = useAuth();
  const [current, setCurrent] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  const hasPassword = session?.user?.identities?.some(identity => identity.provider === 'email');
  const save = async event => {
    event.preventDefault(); setError(''); setDone(false);
    if (password !== confirm) { setError('A confirmação não corresponde à nova senha.'); return; }
    if (password.length < 8) { setError('Use uma senha com pelo menos 8 caracteres.'); return; }
    setBusy(true);
    const verifier = createClient(supabaseUrl, supabasePublishableKey, { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'govrp-password-verification'} });
    try {
      const verification = await verifier.auth.signInWithPassword({ email: session.user.email, password: current });
      if (verification.error || verification.data.user?.id !== session.user.id) { setError('A senha atual está incorreta ou a verificação não pôde ser concluída.'); return; }
      const result = await supabase.auth.updateUser({ password });
      if (result.error) { setError('Não foi possível alterar a senha. Entre novamente e tente outra senha.'); return; }
      setDone(true); setCurrent(''); setPassword(''); setConfirm('');
    } catch { setError('A conexão falhou. Tente novamente.'); } finally { await verifier.auth.signOut({scope:'local'}); setBusy(false); }
  };
  const sendRecovery = async () => {
    setBusy(true); setError('');
    const result = await supabase.auth.resetPasswordForEmail(session.user.email, {redirectTo:getAppRedirectUrl('/update-password')});
    setBusy(false); if (result.error) setError('Não foi possível enviar o link. Tente novamente em alguns minutos.'); else setDone(true);
  };
  return <section className="mt-6 rounded-2xl border bg-card p-5 sm:p-8"><h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><ShieldCheck className="h-6 w-6 text-emerald-400"/>Segurança da conta</h2>{hasPassword ? <form onSubmit={save} className="space-y-4">{[['current-password','Senha atual',current,setCurrent],['new-password','Nova senha',password,setPassword],['confirm-password','Confirmar nova senha',confirm,setConfirm]].map(([id,label,value,setValue])=><div key={id}><Label htmlFor={id}>{label}</Label><Input id={id} autoComplete={id==='current-password'?'current-password':'new-password'} required type="password" value={value} minLength={id==='current-password'?1:8} maxLength={128} onChange={event=>setValue(event.target.value)}/></div>)}<Button disabled={busy} type="submit">{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<KeyRound className="mr-2 h-4 w-4"/>}Alterar senha</Button></form> : <div className="space-y-3"><p className="text-sm text-muted-foreground">Sua conta usa login social. Para definir uma senha, confirme sua identidade pelo link enviado ao e-mail da conta.</p><Button disabled={busy} onClick={sendRecovery}><KeyRound className="mr-2 h-4 w-4"/>Enviar link seguro</Button></div>}{error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{done&&<p role="status" className="mt-3 text-sm text-emerald-400">{hasPassword?'Senha alterada com sucesso.':'Confira seu e-mail para definir uma senha.'}</p>}</section>;
}
