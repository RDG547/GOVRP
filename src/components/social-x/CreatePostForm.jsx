import React, { useState, useRef, forwardRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Loader2, Send, X, Image as ImageIcon, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

const CreatePostForm = forwardRef(({ onPostCreated }, ref) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [postContent, setPostContent] = useState('');
    const [postImage, setPostImage] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef(null);

    const handleImageSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            setPostImage(file);
            setImagePreview(URL.createObjectURL(file));
        }
    };
    
    const removeImage = () => {
        setPostImage(null);
        setImagePreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }

    const handlePostSubmit = async (e) => {
        e.preventDefault();
        if (!postContent.trim() && !postImage) return;
        setIsSubmitting(true);
        let imageUrl = null;

        if (postImage) {
            const fileName = `${user.id}/${Date.now()}_${postImage.name}`;
            const { data: uploadData, error: uploadError } = await supabase.storage.from('post-images').upload(fileName, postImage);
            if (uploadError) {
                toast({ title: 'Erro no upload da imagem', description: uploadError.message, variant: "destructive" });
                setIsSubmitting(false); return;
            }
            const { data: urlData } = supabase.storage.from('post-images').getPublicUrl(uploadData.path);
            imageUrl = urlData.publicUrl;
        }

        const { data: newPost, error } = await supabase.from('posts').insert({ content: postContent, user_id: user.id, image_url: imageUrl }).select('*, author:profiles!posts_user_id_fkey(*)').single();
        if (error) {
            toast({ title: 'Erro ao postar', description: error.message, variant: "destructive" });
        } else {
            setPostContent('');
            removeImage();
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
                        <Textarea 
                            ref={ref}
                            id="main-post-textarea"
                            value={postContent} 
                            onChange={(e) => setPostContent(e.target.value)} 
                            placeholder="O que está acontecendo?" 
                            className="bg-transparent border-0 text-lg text-white focus-visible:ring-0 p-0" />
                    </div>
                    {imagePreview && (
                        <div className="relative mt-4 ml-16">
                            <img src={imagePreview} alt="Preview" className="rounded-lg max-h-80 w-auto" />
                            <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-8 w-8 rounded-full" onClick={removeImage}><X className="h-4 w-4" /></Button>
                        </div>
                    )}
                </CardContent>
                <CardFooter className="p-4 flex justify-between items-center border-t border-slate-700/50">
                    <input type="file" ref={fileInputRef} id="imageUpload" accept="image/*" onChange={handleImageSelect} className="hidden" />
                    <Button type="button" variant="ghost" size="icon" className="text-blue-400 hover:text-blue-300" onClick={() => fileInputRef.current.click()}><ImageIcon /></Button>
                    <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : <><Send className="w-4 h-4 mr-2" /> Postar</>}</Button>
                </CardFooter>
            </form>
        </Card>
    );
});

export default CreatePostForm;