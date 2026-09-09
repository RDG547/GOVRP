import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Repeat2, Heart, Upload, MoreHorizontal, Trash2, Edit, Crown, Shield, Scale, Loader2, Check, Send, Copy, Share2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import RepostModal from './RepostModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { invalidateDomain } from '@/lib/realtime';
import { normalizeSafeUrl, openUrlInNewTab } from '@/lib/security';

const roleBadges = {
    'Fundador': { icon: Crown, color: 'text-yellow-400', label: 'Fundador da Plataforma' },
    'Presidente': { icon: Shield, color: 'text-blue-400', label: 'Presidente' },
    'Vice-Presidente': { icon: Crown, color: 'text-amber-300', label: 'Vice-Presidente da República' },
    'Deputado': { icon: Scale, color: 'text-green-400', label: 'Deputado' },
    'Senador': { icon: Scale, color: 'text-red-400', label: 'Senador' },
    'Presidente da Câmara': { icon: Scale, color: 'text-sky-300', label: 'Presidente da Câmara dos Deputados' },
    'Presidente da Câmara dos Deputados': { icon: Scale, color: 'text-sky-300', label: 'Presidente da Câmara dos Deputados' },
    'Vice-Presidente da Câmara dos Deputados': { icon: Scale, color: 'text-cyan-300', label: 'Vice-Presidente da Câmara dos Deputados' },
    'Presidente do Senado': { icon: Scale, color: 'text-indigo-300', label: 'Presidente do Senado' },
    'Vice-Presidente do Senado': { icon: Scale, color: 'text-violet-300', label: 'Vice-Presidente do Senado' },
    'Vice-Presidente do Senado Federal': { icon: Scale, color: 'text-violet-300', label: 'Vice-Presidente do Senado' },
    'Presidente do STF': { icon: Scale, color: 'text-zinc-200', label: 'Presidente do STF' },
};

const PoliticalSeal = ({ role }) => {
    const badge = roleBadges[role];
    if (!badge) return null;
    const { icon: Icon, color, label } = badge;

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    if (isMobile) {
        return (
            <Popover>
                <PopoverTrigger asChild>
                    <button className="focus:outline-none ml-1 no-navigate" onClick={(e) => e.stopPropagation()}>
                        <Icon className={`w-4 h-4 ${color}`} />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto text-sm p-2" onClick={(e) => e.stopPropagation()}>
                    {label}
                </PopoverContent>
            </Popover>
        );
    }

    return (
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="focus:outline-none ml-1 no-navigate" onClick={(e) => e.stopPropagation()}>
                <Icon className={`w-4 h-4 ${color}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{label}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
}

const InlineComments = ({ postId, currentCount }) => {
    const [comments, setComments] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchComments = async () => {
            if (currentCount === 0) { setComments([]); setLoading(false); return; }
            setLoading(true);
            const { data, error } = await supabase
                .from('comments')
                .select('*, author:profiles!comments_user_id_fkey(id,full_name,x_username,x_handle,x_avatar_url)')
                .eq('post_id', postId)
                .is('parent_comment_id', null)
                .order('created_at', { ascending: true })
                .limit(5); // Show only top 5 comments inline

            if (!error && data) {
                setComments(data);
            }
            setLoading(false);
        };
        fetchComments();
    }, [postId, currentCount]);

    if (loading) return <div className="flex justify-center p-2"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
    if (comments.length === 0) return null;

    return (
        <div className="space-y-3 mt-2 max-h-60 overflow-y-auto custom-scrollbar no-navigate p-1">
            {comments.map((comment) => (
                <div key={comment.id} className="flex gap-2">
                    <img src={comment.author?.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${comment.author?.x_handle}`} alt="Avatar" className="w-8 h-8 rounded-full bg-secondary" />
                    <div className="flex-1 max-w-[calc(100%-2.5rem)]">
                        <div className="bg-muted/30 p-2 rounded-lg break-words">
                            <div className="flex items-center gap-1 text-xs mb-1">
                                <span className="font-bold text-foreground truncate">{comment.author?.full_name}</span>
                                <span className="text-muted-foreground truncate">@{comment.author?.x_handle}</span>
                            </div>
                            <p className="text-sm text-foreground whitespace-pre-wrap">{comment.content}</p>
                        </div>
                    </div>
                </div>
            ))}
            {currentCount > 5 && (
                <p className="text-xs text-primary font-medium text-center italic mt-2">Visite o post para ver mais comentários.</p>
            )}
        </div>
    );
};

const PostCard = ({ post, onPostUpdate, onPostDelete, onRepostCreated }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const navigate = useNavigate();
    const [isLiked, setIsLiked] = useState(post.is_liked_by_user);
    const [isReposted, setIsReposted] = useState(post.is_reposted_by_user);
    const [likesCount, setLikesCount] = useState(post.likes_count || 0);
    const [repostsCount, setRepostsCount] = useState(post.reposts_count || 0);
    const [commentsCount, setCommentsCount] = useState(post.comments_count || 0);
    const [isCommenting, setIsCommenting] = useState(false);
    const [commentContent, setCommentContent] = useState('');
    const [isSubmittingComment, setIsSubmittingComment] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(post.original_post_id || post.original_post ? (post.quote_content || '') : post.content);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [isRepostModalOpen, setIsRepostModalOpen] = useState(false);
    const dropdownJustClosed = useRef(false);

    const interactionBusy = useRef(false);
    useEffect(() => { setIsLiked(Boolean(post.is_liked_by_user)); }, [post.is_liked_by_user]);
    useEffect(() => { setIsReposted(Boolean(post.is_reposted_by_user)); }, [post.is_reposted_by_user]);
    useEffect(() => { setLikesCount(post.likes_count || 0); }, [post.likes_count]);
    useEffect(() => { setRepostsCount(post.reposts_count || 0); }, [post.reposts_count]);
    useEffect(() => { setCommentsCount(post.comments_count || 0); }, [post.comments_count]);

    const author = post.author;
    const handle = author?.x_handle;
    const name = author?.x_username;
    const avatar = author?.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${handle}`;

    const postDateTime = format(new Date(post.created_at), "dd/MM/yyyy, HH:mm", { locale: ptBR });

    const handleInteraction = async (action) => {
        if (!user) {
            toast({ title: 'Ação necessária', description: 'Você precisa estar logado para interagir.', variant: 'destructive' });
            return;
        }

        if (action === 'comment') { setIsCommenting(prev => !prev); return; }
        if (action === 'repost' && !isReposted) { setIsRepostModalOpen(true); return; }
        if (interactionBusy.current) return;
        interactionBusy.current = true;
        const previous = { isLiked, likesCount, isReposted, repostsCount };
        if (action === 'like') { setIsLiked(!isLiked); setLikesCount(Math.max(0, likesCount + (isLiked ? -1 : 1))); }
        else { setIsReposted(false); setRepostsCount(Math.max(0, repostsCount - 1)); }
        try {
            const { error } = await supabase.rpc(action === 'like' ? 'toggle_like' : 'delete_repost', action === 'like' ? { p_post_id: post.id } : { p_original_post_id: post.id });
            if (error) throw error;
            invalidateDomain('x-posts');
        } catch {
            setIsLiked(previous.isLiked); setLikesCount(previous.likesCount);
            setIsReposted(previous.isReposted); setRepostsCount(previous.repostsCount);
            toast({ title: 'Não foi possível concluir', description: 'Sua alteração não foi salva. Tente novamente.', variant: 'destructive' });
        } finally { interactionBusy.current = false; }
    };

    const handleCommentSubmit = async (e) => {
        e.preventDefault();
        if (!commentContent.trim()) return;
        setIsSubmittingComment(true);
        const { error } = await supabase.from('comments').insert({
            post_id: post.id,
            user_id: user.id,
            content: commentContent
        });
        setIsSubmittingComment(false);
        if (error) {
            toast({ title: "Erro ao comentar", description: error.message, variant: "destructive" });
        } else {
            setCommentContent('');
            setIsCommenting(false);
            setCommentsCount(prev => prev + 1);
            toast({ title: "Sucesso!", description: "Seu comentário foi publicado." });
            if(onPostUpdate) onPostUpdate(post.id, { comments_count: commentsCount + 1 });
        }
    };

    const handleReposted = () => {
      setIsReposted(true);
      setRepostsCount(p => p + 1);
      if(onRepostCreated) onRepostCreated();
    }

    const handleDelete = async (event) => {
        event?.stopPropagation();
        if (user.id !== post.user_id && user.role !== 'Admin') return;
        try {
            const { data, error } = await supabase.rpc('delete_post', { p_post_id: post.id });
            if (error || !data?.success) throw new Error(data?.message || error.message);
            toast({ title: 'Sucesso', description: 'Post excluído com sucesso.' });
            if (onPostDelete) onPostDelete(post.id);
        } catch (error) {
            toast({ title: 'Erro', description: `Não foi possível excluir o post: ${error.message}`, variant: 'destructive' });
        }
    };

    const handleEdit = async () => {
        if (editedContent === (post.original_post_id || post.original_post ? (post.quote_content || '') : post.content)) {
            setIsEditing(false);
            return;
        }
        setIsSavingEdit(true);
        const { data, error } = await supabase.rpc('update_post', {
            p_post_id: post.id,
            p_new_content: editedContent
        });

        if (error || !data?.success) {
            toast({ title: 'Erro ao editar', description: data?.message || error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso', description: 'Post atualizado.' });
            if (onPostUpdate) onPostUpdate(post.id, { ...(post.original_post_id || post.original_post ? { quote_content: editedContent } : { content: editedContent }), updated_at: new Date().toISOString() });
            setIsEditing(false);
        }
        setIsSavingEdit(false);
    };

    const handleCopyLink = () => {
        const url = `${window.location.origin}/services/x/post/${post.id}`;
        navigator.clipboard.writeText(url);
        toast({ title: 'Link copiado!', description: 'O link para o post foi copiado para a área de transferência.' });
    };

    const handleSocialShare = (platform) => {
        const url = encodeURIComponent(`${window.location.origin}/services/x/post/${post.id}`);
        const text = encodeURIComponent(post.content.substring(0, 100) + '...');
        let shareUrl = '';
        switch(platform) {
            case 'twitter':
                shareUrl = `https://twitter.com/intent/tweet?url=${url}&text=${text}`;
                break;
            case 'facebook':
                shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
                break;
            case 'whatsapp':
                shareUrl = `https://api.whatsapp.com/send?text=${text}%20${url}`;
                break;
            default: return;
        }
        if (!openUrlInNewTab(shareUrl)) {
            toast({ title: 'Erro ao compartilhar', description: 'Não foi possível abrir a janela de compartilhamento.', variant: 'destructive' });
        }
    };

    const renderContent = (content) => {
      if (!content) return null;
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const mentionRegex = /@(\w+)/g;
      const hashtagRegex = /(#\w+)/g;

      const parts = content.split(new RegExp(`(${urlRegex.source}|${mentionRegex.source}|${hashtagRegex.source})`, 'g'));

      return parts.filter(part => part !== undefined && part !== null && part !== '').map((part, index) => {
        if (part.match(urlRegex)) {
          const safeUrl = normalizeSafeUrl(part);
          if (!safeUrl) return part;
          return <a key={index} href={safeUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{part}</a>;
        }
        if (part.match(mentionRegex)) {
          const handle = part.substring(1);
          return <Link key={index} to={`/services/x/profile/${handle}`} className="text-blue-400 font-semibold hover:underline">{part}</Link>;
        }
        if (part.match(hashtagRegex)) {
          const tag = part.substring(1);
          return <Link key={index} to={`/services/x/search?q=${tag}`} className="text-blue-400 hover:underline">{part}</Link>;
        }
        return part;
      });
    };

    const OriginalPost = ({ original }) => (
      <div className="border border-border rounded-lg p-3 mt-2 flex gap-3">
        <img src={original.author.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${original.author.x_handle}`} alt={original.author.x_username} className="w-6 h-6 rounded-full"/>
        <div className="w-full">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <span className="font-bold text-foreground truncate">{original.author.x_username}</span>
            <span className="truncate">@{original.author.x_handle}</span>
            <span>· {format(new Date(original.created_at), "dd/MM/yy", { locale: ptBR })}</span>
          </div>
          <p className="text-foreground text-sm whitespace-pre-wrap">{renderContent(original.content)}</p>
          {original.image_url && <img src={original.image_url} alt="Post media" className="mt-2 rounded-lg max-h-60 w-full object-cover" />}
        </div>
      </div>
    );

    const baseTitles = author.titles || [];
    const displayedTitles = author.role === 'Admin' ? ['Fundador', ...baseTitles] : baseTitles;
    const uniqueTitles = [...new Set(displayedTitles)].filter(title => roleBadges[title]);

    const mediaType = post.metadata?.type;

    const ActionButton = ({ icon: Icon, label, count, onClick, active, activeColor, hoverColor }) => (
        <motion.div whileTap={{ scale: 0.95 }} className="flex-1">
            <button
              className={`flex flex-col items-center justify-center w-full group text-muted-foreground ${hoverColor}`}
              onClick={onClick}
            >
                <div className={`p-2 rounded-full group-hover:bg-opacity-10 ${active ? activeColor.replace('text-', 'bg-') + '/10' : ''}`}>
                    <Icon className={`w-5 h-5 ${active ? activeColor : ''} ${active && label === 'Curtir' ? 'fill-current' : ''}`} />
                </div>
                <span className={`text-xs ${active ? activeColor : ''}`}>
                    {label} ({count})
                </span>
            </button>
        </motion.div>
    );

    const handleCardClick = (e) => {
        if(dropdownJustClosed.current) return;
        if(e.target.closest('a, button, .no-navigate, textarea')) {
            return;
        }
        navigate(`/services/x/post/${post.id}`);
    }

    const handleDropdownOpenChange = (open) => {
        if (!open) {
            dropdownJustClosed.current = true;
            setTimeout(() => { dropdownJustClosed.current = false; }, 300);
        }
    };

    return (
        <>
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="border-b border-border p-4 flex space-x-4 hover:bg-muted/30 transition-colors duration-200 cursor-pointer"
            onClick={handleCardClick}
        >
            <Link to={`/services/x/profile/${handle}`} className="no-navigate"><img src={avatar} alt={name} className="w-12 h-12 rounded-full bg-secondary" /></Link>
            <div className="flex-1">
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <div className="flex items-center">
                            <Link to={`/services/x/profile/${handle}`} className="font-bold text-foreground hover:underline no-navigate">
                                {name}
                            </Link>
                            {uniqueTitles.map(title => <PoliticalSeal key={title} role={title} />)}
                        </div>
                        <p className="text-sm text-muted-foreground">@{handle} · {postDateTime}</p>
                    </div>
                    {(user?.id === post.user_id || user?.role === 'Admin') && (
                        <DropdownMenu onOpenChange={handleDropdownOpenChange}>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="w-8 h-8 no-navigate"><MoreHorizontal className="w-5 h-5 text-muted-foreground" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent onClick={event => event.stopPropagation()}>
                                {user.id === post.user_id && <DropdownMenuItem onClick={() => (setEditedContent(post.original_post_id || post.original_post ? (post.quote_content || '') : post.content), setIsEditing(true))}><Edit className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>}
                                <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive focus:bg-destructive/10"><Trash2 className="mr-2 h-4 w-4" />Excluir</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
                {isEditing ? (
                    <div className="mt-2 no-navigate">
                        <Textarea value={editedContent} onChange={(e) => setEditedContent(e.target.value)} className="bg-background border-border" />
                        <div className="flex justify-end gap-2 mt-2">
                            <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>Cancelar</Button>
                            <Button size="sm" onClick={handleEdit} disabled={isSavingEdit}>
                                {isSavingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="text-foreground whitespace-pre-wrap mt-1">
                        {post.quote_content && <p className="mb-2">{renderContent(post.quote_content)}</p>}
                        {post.content !== 'repost' && <p>{renderContent(post.content)}</p>}
                    </div>
                )}
                {post.image_url && (
                    <div className="mt-3 rounded-xl border border-border max-h-96 w-full overflow-hidden">
                        {mediaType === 'video' ? (
                            <video src={post.image_url} controls className="w-full h-full object-cover no-navigate" onClick={(e) => e.stopPropagation()} />
                        ) : mediaType === 'gif' ? (
                             <img src={post.image_url} alt="Post media" className="w-full h-full object-contain" />
                        ) : (
                            <img src={post.image_url} alt="Post media" className="w-full h-full object-cover" />
                        )}
                    </div>
                )}
                {post.original_post && <OriginalPost original={post.original_post} />}

                <div className="flex justify-around items-center mt-4 no-navigate">
                    <ActionButton icon={MessageCircle} label="Comentar" count={commentsCount} onClick={(e) => {e.stopPropagation(); handleInteraction('comment')}} active={isCommenting} activeColor="text-blue-500" hoverColor="hover:text-blue-500"/>
                    <ActionButton icon={Repeat2} label="Repostar" count={repostsCount} onClick={(e) => {e.stopPropagation(); handleInteraction('repost')}} active={isReposted} activeColor="text-green-500" hoverColor="hover:text-green-500"/>
                    <ActionButton icon={Heart} label="Curtir" count={likesCount} onClick={(e) => {e.stopPropagation(); handleInteraction('like')}} active={isLiked} activeColor="text-red-500" hoverColor="hover:text-red-500"/>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <motion.button whileTap={{ scale: 0.95 }} className="flex items-center justify-center gap-2 flex-1 group text-muted-foreground hover:text-yellow-500">
                                <div className="p-2 rounded-full"><Upload className="w-5 h-5" /></div>
                            </motion.button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem onClick={handleCopyLink}><Copy className="mr-2 h-4 w-4" />Copiar Link</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleSocialShare('twitter')}><Share2 className="mr-2 h-4 w-4" />Compartilhar no X (Twitter)</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleSocialShare('facebook')}><Share2 className="mr-2 h-4 w-4" />Compartilhar no Facebook</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleSocialShare('whatsapp')}><Share2 className="mr-2 h-4 w-4" />Compartilhar no WhatsApp</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <AnimatePresence>
                    {isCommenting && (
                        <motion.div
                            initial={{ opacity: 0, height: 0, marginTop: 0 }}
                            animate={{ opacity: 1, height: 'auto', marginTop: '1rem' }}
                            exit={{ opacity: 0, height: 0, marginTop: 0 }}
                            className="overflow-hidden space-y-4"
                            onClick={(e) => e.stopPropagation()} // Prevent card click navigation
                        >
                            <InlineComments postId={post.id} currentCount={commentsCount} />
                            <form onSubmit={handleCommentSubmit} className="flex items-start gap-2 pt-2 border-t border-border mt-2">
                                <img src={user.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${user.x_handle}`} alt="Seu avatar" className="w-8 h-8 rounded-full mt-1" />
                                <div className="flex-1">
                                  <Textarea
                                      placeholder={`Respondendo a @${handle}`}
                                      value={commentContent}
                                      onChange={(e) => setCommentContent(e.target.value)}
                                      className="w-full"
                                      rows={2}
                                  />
                                  <div className="flex justify-end mt-2">
                                      <Button type="submit" size="sm" disabled={isSubmittingComment || !commentContent.trim()}>
                                          {isSubmittingComment ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                                          Comentar
                                      </Button>
                                  </div>
                                </div>
                            </form>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
        <RepostModal open={isRepostModalOpen} onOpenChange={setIsRepostModalOpen} post={post} onReposted={handleReposted} />
        </>
    );
};

export default PostCard;
