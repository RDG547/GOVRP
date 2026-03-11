import React, { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Repeat2, Heart, Upload, MoreHorizontal, Trash2, Edit, Crown, Shield, Scale, Loader2, Check, Send, Copy, Share2 } from 'lucide-react';
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

const roleBadges = {
    'Fundador': { icon: Crown, color: 'text-yellow-400', label: 'Fundador da Plataforma' },
    'Presidente': { icon: Shield, color: 'text-blue-400', label: 'Presidente' },
    'Deputado': { icon: Scale, color: 'text-green-400', label: 'Deputado' },
    'Senador': { icon: Scale, color: 'text-red-400', label: 'Senador' },
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
    const [editedContent, setEditedContent] = useState(post.content);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [isRepostModalOpen, setIsRepostModalOpen] = useState(false);
    const [isShared, setIsShared] = useState(false);

    const author = post.author;
    const handle = author?.x_handle;
    const name = author?.x_username;
    const avatar = author?.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${handle}`;
    
    const wasEdited = post.updated_at && new Date(post.updated_at) > new Date(post.created_at).setSeconds(new Date(post.created_at).getSeconds() + 10);
    const postDateTime = format(new Date(post.created_at), "dd/MM/yyyy, HH:mm", { locale: ptBR });

    const handleInteraction = async (action) => {
        if (!user) {
            toast({ title: 'Ação necessária', description: 'Você precisa estar logado para interagir.', variant: 'destructive' });
            return;
        }

        switch (action) {
            case 'like':
                setIsLiked(!isLiked);
                setLikesCount(prev => isLiked ? prev - 1 : prev + 1);
                await supabase.rpc('toggle_like', { p_post_id: post.id });
                break;
            case 'repost':
                if (isReposted) {
                    setIsReposted(false);
                    setRepostsCount(prev => prev - 1);
                    await supabase.rpc('delete_repost', { p_original_post_id: post.id });
                    if (onPostDelete) onPostDelete(post.id);
                } else {
                    setIsRepostModalOpen(true);
                }
                break;
            case 'comment':
                setIsCommenting(prev => !prev);
                break;
            default:
                break;
        }
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

    const handleDelete = async () => {
        if (user.id !== post.user_id && user.role !== 'Admin') return;
        try {
            const { data, error } = await supabase.rpc('delete_post', { p_post_id: post.id });
            if (error || !data.success) throw new Error(data?.message || error.message);
            toast({ title: 'Sucesso', description: 'Post excluído com sucesso.' });
            if (onPostDelete) onPostDelete(post.id);
        } catch (error) {
            toast({ title: 'Erro', description: `Não foi possível excluir o post: ${error.message}`, variant: 'destructive' });
        }
    };

    const handleEdit = async () => {
        if (editedContent === post.content) {
            setIsEditing(false);
            return;
        }
        setIsSavingEdit(true);
        const { data, error } = await supabase.rpc('update_post', {
            p_post_id: post.id,
            p_new_content: editedContent
        });

        if (error || !data.success) {
            toast({ title: 'Erro ao editar', description: data?.message || error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso', description: 'Post atualizado.' });
            if (onPostUpdate) onPostUpdate(post.id, { content: editedContent, updated_at: new Date().toISOString() });
            setIsEditing(false);
        }
        setIsSavingEdit(false);
    };
    
    const handleCopyLink = () => {
        const url = `${window.location.origin}/services/x/post/${post.id}`;
        navigator.clipboard.writeText(url);
        setIsShared(true);
        toast({ title: 'Link copiado!', description: 'O link para o post foi copiado para a área de transferência.' });
        setTimeout(() => setIsShared(false), 2000);
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
        window.open(shareUrl, '_blank');
    };

    const renderContent = (content) => {
      if (!content) return null;
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const mentionRegex = /@(\w+)/g;
      const hashtagRegex = /(#\w+)/g;
  
      const parts = content.split(new RegExp(`(${urlRegex.source}|${mentionRegex.source}|${hashtagRegex.source})`, 'g'));
      
      return parts.map((part, index) => {
        if (part.match(urlRegex)) {
          return <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{part}</a>;
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
        if(e.target.closest('a, button, .no-navigate, textarea')) {
            return;
        }
        navigate(`/services/x/post/${post.id}`);
    }

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
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="w-8 h-8 no-navigate"><MoreHorizontal className="w-5 h-5 text-muted-foreground" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent>
                                {user.id === post.user_id && <DropdownMenuItem onClick={() => setIsEditing(true)}><Edit className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>}
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
                            className="overflow-hidden"
                        >
                            <form onSubmit={handleCommentSubmit} className="flex items-start gap-2">
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