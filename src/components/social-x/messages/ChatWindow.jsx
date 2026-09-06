import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Send } from 'lucide-react';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { invalidateDomain } from '@/lib/realtime';
import { cn } from '@/lib/utils';

function mergeMessages(current, incoming) {
  const rows = new Map(current.map(row => [row.id, row]));
  incoming.forEach(row => rows.set(row.id, row));
  return [...rows.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export default function ChatWindow({ conversation }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const nearBottom = useRef(true);
  const sendingRef = useRef(false);
  const mounted = useRef(true);
  const other = (conversation.participants || []).find(p => p.profile?.id && p.profile.id !== user.id)?.profile;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const fetchMessages = useCallback(async (before = null) => {
    let query = supabase.from('x_messages').select('id,conversation_id,sender_id,content,created_at')
      .eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(100);
    if (before) query = query.lt('created_at', before);
    const { data, error: failure } = await query;
    if (!mounted.current) return;
    if (failure) setError('Não foi possível carregar as mensagens. Tente novamente.');
    else {
      setError('');
      setMessages(current => mergeMessages(current, data || []));
      setHasOlder((data || []).length === 100);
    }
    setLoading(false);
  }, [conversation.id]);
  useEffect(() => { void fetchMessages(); }, [fetchMessages]);
  useDomainRealtime('x-chat', `${user.id}:${conversation.id}`, [{ table: 'x_messages', filter: `conversation_id=eq.${conversation.id}` }], events => {
    if (events.some(event => event.eventType === 'SYNC')) void fetchMessages();
    setMessages(current => {
      let rows = current;
      for (const event of events) {
        if (event.eventType === 'DELETE') rows = rows.filter(row => row.id !== event.old.id);
        else if (event.new?.id) rows = mergeMessages(rows, [event.new]);
      }
      return rows;
    });
  });
  useEffect(() => {
    if (nearBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async event => {
    event.preventDefault();
    if (!draft.trim() || sendingRef.current || !other) return;
    sendingRef.current = true; setSending(true); setError('');
    const content = draft.trim();
    try {
      const { data, error: failure } = await supabase.rpc('send_x_message', { p_recipient_id: other.id, p_content: content });
      if (failure || !data?.success) throw new Error(data?.message || 'A mensagem não foi enviada. Tente novamente.');
      if (!mounted.current) return;
      nearBottom.current = true;
      if (data.message?.id) setMessages(current => mergeMessages(current, [data.message]));
      else await fetchMessages();
      setDraft('');
      invalidateDomain('x-conversations', user.id);
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { sendingRef.current = false; if (mounted.current) setSending(false); }
  };
  const older = async () => {
    setLoadingOlder(true);
    const height = scrollRef.current?.scrollHeight || 0;
    nearBottom.current = false;
    await fetchMessages(messages[0]?.created_at);
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop += scrollRef.current.scrollHeight - height; });
    setLoadingOlder(false);
  };

  if (!other) return <p className="p-4 text-muted-foreground">Este participante está indisponível.</p>;
  return <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col" aria-label={`Conversa com ${other.x_username || other.x_handle}`}>
    <header className="flex items-center gap-3 border-b p-3">
      <Link to={`/services/x/profile/${other.x_handle}`} className="flex min-w-0 items-center gap-3">
        <img src={other.x_avatar_url || '/favicon.svg'} alt="" className="h-10 w-10 rounded-full object-cover" />
        <div className="min-w-0"><p className="truncate font-bold">{other.x_username || other.x_handle}</p><p className="truncate text-sm text-muted-foreground">@{other.x_handle}</p></div>
      </Link>
    </header>
    {error && <div role="alert" className="p-3 text-sm text-destructive">{error} <Button variant="link" onClick={() => fetchMessages()}>Tentar novamente</Button></div>}
    <div ref={scrollRef} onScroll={event => { const node = event.currentTarget; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
      {hasOlder && <Button variant="ghost" onClick={older} disabled={loadingOlder}>{loadingOlder ? 'Carregando…' : 'Mensagens anteriores'}</Button>}
      {loading && <Loader2 className="mx-auto animate-spin" aria-label="Carregando mensagens" />}
      {messages.map(message => <div key={message.id} className={cn('flex', message.sender_id === user.id ? 'justify-end' : 'justify-start')}>
        <div className={cn('max-w-[88%] break-words rounded-2xl px-3 py-2', message.sender_id === user.id ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-secondary')}>
          <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{message.content}</p>
          <time dateTime={message.created_at} className="mt-1 block text-right text-[11px] opacity-70">{new Date(message.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
        </div>
      </div>)}
    </div>
    <form onSubmit={send} className="flex shrink-0 items-end gap-2 border-t p-3">
      <Textarea aria-label="Mensagem" value={draft} disabled={sending} maxLength={4000} onChange={event => setDraft(event.target.value)} placeholder={`Mensagem para @${other.x_handle}`} rows={2} className="max-h-36 min-h-11 resize-none" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(event); } }} />
      <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={sending || !draft.trim()} aria-label="Enviar mensagem">{sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}</Button>
    </form>
  </section>;
}
