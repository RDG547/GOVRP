import MessageAttachment, { MESSAGE_FILE_TYPES, MESSAGE_FILE_LIMIT } from './MessageAttachment';
import { formatLocaleBR } from '@/lib/dateTime';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Send, Paperclip, Pencil, Trash2, X, FileText, ArrowLeft } from 'lucide-react';
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
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [editing, setEditing] = useState(null);
  const [actionId, setActionId] = useState('');
  const fileInput = useRef(null);
  const requestId = useRef(null);
  const uploadedFile = useRef(null);
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
    let query = supabase.from('x_messages').select('id,conversation_id,sender_id,content,created_at,edit_count,edited_at,deleted_at,attachment')
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
    if ((!draft.trim() && !file) || sendingRef.current || !other) return;
    sendingRef.current = true; setSending(true); setError('');
    const content = draft.trim();
    try {
      if (editing) {
        const result = await supabase.rpc('edit_x_message', { p_message_id: editing.id, p_content: content });
        if (result.error) throw new Error('Não foi possível editar sua mensagem.');
        setMessages(current => mergeMessages(current, [result.data])); setEditing(null); setDraft(''); return;
      }
      if (!requestId.current) requestId.current = crypto.randomUUID();
      if (file && !uploadedFile.current) {
        const path = `${conversation.id}/${user.id}/${crypto.randomUUID()}`;
        const result = await supabase.storage.from('x-message-attachments').upload(path, file, { contentType:file.type, upsert:false });
        if (result.error) throw new Error('Não foi possível enviar o arquivo. Confira o tamanho e tente novamente.');
        uploadedFile.current = {path,name:file.name};
      }
      const { data, error: failure } = await supabase.rpc('send_x_message', { p_recipient_id: other.id, p_content: content, p_attachment: uploadedFile.current, p_request_id: requestId.current });
      if (failure || !data?.success) throw new Error(data?.message || 'A mensagem não foi enviada. Tente novamente.');
      if (!mounted.current) return;
      nearBottom.current = true;
      if (data.message?.id) setMessages(current => mergeMessages(current, [data.message]));
      else await fetchMessages();
      setDraft(''); setFile(null); uploadedFile.current = null; requestId.current = null;
      invalidateDomain('x-conversations', user.id);
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { sendingRef.current = false; if (mounted.current) setSending(false); }
  };
  useEffect(() => {
    const url = file?.type.startsWith('image/') ? URL.createObjectURL(file) : '';
    setPreview(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [file]);
  const selectFile = event => {
    const next = event.target.files?.[0]; event.target.value = '';
    if (!next) return;
    if (!MESSAGE_FILE_TYPES.includes(next.type) || next.size > MESSAGE_FILE_LIMIT || !next.size) { setError('Envie imagem, PDF, TXT ou DOCX de até 10 MB.'); return; }
    if (uploadedFile.current) void supabase.storage.from('x-message-attachments').remove([uploadedFile.current.path]);
    uploadedFile.current = null; requestId.current = null; setFile(next); setError('');
  };
  const removeMessage = async message => {
    if (actionId) return;
    setActionId(message.id);
    const result = await supabase.rpc('remove_x_message', { p_message_id: message.id });
    if (result.error) setError('Não foi possível apagar sua mensagem.');
    else { setMessages(current => mergeMessages(current, [result.data])); if (message.attachment) void supabase.storage.from('x-message-attachments').remove([message.attachment.path]); }
    setActionId('');
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
    <header className="flex shrink-0 items-center gap-3 border-b p-3"><Button asChild variant="ghost" size="icon" aria-label="Voltar às conversas"><Link to="/services/x/messages"><ArrowLeft className="h-5 w-5"/></Link></Button>
      <Link to={`/services/x/profile/${other.x_handle}`} className="flex min-w-0 items-center gap-3">
        <img src={other.x_avatar_url || other.avatar_url || '/favicon.svg'} alt="" className="h-10 w-10 rounded-full object-cover" />
        <div className="min-w-0"><p className="truncate font-bold">{other.x_username || other.x_handle}</p><p className="truncate text-sm text-muted-foreground">@{other.x_handle}</p></div>
      </Link>
    </header>
    {error && <div role="alert" className="p-3 text-sm text-destructive">{error} <Button variant="link" onClick={() => fetchMessages()}>Tentar novamente</Button></div>}
    <div ref={scrollRef} onScroll={event => { const node = event.currentTarget; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
      {hasOlder && <Button variant="ghost" onClick={older} disabled={loadingOlder}>{loadingOlder ? 'Carregando…' : 'Mensagens anteriores'}</Button>}
      {loading && <Loader2 className="mx-auto animate-spin" aria-label="Carregando mensagens" />}
      {messages.map(message => <div key={message.id} className={cn('flex', message.sender_id === user.id ? 'justify-end' : 'justify-start')}>
        <div className={cn('max-w-[88%] break-words rounded-2xl px-3 py-2', message.sender_id === user.id ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-secondary')}>
          {message.deleted_at ? <p className="text-sm italic opacity-70">Esta mensagem foi excluída.</p> : <>{message.attachment && <MessageAttachment attachment={message.attachment}/>}<p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{message.content}</p>{message.edit_count > 0 && <span className="text-[11px] opacity-70">Editado {message.edit_count}x</span>}{message.sender_id === user.id && <div className="mt-1 flex justify-end gap-1"><Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Editar mensagem" disabled={Boolean(actionId)||sending} onClick={()=>{setEditing(message);setDraft(message.content);setFile(null);if(uploadedFile.current)void supabase.storage.from('x-message-attachments').remove([uploadedFile.current.path]);uploadedFile.current=null;requestId.current=null;}}><Pencil className="h-3.5 w-3.5"/></Button><Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Apagar mensagem" disabled={Boolean(actionId)||sending} onClick={()=>removeMessage(message)}><Trash2 className="h-3.5 w-3.5"/></Button></div>}</>}
          <time dateTime={message.created_at} className="mt-1 block text-right text-[11px] opacity-70">{formatLocaleBR(new Date(message.created_at), 'toLocaleString', 'pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
        </div>
      </div>)}
    </div>
    {editing && <div className="flex shrink-0 items-center justify-between border-t px-3 py-1 text-sm"><span>Editando mensagem</span><Button variant="ghost" size="sm" onClick={()=>{setEditing(null);setDraft('');}}><X className="mr-1 h-4 w-4"/>Cancelar</Button></div>}
    {file && <div className="flex shrink-0 items-center gap-3 border-t p-2">{preview?<img src={preview} alt="Prévia do anexo" className="h-14 w-14 rounded object-cover"/>:<FileText className="h-8 w-8 shrink-0"/>}<p className="min-w-0 flex-1 truncate text-sm">{file.name}</p><Button variant="ghost" size="icon" aria-label="Remover anexo" disabled={sending} onClick={()=>{setFile(null);if(uploadedFile.current)void supabase.storage.from('x-message-attachments').remove([uploadedFile.current.path]);uploadedFile.current=null;requestId.current=null;}}><X className="h-4 w-4"/></Button></div>}
    <form onSubmit={send} className="flex shrink-0 items-end gap-2 border-t p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] sm:p-3">
      <input ref={fileInput} type="file" accept={MESSAGE_FILE_TYPES.join(',')} className="hidden" onChange={selectFile}/><Button type="button" variant="ghost" size="icon" disabled={sending||Boolean(editing)} aria-label="Anexar imagem ou documento" className="h-11 w-9 shrink-0" onClick={()=>fileInput.current?.click()}><Paperclip className="h-5 w-5"/></Button>
      <Textarea aria-label="Mensagem" value={draft} disabled={sending} maxLength={4000} onChange={event => { setDraft(event.target.value); requestId.current=null; }} placeholder={`Mensagem para @${other.x_handle}`} rows={2} className="max-h-36 min-h-11 resize-none" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(event); } }} />
      <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={sending || (!draft.trim() && !file)} aria-label="Enviar mensagem">{sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}</Button>
    </form>
  </section>;
}
