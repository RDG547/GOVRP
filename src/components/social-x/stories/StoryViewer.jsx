import { usePhoneApp } from '@/contexts/PhoneAppContext';
import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX, Trash2, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

export default function StoryViewer({ stories, initialUserId, initialStoryIndex = 0, onClose, onAction, moderation=false }) {
  const allItems = stories.flatMap(group => group.stories.map(item => ({ ...item, author: group })));
  const [storyId, setStoryId] = useState(() => stories.find(group => group.user_id === initialUserId)?.stories[0]?.id || stories[initialStoryIndex]?.stories[0]?.id);
  const item = allItems.find(entry => entry.id === storyId);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const video = useRef(null);
  const { user } = useAuth();
    const phone = usePhoneApp();
  const { toast } = useToast();
  const next = () => { const i = allItems.findIndex(entry => entry.id === storyId); if (i >= 0 && allItems[i + 1]) setStoryId(allItems[i + 1].id); else onClose(); };
  const previous = () => { const i = allItems.findIndex(entry => entry.id === storyId); if (i > 0) setStoryId(allItems[i - 1].id); };
  const advance = useRef(next); advance.current = next;
  useEffect(() => {
    if (!item || paused || confirming || deleting || item.media_type === 'video') return undefined;
    const timer = setTimeout(() => advance.current(), 5000);
    return () => clearTimeout(timer);
  }, [storyId, Boolean(item), paused, confirming, deleting, item?.media_type]);
  useEffect(() => {
    if (!video.current) return;
    if (paused || confirming) video.current.pause(); else void video.current.play().catch(() => {});
  }, [paused, confirming, storyId]);
  const remove = async () => {
    if (!item || deleting) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc('delete_story', { p_story_id: item.id });
      if (error || data?.success === false) throw error || new Error(data.message);
      await onAction?.();
      setConfirming(false);
      toast({ title: 'Story removido' });
    } catch (error) {
      console.error('Falha ao excluir Story', error);
      toast({ title: 'Não foi possível excluir o Story', description: error.message, variant: 'destructive' });
    } finally { setDeleting(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !deleting) onClose(); }}>
    <DialogContent aria-label="Visualizador de Stories" className="max-w-[400px] p-0 overflow-hidden border-0 bg-black backdrop-blur-none [&>button]:hidden" onKeyDown={event => {
      if (confirming) return;
      if (event.key === 'ArrowRight') next();
      if (event.key === 'ArrowLeft') previous();
      if (event.key === ' ') { event.preventDefault(); setPaused(value => !value); }
    }}>
      <DialogTitle className="sr-only">Story de {item?.author.author_username || 'cidadão'}</DialogTitle>
      <DialogDescription className="sr-only">Use as setas para navegar e espaço para pausar.</DialogDescription>
      <div className="relative aspect-[9/16] max-h-[85dvh] bg-black text-white">
        {item ? <>
          {['image', 'gif'].includes(item.media_type) && <img src={item.media_url} alt={`Story de ${item.author.author_username}`} className="w-full h-full object-contain" />}
          {item.media_type === 'video' && <video key={item.id} ref={video} src={item.media_url} className="w-full h-full object-contain" autoPlay playsInline muted={muted} onEnded={next} />}
          {item.media_type === 'text' && <div className="w-full h-full flex items-center justify-center p-8" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(item.media_url) ? item.media_url : '#3b82f6' }}><p className="break-words whitespace-pre-wrap text-xl sm:text-2xl font-bold text-center">{item.content}</p></div>}
        </> : <div role="status" className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center"><p>Este Story foi removido ou expirou.</p><Button onClick={onClose}>Voltar aos Stories</Button></div>}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2 bg-gradient-to-b from-black/80 to-transparent">
          <span className="truncate text-sm font-medium">{item?.author.author_username}</span>
          <div className="flex shrink-0 gap-1">
            {item && <Button size="icon" variant="ghost" aria-label={paused ? 'Reproduzir Story' : 'Pausar Story'} onClick={() => setPaused(value => !value)} className="min-h-11 min-w-11">{paused ? <Play /> : <Pause />}</Button>}
            {item?.media_type === 'video' && <Button size="icon" variant="ghost" aria-label={muted ? 'Ativar som' : 'Silenciar'} onClick={() => setMuted(value => !value)} className="min-h-11 min-w-11">{muted ? <VolumeX /> : <Volume2 />}</Button>}
            <Button size="icon" variant="ghost" aria-label="Fechar Story" onClick={onClose} className="min-h-11 min-w-11"><X /></Button>
          </div>
        </div>
        {item && <div className="absolute inset-x-0 bottom-3 flex items-center justify-between gap-3 px-3">
          <Button size="icon" variant="secondary" aria-label="Story anterior" onClick={previous} className="min-h-11 min-w-11"><ChevronLeft /></Button>
          {(user?.id === item.author.user_id || (!phone && (user?.role === 'Admin'||(moderation&&user?.is_platform_admin)))) && <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogTrigger asChild><Button variant="destructive" size="icon" aria-label="Excluir Story" className="min-h-11 min-w-11"><Trash2 /></Button></AlertDialogTrigger>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir Story?</AlertDialogTitle><AlertDialogDescription>{user?.id === item.author.user_id ? 'Este Story será removido permanentemente.' : 'A remoção será registrada e o autor será notificado.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={deleting} onClick={event => { event.preventDefault(); void remove(); }}>{deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Excluir Story</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
          </AlertDialog>}
          <Button size="icon" variant="secondary" aria-label="Próximo Story" onClick={next} className="min-h-11 min-w-11"><ChevronRight /></Button>
        </div>}
      </div>
    </DialogContent>
  </Dialog>;
}
