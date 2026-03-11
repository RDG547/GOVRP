import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, X, Image as ImageIcon, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

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
            if (selectedFile.type.startsWith('image/gif')) { 
                setMediaType('gif'); 
            } else if (selectedFile.type.startsWith('image/')) { 
                setMediaType('image'); 
            } else if (selectedFile.type.startsWith('video/')) { 
                if (selectedFile.size > 60 * 1024 * 1024) { // 60MB limit for ~1 min video
                    toast({ title: 'Vídeo muito grande', description: 'O vídeo para stories não pode exceder 1 minuto (aprox. 60MB).', variant: 'destructive' });
                    return;
                }
                setMediaType('video'); 
            } else { 
                toast({ title: 'Tipo de arquivo não suportado', variant: 'destructive' }); 
                return; 
            }
            setFile(selectedFile);
            setPreview(URL.createObjectURL(selectedFile));
        }
    };

    const handleUpload = async () => {
        if (!user) return;
        setIsUploading(true);

        try {
            let storyData = { user_id: user.id };

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
                storyData.content = null;
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
                                        <Button type="button" onClick={() => fileInputRef.current?.click()}><ImageIcon className="mr-2 h-4 w-4"/> Foto/GIF</Button>
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

export default UploadStoryModal;