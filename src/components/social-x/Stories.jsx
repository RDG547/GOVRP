import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Plus, X, Image as ImageIcon, FileImage as FileGif, Video, Trash2, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

const Stories = () => {
    const [stories, setStories] = useState([]);
    const [viewingStory, setViewingStory] = useState(null);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const { user } = useAuth();

    const fetchStories = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data: followingIds } = await supabase
            .from('followers')
            .select('following_id')
            .eq('follower_id', user.id);

        const idsToFetch = [user.id, ...(followingIds || []).map(f => f.following_id)];
        
        const { data, error } = await supabase.rpc('get_stories_by_user_ids', { p_user_ids: idsToFetch });

        if (error) {
            console.error('Error fetching stories:', error);
        } else {
            setStories(data || []);
        }
        setLoading(false);
    }, [user]);


    useEffect(() => {
        fetchStories();
    }, [fetchStories]);

    const handleStoryAction = () => {
        fetchStories();
        setViewingStory(null);
    };

    return (
        <>
            <div className="mb-4">
                <div className="flex items-center gap-3 overflow-x-auto pb-2 custom-scrollbar">
                    {loading ? (
                        <div className="flex items-center justify-center w-full h-24">
                            <Loader2 className="animate-spin text-primary" />
                        </div>
                    ) : (
                        <>
                            <button onClick={() => setIsUploadModalOpen(true)} className="flex-shrink-0 flex flex-col items-center justify-center w-20 h-24 text-center space-y-1">
                                <div className="w-16 h-16 rounded-full border-2 border-dashed border-primary flex items-center justify-center bg-secondary/50">
                                    <Plus className="text-primary" />
                                </div>
                                <span className="text-xs font-medium text-foreground">Adicionar</span>
                            </button>
                            {stories.map(story => (
                                <button key={story.user_id} onClick={() => setViewingStory(story)} className="flex-shrink-0 flex flex-col items-center justify-center w-20 h-24 text-center space-y-1">
                                    <div className="w-16 h-16 rounded-full p-0.5 bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-500">
                                        <div className="bg-background rounded-full p-0.5">
                                            <img src={story.author_avatar} alt={story.author_username} className="w-full h-full object-cover rounded-full" />
                                        </div>
                                    </div>
                                    <span className="text-xs font-medium text-foreground truncate w-full">{story.author_username}</span>
                                </button>
                            ))}
                        </>
                    )}
                </div>
            </div>

            {viewingStory && (
                <StoryViewer
                    storyData={viewingStory}
                    onClose={() => setViewingStory(null)}
                    onAction={handleStoryAction}
                    onNext={() => {
                        const currentIndex = stories.findIndex(s => s.user_id === viewingStory.user_id);
                        if (currentIndex < stories.length - 1) {
                            setViewingStory(stories[currentIndex + 1]);
                        } else {
                            setViewingStory(null);
                        }
                    }}
                    onPrev={() => {
                        const currentIndex = stories.findIndex(s => s.user_id === viewingStory.user_id);
                        if (currentIndex > 0) {
                            setViewingStory(stories[currentIndex - 1]);
                        }
                    }}
                />
            )}

            <UploadStoryModal
                isOpen={isUploadModalOpen}
                onOpenChange={setIsUploadModalOpen}
                onStoryCreated={handleStoryAction}
            />
        </>
    );
};

const StoryViewer = ({ storyData, onClose, onNext, onPrev, onAction }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
    const [progress, setProgress] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const videoRef = useRef(null);
    const timeoutRef = useRef(null);

    const currentStory = storyData.stories[currentStoryIndex];

    const handleDelete = async () => {
        const { data, error } = await supabase.rpc('delete_story', { p_story_id: currentStory.id });
        if (error || !data.success) {
            toast({ title: 'Erro ao excluir story', description: data?.message || error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Story excluído.' });
            onAction();
        }
    };

    const goToNextStory = useCallback(() => {
        if (currentStoryIndex < storyData.stories.length - 1) {
            setCurrentStoryIndex(i => i + 1);
        } else {
            onNext();
        }
    }, [currentStoryIndex, storyData.stories.length, onNext]);

    useEffect(() => {
        if (isPaused) return;

        setProgress(0);
        const timer = setInterval(() => {
            setProgress(p => p + 100 / 500);
        }, 10);

        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(goToNextStory, 5000);

        return () => {
            clearInterval(timer);
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [currentStoryIndex, isPaused, goToNextStory]);
    
    const goToPrevStory = () => {
        if (currentStoryIndex > 0) {
            setCurrentStoryIndex(i => i - 1);
        } else {
            onPrev();
        }
    };

    const handleViewerClick = (e) => {
        const { clientX, currentTarget } = e;
        const { left, width } = currentTarget.getBoundingClientRect();
        const clickPosition = clientX - left;

        if (clickPosition < width * 0.3) {
            goToPrevStory();
        } else {
            goToNextStory();
        }
    };

    const isOwner = user.id === storyData.user_id;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
            >
                <div 
                    className="relative w-full max-w-sm h-[90vh] bg-black rounded-lg overflow-hidden shadow-2xl cursor-pointer"
                    onMouseDown={() => setIsPaused(true)}
                    onMouseUp={() => setIsPaused(false)}
                    onMouseLeave={() => setIsPaused(false)}
                    onTouchStart={() => setIsPaused(true)}
                    onTouchEnd={() => setIsPaused(false)}
                    onClick={handleViewerClick}
                >
                    <div className="absolute top-0 left-0 right-0 p-2 z-10 pointer-events-none">
                        <div className="flex items-center gap-1">
                            {storyData.stories.map((_, index) => (
                                <div key={index} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                                    {index < currentStoryIndex && <div className="h-full bg-white"></div>}
                                    {index === currentStoryIndex && <Progress value={progress} className="h-1" />}
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-2">
                           <div className="flex items-center gap-2">
                             <img src={storyData.author_avatar} alt={storyData.author_username} className="w-8 h-8 rounded-full" />
                             <span className="text-white font-bold">{storyData.author_username}</span>
                           </div>
                           <div className="pointer-events-auto">
                               {isOwner && (
                                   <AlertDialog>
                                       <AlertDialogTrigger asChild>
                                           <Button variant="ghost" size="icon" className="text-white h-8 w-8"><Trash2 className="w-4 h-4" /></Button>
                                       </AlertDialogTrigger>
                                       <AlertDialogContent>
                                           <AlertDialogHeader><AlertDialogTitle>Excluir Story?</AlertDialogTitle><AlertDialogDescription>Esta ação não pode ser desfeita. Isso removerá permanentemente seu story.</AlertDialogDescription></AlertDialogHeader>
                                           <AlertDialogFooter>
                                               <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                               <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                                           </AlertDialogFooter>
                                       </AlertDialogContent>
                                   </AlertDialog>
                               )}
                           </div>
                        </div>
                    </div>
                    
                    <button onClick={onClose} className="absolute top-2 right-2 text-white z-20 bg-black/50 rounded-full p-1 pointer-events-auto"><X /></button>
                    
                    <div className="w-full h-full flex items-center justify-center">
                        {currentStory.media_type === 'image' && <img src={currentStory.media_url} className="w-full h-full object-contain" alt="Story" />}
                        {currentStory.media_type === 'video' && <video ref={videoRef} src={currentStory.media_url} key={currentStory.id} autoPlay muted playsInline onPlay={() => setIsPaused(false)} onEnded={goToNextStory} onPause={() => {}} className="w-full h-full object-contain" />}
                        {currentStory.media_type === 'gif' && <img src={currentStory.media_url} className="w-full h-full object-contain" alt="Story" />}
                        {currentStory.media_type === 'text' && (
                            <div className="w-full h-full flex items-center justify-center p-8" style={{ backgroundColor: currentStory.media_url }}>
                                <p className="text-white text-2xl font-bold text-center break-words">{currentStory.content}</p>
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};


const UploadStoryModal = ({ isOpen, onOpenChange, onStoryCreated }) => {
    const [uploadType, setUploadType] = useState('media'); // 'media' or 'text'
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [mediaType, setMediaType] = useState(null);
    const [textContent, setTextContent] = useState('');
    const [bgColor, setBgColor] = useState('#3b82f6');
    const [isUploading, setIsUploading] = useState(false);
    const { user } = useAuth();
    const { toast } = useToast();
    const fileInputRef = useRef(null);

    const bgColors = ['#3b82f6', '#ef4444', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'];

    const resetState = () => {
        setUploadType('media');
        setFile(null);
        setPreview(null);
        setMediaType(null);
        setTextContent('');
        setBgColor('#3b82f6');
        setIsUploading(false);
    };
    
    const handleFileSelect = (e) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            if (selectedFile.type.startsWith('image/gif')) { setMediaType('gif'); } 
            else if (selectedFile.type.startsWith('image/')) { setMediaType('image'); } 
            else if (selectedFile.type.startsWith('video/')) { setMediaType('video'); } 
            else { toast({ title: 'Tipo de arquivo não suportado', variant: 'destructive' }); return; }
            setFile(selectedFile);
            setPreview(URL.createObjectURL(selectedFile));
        }
    };

    const handleUpload = async () => {
        if (!user) return;
        setIsUploading(true);

        try {
            let storyData = { user_id: user.id, media_url: 'placeholder' };

            if (uploadType === 'text') {
                if (!textContent.trim()) {
                    toast({ title: 'O texto não pode estar vazio.', variant: 'destructive' });
                    setIsUploading(false);
                    return;
                }
                storyData.media_type = 'text';
                storyData.content = textContent;
                storyData.media_url = bgColor;
            } else {
                if (!file) {
                    toast({ title: 'Nenhum arquivo selecionado.', variant: 'destructive' });
                    setIsUploading(false);
                    return;
                }
                const bucket = 'stories';
                const fileName = `${user.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
                const { error: uploadError } = await supabase.storage.from(bucket).upload(fileName, file);
                if (uploadError) throw uploadError;
                const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileName);
                storyData.media_url = urlData.publicUrl;
                storyData.media_type = mediaType;
                storyData.content = null; // Ensure content is null for media stories
            }
            
            const { error: insertError } = await supabase.from('stories').insert(storyData);
            if (insertError) throw insertError;
            
            toast({ title: 'Story publicado com sucesso!' });
            onStoryCreated();
            onOpenChange(false);
        } catch (error) {
            toast({ title: 'Erro ao publicar story', description: error.message, variant: 'destructive' });
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { onOpenChange(open); if(!open) resetState(); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Adicionar ao seu Story</DialogTitle>
                    <DialogDescription>Compartilhe um momento ou pensamento. Seu story ficará visível por 24 horas.</DialogDescription>
                </DialogHeader>
                
                <div className="py-4">
                    <div className="flex justify-center gap-4 mb-4">
                        <Button variant={uploadType === 'media' ? 'default' : 'outline'} onClick={() => setUploadType('media')}>Mídia</Button>
                        <Button variant={uploadType === 'text' ? 'default' : 'outline'} onClick={() => setUploadType('text')}>Texto</Button>
                    </div>

                    {uploadType === 'media' && (
                        preview ? (
                            <div className="relative">
                                {mediaType === 'video' ? <video src={preview} controls className="w-full rounded-lg max-h-96" /> : <img src={preview} alt="Prévia" className="w-full rounded-lg max-h-96 object-contain" />}
                                <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-8 w-8" onClick={() => { setFile(null); setPreview(null); }}><X className="h-4 w-4" /></Button>
                            </div>
                        ) : (
                            <div className="flex justify-center items-center h-48 border-2 border-dashed border-border rounded-lg">
                               <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="image/*,video/*" />
                               <div className="text-center space-y-2">
                                   <p>Arraste um arquivo ou clique para selecionar</p>
                                   <div className="flex gap-2 justify-center">
                                        <Button type="button" onClick={() => fileInputRef.current?.click()}><ImageIcon className="mr-2 h-4 w-4"/> Foto</Button>
                                        <Button type="button" onClick={() => fileInputRef.current?.click()}><FileGif className="mr-2 h-4 w-4"/> GIF</Button>
                                        <Button type="button" onClick={() => fileInputRef.current?.click()}><Video className="mr-2 h-4 w-4"/> Vídeo</Button>
                                   </div>
                               </div>
                            </div>
                        )
                    )}

                    {uploadType === 'text' && (
                        <div className="space-y-4">
                            <div className="w-full h-64 rounded-lg flex items-center justify-center p-4" style={{ backgroundColor: bgColor }}>
                                <Textarea 
                                    value={textContent}
                                    onChange={(e) => setTextContent(e.target.value)}
                                    placeholder="Comece a digitar..."
                                    className="bg-transparent border-none text-white text-2xl font-bold text-center focus-visible:ring-0 resize-none h-full"
                                />
                            </div>
                            <div className="flex justify-center gap-2">
                                {bgColors.map(color => (
                                    <button key={color} onClick={() => setBgColor(color)} className="w-8 h-8 rounded-full" style={{ backgroundColor: color }} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button onClick={handleUpload} disabled={isUploading || (uploadType === 'media' && !file) || (uploadType === 'text' && !textContent.trim())}>
                        {isUploading ? <Loader2 className="animate-spin mr-2"/> : null}
                        {isUploading ? 'Publicando...' : 'Publicar Story'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default Stories;