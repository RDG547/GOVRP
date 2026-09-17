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
      const likes = [];
      for (let offset = 0; offset < comments.length; offset += 100) {
        for (let page = 0; ; page += 500) {
          const result = await supabase.from('comment_likes').select('comment_id,user_id').in('comment_id', comments.slice(offset, offset + 100).map(row => row.id)).order('comment_id').order('user_id').range(page, page + 499);
          if (result.error) throw result.error;
          if (sequence !== request.current) return;
          likes.push(...result.data);
          if (result.data.length < 500) break;
        }
      }
      const profiles = await fetchPublicProfiles(comments.map(row => row.user_id));
      if (sequence !== request.current) return;
      setRows(comments.map(row => ({ ...row, author: profiles.get(row.user_id), likes_count: likes.filter(like => like.comment_id === row.id).length, is_liked: likes.some(like => like.comment_id === row.id && like.user_id === user?.id) })));
      setFailed(false);
    } catch (error) { if (sequence === request.current) { console.error('Falha ao carregar conversa', error); setFailed(true); } }
    finally { if (sequence === request.current) setLoading(false); }
  }, [postId, user?.id]);
  useEffect(() => { setLoading(true); void load(); return () => { request.current++; }; }, [load]);
  useDomainRealtime('x-comment-thread', postId, [{ table: 'comments', filter: `post_id=eq.${postId}` }, 'comment_likes'], load, Boolean(postId));
  usePublicProfileChanges(load);
  const childrenByParent = useMemo(() => {
    const groups = new Map();
    const byId = new Map(rows.map(row => [row.id, row]));
    rows.filter(row => !row.deleted_at).forEach(row => {
      let key = row.parent_comment_id || null;
      const seen = new Set([row.id]);
      while (key && byId.get(key)?.deleted_at && !seen.has(key)) { seen.add(key); key = byId.get(key).parent_comment_id; }
      if (seen.has(key) || (key && !byId.has(key))) key = null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
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
