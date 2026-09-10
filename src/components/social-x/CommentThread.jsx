import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { fetchPublicProfiles } from '@/lib/publicProfiles';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import Comment from './Comment';

export default function CommentThread({ postId }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    try {
      // Fetch all pages to keep a reply's ancestor available, even in long conversations.
      const comments = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from('comments').select('*').eq('post_id', postId).order('created_at').order('id').range(offset, offset + 499);
        if (error) throw error;
        if (sequence !== request.current) return;
        comments.push(...data);
        if (data.length < 500) break;
      }
      const profiles = await fetchPublicProfiles(comments.map(row => row.user_id));
      if (sequence !== request.current) return;
      setRows(comments.map(row => ({ ...row, author: profiles.get(row.user_id) })));
      setFailed(false);
    } catch (error) { if (sequence === request.current) { console.error('Falha ao carregar conversa', error); setFailed(true); } }
    finally { if (sequence === request.current) setLoading(false); }
  }, [postId]);
  useEffect(() => { setLoading(true); void load(); return () => { request.current++; }; }, [load]);
  useDomainRealtime('x-comment-thread', postId, [{ table: 'comments', filter: `post_id=eq.${postId}` }], load, Boolean(postId));
  usePublicProfileChanges(load);
  const childrenByParent = useMemo(() => {
    const groups = new Map();
    rows.forEach(row => { const key = row.parent_comment_id || null; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
    return groups;
  }, [rows]);
  const submit = async event => {
    event.preventDefault();
    if (!user || busy || !text.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('comments').insert({ post_id: postId, user_id: user.id, content: text.trim() });
    setBusy(false);
    if (error) { console.error('Falha ao publicar comentário', error); toast({ title: 'Não foi possível publicar seu comentário.', variant: 'destructive' }); }
    else { setText(''); void load(); }
  };
  return <section aria-label="Conversa da publicação" className="min-w-0 space-y-3 no-navigate" onClick={event => event.stopPropagation()}>
    {user && <form onSubmit={submit} className="space-y-2"><Textarea aria-label="Escrever comentário" placeholder="Escreva um comentário" rows={2} maxLength={10000} value={text} onChange={event => setText(event.target.value)} /><div className="flex justify-end"><Button type="submit" disabled={busy || !text.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}Comentar</Button></div></form>}
    {loading && <Loader2 aria-label="Carregando comentários" className="w-5 h-5 animate-spin mx-auto" />}
    {failed && <Button variant="outline" onClick={load}>Não foi possível carregar. Tentar novamente</Button>}
    {(childrenByParent.get(null) || []).map(row => <Comment key={row.id} comment={row} childrenByParent={childrenByParent} onChange={load} />)}
    {!loading && !failed && !rows.some(row => !row.deleted_at) && <p className="text-sm text-center text-muted-foreground">Nenhum comentário ainda. Seja o primeiro!</p>}
  </section>;
}
