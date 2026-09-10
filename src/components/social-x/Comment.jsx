import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2, CornerDownRight, Loader2, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';

export default function Comment({ comment, childrenByParent, onChange, level = 0 }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [mode, setMode] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const children = childrenByParent.get(comment.id) || [];
  const author = comment.author || {};
  const handle = author.x_handle || author.username;
  const removed = Boolean(comment.deleted_at);
  const own = comment.user_id === user?.id;
  const save = async event => {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    const result = mode === 'edit'
      ? await supabase.rpc('edit_x_comment', { p_comment_id: comment.id, p_content: text.trim() })
      : await supabase.from('comments').insert({ post_id: comment.post_id, parent_comment_id: comment.id, user_id: user.id, content: text.trim() });
    setBusy(false);
    if (result.error) {
      console.error('Falha ao salvar comentário', result.error);
      toast({ title: 'Não foi possível salvar o comentário. Tente novamente.', variant: 'destructive' });
    } else { setMode(null); setExpanded(true); void onChange(); }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('remove_x_comment', { p_comment_id: comment.id });
    setBusy(false);
    if (error) { console.error('Falha ao remover comentário', error); toast({ title: 'Não foi possível remover este comentário.', variant: 'destructive' }); }
    else { setMode(null); void onChange(); }
  };
  if (removed && children.length === 0) return null;
  return <article className="min-w-0 py-2" aria-label={removed ? 'Comentário removido' : `Comentário de ${author.x_username || author.full_name || 'cidadão'}`}>
    <div className="flex items-start gap-2 min-w-0">
      <img src={author.x_avatar_url || author.avatar_url || '/icon-192x192.png'} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <Link className="font-semibold break-all" to={`/services/x/profile/${handle || comment.user_id}`}>{author.x_username || author.full_name || 'Cidadão'}</Link>
          {handle && <span className="text-muted-foreground break-all">@{handle}</span>}
          <time dateTime={comment.created_at} className="text-muted-foreground">{new Date(comment.created_at).toLocaleString('pt-BR')}</time>
          {comment.edit_count > 0 && !removed && <span title={comment.edited_at && new Date(comment.edited_at).toLocaleString('pt-BR')}>Editado {comment.edit_count}x</span>}
        </div>
        <p className={`text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${removed ? 'italic text-muted-foreground' : ''}`}>{removed ? 'Este comentário foi removido.' : comment.content}</p>
        {!removed && user && <div className="flex flex-wrap gap-1 mt-1">
          <Button variant="ghost" size="sm" onClick={() => { setMode('reply'); setText(handle ? `@${handle} ` : ''); }}><CornerDownRight className="h-4 w-4 mr-1" />Responder</Button>
          {own && <Button variant="ghost" size="sm" aria-label="Editar comentário" onClick={() => { setMode('edit'); setText(comment.content); }}><Pencil className="h-4 w-4" /></Button>}
          {(own || user.role === 'Admin') && <Button variant="ghost" size="sm" aria-label="Remover comentário" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4 text-red-500" /></Button>}
        </div>}
      </div>
    </div>
    {mode && !removed && <form onSubmit={save} className="space-y-2 mt-2">
      <Textarea aria-label={mode === 'edit' ? 'Editar comentário' : 'Escrever resposta'} maxLength={10000} autoFocus rows={2} value={text} onChange={e => setText(e.target.value)} />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setMode(null)}><X className="h-4 w-4 mr-1" />Cancelar</Button><Button disabled={busy || !text.trim()} type="submit">{busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}{mode === 'edit' ? 'Salvar' : 'Responder'}</Button></div>
    </form>}
    {children.length > 0 && <><Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Ocultar' : 'Mostrar'} respostas ({children.length})</Button>{expanded && <div className={level < 2 ? 'pl-2 sm:pl-4 border-l border-border' : ''}>{children.map(child => <Comment key={child.id} comment={child} childrenByParent={childrenByParent} onChange={onChange} level={level + 1} />)}</div>}</>}
  </article>;
}
