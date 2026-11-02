import {Input} from '@/components/ui/input';
import {GovSelect} from '@/components/ui/gov-select';
import React, { useEffect, useState, useRef, forwardRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Loader2, Send, X, Image as ImageIcon, Video } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { publishPresidentPostNews } from '@/lib/newsPublisher';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    ACCEPTED_IMAGE_EXTENSIONS,
    ACCEPTED_IMAGE_MIME_TYPES,
    ACCEPTED_VIDEO_EXTENSIONS,
    ACCEPTED_VIDEO_MIME_TYPES,
    IMAGE_ACCEPT_ATTRIBUTE,
    MAX_POST_VIDEO_UPLOAD_BYTES,
    MAX_SOCIAL_IMAGE_UPLOAD_BYTES,
    VIDEO_ACCEPT_ATTRIBUTE,
    buildStoragePath,
    validateSelectedFile,
} from '@/lib/security';

const CreatePostForm = forwardRef(({ onPostCreated }, ref) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [postContent, setPostContent] = useState('');
    const [postMedia, setPostMedia] = useState(null);
    const [mediaPreview, setMediaPreview] = useState(null);
    const [mediaType, setMediaType] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef(null);
    const [sponsored,setSponsored]=useState(false),[sponsor,setSponsor]=useState(''),[adKind,setAdKind]=useState(''),[sponsorParty,setSponsorParty]=useState(''),[parties,setParties]=useState([]);
    useEffect(()=>{if(sponsored&&adKind==='political')supabase.from('political_parties').select('id,name,acronym').neq('status','Encerrado').order('name').then(result=>{if(!result.error)setParties(result.data||[]);});},[sponsored,adKind]);

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
            .from('public_social_profiles')
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
        ref?.current?.focus();
    };

    const handleMediaSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.type.startsWith('video/')) {
                const validation = validateSelectedFile(file, {
                    allowedMimeTypes: ACCEPTED_VIDEO_MIME_TYPES,
                    allowedExtensions: ACCEPTED_VIDEO_EXTENSIONS,
                    maxBytes: MAX_POST_VIDEO_UPLOAD_BYTES,
                    label: 'vídeo',
                });
                if (!validation.ok) {
                    toast({ title: 'Arquivo inválido', description: validation.error, variant: 'destructive' });
                    if (fileInputRef.current) fileInputRef.current.value = '';
                    return;
                }
                setMediaType('video');
            } else if (file.type.startsWith('image/gif')) {
                const validation = validateSelectedFile(file, {
                    allowedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES,
                    allowedExtensions: ACCEPTED_IMAGE_EXTENSIONS,
                    maxBytes: MAX_SOCIAL_IMAGE_UPLOAD_BYTES,
                    label: 'imagem',
                });
                if (!validation.ok) {
                    toast({ title: 'Arquivo inválido', description: validation.error, variant: 'destructive' });
                    if (fileInputRef.current) fileInputRef.current.value = '';
                    return;
                }
                setMediaType('gif');
            } else if (file.type.startsWith('image/')) {
                const validation = validateSelectedFile(file, {
                    allowedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES,
                    allowedExtensions: ACCEPTED_IMAGE_EXTENSIONS,
                    maxBytes: MAX_SOCIAL_IMAGE_UPLOAD_BYTES,
                    label: 'imagem',
                });
                if (!validation.ok) {
                    toast({ title: 'Arquivo inválido', description: validation.error, variant: 'destructive' });
                    if (fileInputRef.current) fileInputRef.current.value = '';
                    return;
                }
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
        if (isSubmitting || (!postContent.trim() && !postMedia)) return;
        if(sponsored&&(!adKind||sponsor.trim().length<3)){toast({title:'Complete a identificação da publicidade',description:'Informe o patrocinador e o tipo de anúncio.',variant:'destructive'});return;}
        setIsSubmitting(true);
        let mediaUrl = null;
        try {
            if (postMedia) {
                const bucket = mediaType === 'video' ? 'post-videos' : 'post-images';
                const fileName = buildStoragePath({ prefix: '', entityId: user.id, fileName: postMedia.name });
                const { data: uploadData, error: uploadError } = await supabase.storage.from(bucket).upload(
                    fileName,
                    postMedia,
                    {
                        upsert: false,
                        contentType: postMedia.type,
                    },
                );
                if (uploadError) {
                    throw new Error(/manutenção/i.test(uploadError.message || '')
                        ? 'O GOVRP está em manutenção. Tente publicar novamente em instantes.'
                        : `Erro no upload d${mediaType === 'video' ? 'o vídeo' : 'a imagem'}: ${uploadError.message}`);
                }
                const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(uploadData.path);
                mediaUrl = urlData.publicUrl;
            }

            const { data: newPost, error } = await supabase.from('posts').insert({
                content: postContent,
                user_id: user.id,
                image_url: mediaUrl,
                metadata: { type: mediaType,...(sponsored?{sponsored:true,sponsor_name:sponsor.trim(),ad_kind:adKind,sponsor_party_id:sponsorParty||null}:{}) }
            }).select('id,user_id,content,image_url,metadata,created_at').single();

            if (error) throw error;
            setPostContent('');setSponsored(false);setSponsor('');setAdKind('');setSponsorParty('');
            removeMedia();
            toast({ title: 'Sucesso!', description: 'Seu post foi publicado.' });
            onPostCreated?.(newPost);

            const effectiveRoles = Array.isArray(user?.effective_roles) ? user.effective_roles : [user?.role].filter(Boolean);
            if (effectiveRoles.includes('Presidente')) {
                try {
                    await publishPresidentPostNews(supabase, {
                        post: newPost, authorName: user.full_name, authorId: user.id,
                    });
                } catch (newsErr) {
                    console.error('Erro ao publicar notícia presidencial:', newsErr);
                }
            }
        } catch (error) {
            console.error('[GOVRP X] Falha na publicação', {
                code: error?.code || null,
                status: error?.status || error?.statusCode || null,
            });
            toast({
                title: 'Não foi possível publicar',
                description: error?.message || 'O serviço de publicação não respondeu. Seu texto e arquivo foram preservados nesta tela.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
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
                <div className="space-y-3 px-4 pb-4"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={sponsored} onChange={event=>setSponsored(event.target.checked)}/>Esta publicação contém publicidade ou patrocínio</label>{sponsored&&<div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"><label className="text-sm">Patrocinador<Input value={sponsor} onChange={event=>setSponsor(event.target.value)} required minLength={3} placeholder="Nome do responsável pelo anúncio"/></label><label className="text-sm">Tipo de publicidade<GovSelect value={adKind} onChange={event=>setAdKind(event.target.value)}><option value="">Selecione</option><option value="commercial">Comercial</option><option value="political">Política</option><option value="institutional">Institucional</option></GovSelect></label>{adKind==='political'&&<label className="text-sm sm:col-span-2">Partido responsável<GovSelect value={sponsorParty} onChange={event=>setSponsorParty(event.target.value)}><option value="">Selecione o partido</option>{parties.map(party=><option key={party.id} value={party.id}>{party.name} ({party.acronym})</option>)}</GovSelect></label>}<p className="text-xs text-muted-foreground sm:col-span-2">A identificação aparecerá na publicação. As normas vigentes podem estabelecer condições ou restrições ao anúncio.</p></div>}</div>
                <CardFooter className="p-4 flex justify-between items-center border-t border-slate-700/50">
                    <div className="flex gap-1">
                        <input type="file" ref={fileInputRef} id="mediaUpload" accept={`${IMAGE_ACCEPT_ATTRIBUTE},${VIDEO_ACCEPT_ATTRIBUTE}`} onChange={handleMediaSelect} className="hidden" />
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
