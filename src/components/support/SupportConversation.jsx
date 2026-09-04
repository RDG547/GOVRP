import React, { useState } from 'react';
import { Clock3, Loader2, MessageSquare, Send, ShieldCheck, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export const SUPPORT_STATUS = {
  open: { label: 'Aberto', className: 'border-blue-400/30 bg-blue-500/10 text-blue-200' },
  in_progress: { label: 'Em atendimento', className: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200' },
  waiting_user: { label: 'Aguardando sua resposta', className: 'border-amber-400/30 bg-amber-500/10 text-amber-200' },
  resolved: { label: 'Resolvido', className: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' },
  closed: { label: 'Encerrado', className: 'border-slate-400/30 bg-slate-500/10 text-slate-300' },
};

export const SUPPORT_PRIORITY = {
  low: { label: 'Baixa', className: 'border-sky-400/30 bg-sky-500/10 text-sky-200', accentClass: 'border-l-sky-400' },
  normal: { label: 'Média', className: 'border-amber-400/30 bg-amber-500/10 text-amber-200', accentClass: 'border-l-amber-400' },
  high: { label: 'Alta', className: 'border-orange-400/30 bg-orange-500/10 text-orange-200', accentClass: 'border-l-orange-400' },
  urgent: { label: 'Urgente', className: 'border-rose-400/30 bg-rose-500/10 text-rose-200', accentClass: 'border-l-rose-400' },
};

const formatDateTime = (value) => new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
}).format(new Date(value));

const SupportConversation = ({
  ticket,
  messages,
  loading = false,
  saving = false,
  isAdmin = false,
  onReply,
}) => {
  const [reply, setReply] = useState('');
  const status = SUPPORT_STATUS[ticket?.status] || SUPPORT_STATUS.open;
  const priority = SUPPORT_PRIORITY[ticket?.priority] || SUPPORT_PRIORITY.normal;

  if (!ticket) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-8 text-center text-muted-foreground">
        <MessageSquare className="mb-3 h-9 w-9" />
        Selecione uma solicitação para acompanhar a conversa.
      </div>
    );
  }

  const submitReply = async () => {
    const message = reply.trim();
    if (!message) return;
    const sent = await onReply?.(message);
    if (sent !== false) setReply('');
  };

  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/35">
      <header className="border-b border-white/10 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-cyan-300">{ticket.public_id}</span>
              <Badge variant="outline" className={status.className}>{status.label}</Badge>
            </div>
            <h3 className="mt-2 break-words text-lg font-semibold text-foreground">{ticket.subject}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {ticket.requester_name} · aberto em {formatDateTime(ticket.created_at)}
            </p>
          </div>
          {isAdmin ? (
            <Badge variant="outline" className={priority.className}>Prioridade {priority.label}</Badge>
          ) : null}
        </div>
      </header>

      <div className="custom-scrollbar max-h-[32rem] min-h-72 space-y-4 overflow-y-auto p-4 sm:p-5">
        {loading ? (
          <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-cyan-300" /></div>
        ) : messages?.length ? messages.map((message) => {
          const fromAdmin = message.sender_kind === 'admin' || message.sender_kind === 'system';
          const senderName = fromAdmin
            ? (message.sender?.full_name || 'Equipe GOV.RP')
            : (message.sender?.full_name || ticket.requester_name || 'Cidadão');
          return (
            <article key={message.id} className={`flex gap-3 ${fromAdmin ? '' : 'sm:flex-row-reverse'}`}>
              <Avatar className="h-9 w-9 shrink-0 border border-white/10">
                <AvatarImage src={message.sender?.avatar_url || ''} alt="" />
                <AvatarFallback>{fromAdmin ? <ShieldCheck className="h-4 w-4" /> : <User className="h-4 w-4" />}</AvatarFallback>
              </Avatar>
              <div className={`min-w-0 max-w-[88%] rounded-2xl border p-3 ${fromAdmin ? 'border-cyan-400/20 bg-cyan-500/10' : 'border-blue-400/20 bg-blue-500/10'}`}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-foreground">{senderName}</span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground"><Clock3 className="h-3 w-3" />{formatDateTime(message.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">{message.body}</p>
              </div>
            </article>
          );
        }) : (
          <p className="py-16 text-center text-sm text-muted-foreground">A conversa ainda não possui mensagens.</p>
        )}
      </div>

      {ticket.status !== 'closed' ? (
        <footer className="border-t border-white/10 p-4 sm:p-5">
          <Textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            maxLength={5000}
            placeholder={isAdmin ? 'Escreva uma resposta clara para o cidadão...' : 'Escreva sua resposta para a equipe...'}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{reply.length}/5000</span>
            <Button type="button" onClick={submitReply} disabled={saving || !reply.trim()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Enviar resposta
            </Button>
          </div>
        </footer>
      ) : null}
    </section>
  );
};

export default SupportConversation;
