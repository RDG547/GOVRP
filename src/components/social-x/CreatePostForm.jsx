import React, { useState, useRef, forwardRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Loader2, Send, X, Image as ImageIcon, Video } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const CreatePostForm = forwardRef(({ onPostCreated }, ref) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [postContent, setPostContent] = useState('');
    const [postMedia, setPostMedia] = useState(null);
    const [mediaPreview, setMediaPreview] = useState(null);
    const [mediaType, setMediaType] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef(null);

    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionSuggestions, setMentionSuggestions] = useState([]);
    const [isMentionPopoverOpen, setIsMentionPopoverOpen] = useState(false);
    const [cursorPosition, setCursorPosition] = useState(0);

    const fetchMentionSuggestions = useCallback(async (query) => {
        if (query.length < 2) {
            setMentionSuggestions([]);
            return;
        }
        const { data, error } = await supabase
            .from('profiles')
            .select('x_handle, x_username, x_avatar_url')
            .ilike('x_handle', `%${query}%`)
            .not('id', 'eq', user.id)
            .limit(5);

        if (error) {
            console.error('Error fetching mention suggestions:', error);
        } else {
            setMentionSuggestions(data);
        }
    }, [user.id]);

    const handleTextChange = (e) => {
        const content = e.target.value;
        setPostContent(content);

        const currentCursorPosition = e.target.selectionStart;
        setCursorPosition(currentCursorPosition);
        const textBeforeCursor = content.substring(0, currentCursorPosition);
        const mentionMatch = textBeforeCursor.match(/@(\w+)$/);

        if (mentionMatch) {
            const query = mentionMatch[1];
            setMentionQuery(query);
            setIsMentionPopoverOpen(true);
            fetchMentionSuggestions(query);
        } else {
            setIsMentionPopoverOpen(false);
            setMentionSuggestions([]);
        }
    };

    const handleMentionSelect = (handle) => {
        const textBeforeMention = postContent.substring(0, cursorPosition - mentionQuery.length - 1);
        const textAfterMention = postContent.substring(cursorPosition);
        const newContent = `${textBeforeMention}@${handle} ${textAfterMention}`;
        setPostContent(newContent);
        setIsMentionPopoverOpen(false);
        setMentionSuggestions([]);
        ref.current.focus();
    };

    const handleMediaSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.type.startsWith('video/')) {
                if (file.size > 180 * 1024 * 1024) { // 180MB limit for ~3 min video
                    toast({ title: 'Vídeo muito grande', description: 'O vídeo não pode exceder 3 minutos (aprox. 180MB).', variant: 'destructive' });
                    return;
                }
                setMediaType('video');
            } else if (file.type.startsWith('image/gif')) {
                setMediaType('gif');
            } else if (file.type.startsWith('image/')) {
                setMediaType('image');
            } else {
                toast({ title: 'Arquivo inválido', description: 'Por favor, selecione uma imagem, GIF ou vídeo.', variant: 'destructive' });
                return;
            }
            setPostMedia(file);
            setMediaPreview(URL.createObjectURL(file));
        }
    };
    
    const removeMedia = () => {
        setPostMedia(null);
        setMediaPreview(null);
        setMediaType(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }

    const handlePostSubmit = async (e) => {
        e.preventDefault();
        if (!postContent.trim() && !postMedia) return;
        setIsSubmitting(true);
        let mediaUrl = null;

        if (postMedia) {
            const bucket = mediaType === 'video' ? 'post-videos' : 'post-images';
            const fileName = `${user.id}/${Date.now()}_${postMedia.name}`;
            const { data: uploadData, error: uploadError } = await supabase.storage.from(bucket).upload(fileName, postMedia);
            if (uploadError) {
                toast({ title: `Erro no upload d${mediaType === 'video' ? 'o vídeo' : 'a imagem'}`, description: uploadError.message, variant: "destructive" });
                setIsSubmitting(false); return;
            }
            const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(uploadData.path);
            mediaUrl = urlData.publicUrl;
        }

        const { data: newPost, error } = await supabase.from('posts').insert({ 
            content: postContent, 
            user_id: user.id, 
            image_url: mediaUrl,
            metadata: { type: mediaType }
        }).select('*, author:profiles!posts_user_id_fkey(*)').single();

        if (error) {
            toast({ title: 'Erro ao postar', description: error.message, variant: "destructive" });
        } else {
            setPostContent('');
            removeMedia();
            toast({ title: 'Sucesso!', description: 'Seu post foi publicado.' });
            onPostCreated(newPost);
        }
        setIsSubmitting(false);
    };

    return (
        <Card className="border-slate-700/50 mb-6">
            <form onSubmit={handlePostSubmit}>
                <CardContent className="p-4">
                    <div className="flex gap-4">
                        <img src={user.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="Seu avatar" className="w-12 h-12 rounded-full" />
                        <Popover open={isMentionPopoverOpen} onOpenChange={setIsMentionPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Textarea 
                                    ref={ref}
                                    id="main-post-textarea"
                                    value={postContent} 
                                    onChange={handleTextChange} 
                                    placeholder="O que está acontecendo?" 
                                    className="bg-transparent border-0 text-lg text-white focus-visible:ring-0 p-0" />
                            </PopoverTrigger>
                            <PopoverContent className="w-80 p-0">
                                {mentionSuggestions.length > 0 ? (
                                    <div className="flex flex-col">
                                        {mentionSuggestions.map(suggestion => (
                                            <button
                                                key={suggestion.x_handle}
                                                type="button"
                                                onClick={() => handleMentionSelect(suggestion.x_handle)}
                                                className="flex items-center gap-2 p-2 hover:bg-secondary text-left"
                                            >
                                                <img src={suggestion.x_avatar_url} alt={suggestion.x_handle} className="w-8 h-8 rounded-full" />
                                                <div>
                                                    <p className="font-bold">{suggestion.x_username}</p>
                                                    <p className="text-sm text-muted-foreground">@{suggestion.x_handle}</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-4 text-center text-sm text-muted-foreground">
                                        Nenhum usuário encontrado.
                                    </div>
                                )}
                            </PopoverContent>
                        </Popover>
                    </div>
                    {mediaPreview && (
                        <div className="relative mt-4 ml-16">
                            {(mediaType === 'image' || mediaType === 'gif') && <img src={mediaPreview} alt="Preview" className="rounded-lg max-h-80 w-auto" />}
                            {mediaType === 'video' && <video src={mediaPreview} controls className="rounded-lg max-h-80 w-auto" />}
                            <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-8 w-8 rounded-full" onClick={removeMedia}><X className="h-4 w-4" /></Button>
                        </div>
                    )}
                </CardContent>
                <CardFooter className="p-4 flex justify-between items-center border-t border-slate-700/50">
                    <div className="flex gap-1">
                        <input type="file" ref={fileInputRef} id="mediaUpload" accept="image/*,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska" onChange={handleMediaSelect} className="hidden" />
                        <Button type="button" variant="ghost" size="icon" className="text-blue-400 hover:text-blue-300" onClick={() => fileInputRef.current.click()}><ImageIcon /></Button>
                        <Button type="button" variant="ghost" size="icon" className="text-blue-400 hover:text-blue-300" onClick={() => fileInputRef.current.click()}><Video /></Button>
                    </div>
                    <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : <><Send className="w-4 h-4 mr-2" /> Postar</>}</Button>
                </CardFooter>
            </form>
        </Card>
    );
});

export default CreatePostForm;