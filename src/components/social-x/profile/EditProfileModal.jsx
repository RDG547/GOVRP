import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Loader2, Save, Image as ImageIcon, Trash2, AtSign } from 'lucide-react';

const EditProfileModal = ({ isOpen, setIsOpen, profile, onProfileUpdate }) => {
    const { refreshUser } = useAuth();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    
    const [xUsername, setXUsername] = useState(profile.x_username || '');
    const [xHandle, setXHandle] = useState(profile.x_handle || '');
    const [xBio, setXBio] = useState(profile.x_bio || '');

    const [avatarFile, setAvatarFile] = useState(null);
    const [avatarPreview, setAvatarPreview] = useState(profile.x_avatar_url || '');
    const [avatarAction, setAvatarAction] = useState('none');
    const avatarInputRef = useRef(null);

    const [headerFile, setHeaderFile] = useState(null);
    const [headerPreview, setHeaderPreview] = useState(profile.x_header_url || '');
    const [headerAction, setHeaderAction] = useState('none');
    const headerInputRef = useRef(null);

    const getFilePathFromUrl = (url, bucketName) => {
        if (!url) return null;
        try {
            const urlObject = new URL(url);
            const pathSegments = urlObject.pathname.split('/');
            const bucketIndex = pathSegments.indexOf(bucketName);
            if (bucketIndex === -1 || bucketIndex + 1 >= pathSegments.length) return null;
            return pathSegments.slice(bucketIndex + 1).join('/');
        } catch (e) {
            console.error('Invalid URL for file path extraction:', e);
            return null;
        }
    };
    
    const handleAvatarChange = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            setAvatarFile(file);
            setAvatarPreview(URL.createObjectURL(file));
            setAvatarAction('upload');
        }
    };
    
    const handleHeaderChange = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            setHeaderFile(file);
            setHeaderPreview(URL.createObjectURL(file));
            setHeaderAction('upload');
        }
    };
    
    const handleRemoveAvatar = () => {
        setAvatarFile(null);
        setAvatarPreview('');
        setAvatarAction('remove');
    };
    
    const handleRemoveHeader = () => {
        setHeaderFile(null);
        setHeaderPreview('');
        setHeaderAction('remove');
    };

    const handleSave = async () => {
        setLoading(true);
        try {
            const updates = { x_username: xUsername, x_bio: xBio };

            if (xHandle !== profile.x_handle) {
                const { data, error } = await supabase.rpc('update_x_handle', { p_new_handle: xHandle });
                if (error || !data.success) {
                    throw new Error(data?.message || error.message);
                }
                updates.x_handle = data.new_handle;
            }

            if (avatarAction === 'upload' && avatarFile) {
                const filePath = `${profile.id}/${Date.now()}_${avatarFile.name}`;
                const { error: uploadError } = await supabase.storage.from('x-avatars').upload(filePath, avatarFile, { upsert: true });
                if (uploadError) throw uploadError;
                const { data } = supabase.storage.from('x-avatars').getPublicUrl(filePath);
                updates.x_avatar_url = data.publicUrl;
            } else if (avatarAction === 'remove') {
                if (profile.x_avatar_url) {
                    const filePath = getFilePathFromUrl(profile.x_avatar_url, 'x-avatars');
                    if (filePath) await supabase.storage.from('x-avatars').remove([filePath]);
                }
                updates.x_avatar_url = null;
            }

            if (headerAction === 'upload' && headerFile) {
                const filePath = `${profile.id}/${Date.now()}_${headerFile.name}`;
                const { error: uploadError } = await supabase.storage.from('headers').upload(filePath, headerFile, { upsert: true });
                if (uploadError) throw uploadError;
                const { data } = supabase.storage.from('headers').getPublicUrl(filePath);
                updates.x_header_url = data.publicUrl;
            } else if (headerAction === 'remove') {
                if (profile.x_header_url) {
                    const filePath = getFilePathFromUrl(profile.x_header_url, 'headers');
                    if (filePath) await supabase.storage.from('headers').remove([filePath]);
                }
                updates.x_header_url = null;
            }
            
            if (Object.keys(updates).length > 1 || (updates.x_handle && updates.x_handle !== profile.x_handle)) {
              const { error: updateError } = await supabase.from('profiles').update(updates).eq('id', profile.id);
              if (updateError) throw updateError;
            }
            
            await refreshUser();
            onProfileUpdate(updates);
            toast({ title: "Perfil atualizado com sucesso!" });
            setIsOpen(false);
        } catch (error) {
            console.error("Error updating profile:", error);
            toast({ title: "Erro ao atualizar perfil", description: error.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="glass-effect text-white">
                <DialogHeader><DialogTitle>Editar Perfil X</DialogTitle><DialogDescription>Personalize seu perfil para a rede social X.</DialogDescription></DialogHeader>
                <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">
                    <div className="relative">
                        <Label>Imagem de Cabeçalho</Label>
                        <div style={{ backgroundImage: `url(${headerPreview})`}} className="mt-2 h-32 rounded-lg bg-cover bg-center bg-slate-700 flex items-center justify-center">
                            {!headerPreview && <ImageIcon className="w-10 h-10 text-gray-400"/>}
                        </div>
                        <div className="absolute top-8 right-2 flex gap-2">
                           <Button type="button" size="icon" variant="secondary" onClick={() => headerInputRef.current?.click()}><ImageIcon className="w-4 h-4"/></Button>
                           {headerPreview && <Button type="button" size="icon" variant="destructive" onClick={handleRemoveHeader}><Trash2 className="w-4 h-4"/></Button>}
                        </div>
                        <input type="file" ref={headerInputRef} id="header_image" className="hidden" accept="image/*" onChange={handleHeaderChange}/>
                    </div>

                    <div className="relative w-fit">
                        <Label>Avatar</Label>
                        <img src={avatarPreview || `https://api.dicebear.com/7.x/micah/svg?seed=${profile.username}`} alt="Avatar" className="mt-2 w-24 h-24 rounded-full object-cover border-2 border-slate-600" />
                        <div className="absolute bottom-0 right-0 flex gap-1">
                           <Button type="button" size="icon" variant="secondary" className="h-8 w-8" onClick={() => avatarInputRef.current?.click()}><ImageIcon className="w-4 h-4"/></Button>
                           {avatarPreview && <Button type="button" size="icon" variant="destructive" className="h-8 w-8" onClick={handleRemoveAvatar}><Trash2 className="w-4 h-4"/></Button>}
                        </div>
                        <input type="file" ref={avatarInputRef} id="avatar_image" className="hidden" accept="image/*" onChange={handleAvatarChange}/>
                    </div>

                    <div><Label htmlFor="x_username">Nome de Usuário</Label><Input id="x_username" value={xUsername} onChange={(e) => setXUsername(e.target.value)} /></div>
                    
                    <div>
                        <Label htmlFor="xHandle">@handle</Label>
                        <div className="relative">
                            <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <Input id="xHandle" value={xHandle} onChange={(e) => setXHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} className="pl-8"/>
                        </div>
                    </div>

                    <div><Label htmlFor="x_bio">Bio</Label><Textarea id="x_bio" value={xBio} onChange={(e) => setXBio(e.target.value)} maxLength={160} /></div>
                </div>
                <DialogFooter><Button variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button><Button onClick={handleSave} disabled={loading}>{loading ? <Loader2 className="animate-spin mr-2"/> : <Save className="mr-2 h-4 w-4" />}Salvar</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default EditProfileModal;