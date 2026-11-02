import CardBrandLogo from './CardBrandLogo';
import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CreditCard, KeyRound, Landmark, Loader2, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import { invalidateDomain } from '@/lib/realtime';

const stages = ['Sua conta', 'Transferências', 'Seu cartão', 'Crédito consciente', 'Tudo pronto'];
export default function BankWelcome({ initialAccount = null, initialBalance, onComplete, citizenship = false }) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [account, setAccount] = useState(initialAccount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [brand, setBrand] = useState('');
  const [cardStatus, setCardStatus] = useState('');
  const run = async (job) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await job(); } catch (failure) {
      setError(failure.code || failure instanceof TypeError
        ? 'Não foi possível concluir esta etapa. Confira sua conexão e tente novamente.'
        : failure.message || 'Não foi possível concluir esta etapa. Tente novamente.');
    }
    finally { setBusy(false); }
  };
  const loadAccount = async () => {
    const result = await supabase.rpc('get_my_bank_account');
    if (result.error) throw result.error;
    const next = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!next) throw new Error('Não foi possível consultar sua conta.');
    setAccount(next); return next;
  };
  const next = () => run(async () => {
    if (step === 0 && !account) {
      const result = await supabase.rpc(citizenship ? 'ensure_citizen_bank_account' : 'create_bank_account');
      if (result.error || result.data?.success === false) throw result.error || new Error(result.data?.message || 'Não foi possível abrir sua conta.');
      await loadAccount();
    }
    if (step === 2 && brand && !cardStatus) {
      const result = await supabase.rpc('request_welcome_credit_card', { p_brand: brand });
      if (result.error || !result.data?.success) throw result.error || new Error('Não foi possível solicitar o cartão.');
      setCardStatus(result.data.status === 'active' ? 'Cartão já disponível na sua conta' : 'Solicitação enviada para análise do Banco Nacional');
    }
    if (step === stages.length - 1) {
      const result = await supabase.rpc('complete_bank_welcome');
      if (result.error) throw result.error;
      invalidateDomain('bank', user.id);
      await onComplete();
    } else setStep(current => current + 1);
  });
  const generateKey = () => run(async () => {
    const result = await supabase.rpc('generate_transfer_key_for_user');
    if (result.error || result.data?.success === false) throw result.error || new Error(result.data?.message || 'Não foi possível gerar sua chave.');
    await loadAccount();
  });
  return <section className="mx-auto w-full max-w-2xl rounded-3xl border border-emerald-500/30 bg-background p-5 sm:p-8" aria-label="Boas-vindas ao Banco Nacional">
    <p className="text-xs uppercase tracking-widest text-emerald-400">Banco Nacional · {step + 1} de {stages.length}</p>
    <div className="my-4 flex gap-2" aria-label={`Etapa ${step + 1} de ${stages.length}`}>{stages.map((stage, i) => <span key={stage} className={`h-1 flex-1 rounded ${i <= step ? 'bg-emerald-400' : 'bg-secondary'}`} />)}</div>
    {step === 0 && <div className="space-y-4"><Landmark className="h-12 w-12 text-emerald-400" /><h2 className="text-2xl font-bold">Bem-vindo ao Banco Nacional</h2><p>Esta será a conta da sua vida no GOVRP: receba sua renda, faça compras e acompanhe cada movimentação.</p><p className="text-sm text-muted-foreground">{account ? 'Sua conta já está aberta. Vamos conhecer os próximos passos.' : (citizenship ? 'Após concluir sua cidadania e abrir a conta, o GOVRP credita automaticamente R$ 1.000,00, uma única vez.' : `Seu primeiro saldo${initialBalance != null ? ` de ${formatCurrency(initialBalance)}` : ''} ajuda você a começar. Depois, construa seu caminho para ganhar sua própria renda.`)}</p></div>}
    {step === 1 && <div className="space-y-4"><KeyRound className="h-12 w-12 text-emerald-400" /><h2 className="text-2xl font-bold">Receba por transferência</h2><p>Sua chave é única e identifica sua conta. Compartilhe-a com outros cidadãos para receber pagamentos.</p>{account?.transfer_key ? <p className="break-all rounded-xl bg-secondary p-4 font-mono text-lg">{account.transfer_key}</p> : <Button variant="outline" disabled={busy} onClick={generateKey}><KeyRound className="mr-2 h-4 w-4" />Gerar minha chave</Button>}<p className="text-sm text-muted-foreground">Sua chave de transferência identifica sua conta no GOVRP.</p></div>}
    {step === 2 && <div className="space-y-4"><CreditCard className="h-12 w-12 text-emerald-400" /><h2 className="text-2xl font-bold">Quer solicitar um cartão?</h2><p>Escolha uma bandeira ou continue sem cartão. O Banco Nacional analisa a solicitação e define o limite aprovado.</p><div className="grid gap-2 sm:grid-cols-3">{[['', 'Agora não'], ['visa', 'Visa'], ['mastercard', 'Mastercard']].map(([value, label]) => <Button key={value} variant={brand === value ? 'default' : 'outline'} disabled={busy || Boolean(cardStatus)} onClick={() => setBrand(value)}>{value && <CardBrandLogo brand={value} className="mr-2 h-6 w-8" />}{label}</Button>)}</div>{cardStatus && <p className="text-sm text-emerald-400">{cardStatus}</p>}</div>}
    {step === 3 && <div className="space-y-4"><Wallet className="h-12 w-12 text-emerald-400" /><h2 className="text-2xl font-bold">Planeje antes de usar crédito</h2><p>Empréstimos podem ajudar seus projetos. Confira juros, parcelas e vencimentos antes de solicitar.</p><p className="text-sm text-muted-foreground">Cartões e empréstimos dependem de análise. Acompanhe a resposta no banco e nas notificações.</p></div>}
    {step === 4 && <div className="space-y-4"><Check className="h-12 w-12 text-emerald-400" /><h2 className="text-2xl font-bold">Sua vida financeira começa aqui</h2><dl className="grid gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-2">{[['Agência', account?.agency_number], ['Conta', account?.account_number], ['Saldo', formatCurrency(account?.balance || 0)], ['Chave', account?.transfer_key || 'Consulte sua conta'], ['Cartão', cardStatus || 'Nenhuma solicitação nesta etapa']].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}</dl></div>}
    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    <div className="mt-6 flex flex-wrap justify-between gap-3"><Button variant="ghost" disabled={busy || step === 0} onClick={() => setStep(current => current - 1)}><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Button><Button disabled={busy} onClick={next}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}{step === 4 ? (citizenship ? 'Continuar para a cidadania' : 'Entrar no banco') : step === 0 && !account ? 'Abrir minha conta' : step === 2 && brand && !cardStatus ? 'Solicitar e continuar' : 'Continuar'}</Button></div>
  </section>;
}
