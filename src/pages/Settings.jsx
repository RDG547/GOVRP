import React, { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { User, Mail, Phone, Save, Image as ImageIcon, Loader2, Calendar, FileText, Trash2 } from 'lucide-react';
import { formatCPF, formatRG, formatPhone } from '@/lib/utils';

const Settings = () => {
  const { user, session, refreshUser } = useAuth();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    full_name: '',
    username: '',
    phone: '',
  });
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [avatarAction, setAvatarAction] = useState('none');
  const [loading, setLoading] = useState(false);
  const avatarInputRef = useRef(null);

  useEffect(() => {
    if (user) {
      setFormData({
        full_name: user.full_name || '',
        username: user.username || '',
        phone: user.phone ? formatPhone(user.phone) : '',
      });
      setAvatarPreview(user.avatar_url || '');
    }
  }, [user]);

  const handleChange = (e) => {
    let value = e.target.value;
    if (e.target.name === 'phone') {
        value = formatPhone(value);
    }
    setFormData({ ...formData, [e.target.name]: value });
  };
  
  const handleAvatarChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
      setAvatarAction('upload');
    }
  };
  
  const handleRemoveAvatar = () => {
    setAvatarFile(null);
    setAvatarPreview('');
    setAvatarAction('remove');
  };
  
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
        const updates = {
            full_name: formData.full_name,
            username: formData.username,
            phone: formData.phone.replace(/\D/g, '')
        };

        if (avatarAction === 'upload' && avatarFile) {
            const filePath = `${user.id}/${Date.now()}_${avatarFile.name}`;
            const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, avatarFile, { upsert: true });
            if (uploadError) throw uploadError;
            const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
            updates.avatar_url = data.publicUrl;
        } else if (avatarAction === 'remove') {
            if (user.avatar_url) {
                const filePath = getFilePathFromUrl(user.avatar_url, 'avatars');
                if (filePath) await supabase.storage.from('avatars').remove([filePath]);
            }
            updates.avatar_url = null;
        }

        const { error: updateError } = await supabase.from('profiles').update(updates).eq('id', user.id);
        if (updateError) throw updateError;
      
        if (user.phone !== formData.phone.replace(/\D/g, '')) {
            await supabase.auth.updateUser({ phone: formData.phone.replace(/\D/g, '') });
        }

        await refreshUser();
        toast({ title: "Sucesso!", description: "Seu perfil foi atualizado." });
        setAvatarAction('none');
    } catch (error) {
      console.error("Error updating profile:", error);
      toast({ title: "Erro ao atualizar perfil", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Configurações - GOV.RP</title>
        <meta name="description" content="Gerencie as configurações do seu perfil no GOV.RP." />
      </Helmet>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="text-center">
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-8">
              Configurações do <span className="gradient-text">Perfil</span>
            </h1>
          </div>

          <form onSubmit={handleSubmit} className="glass-effect rounded-2xl p-8 space-y-8">
            <div className="flex items-center gap-6">
              <div className="relative">
                <img src={avatarPreview || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="Avatar" className="w-24 h-24 rounded-full object-cover border-2 border-blue-400" />
                <div className="absolute -bottom-1 -right-1 flex gap-1">
                    <Button type="button" size="icon" className="h-8 w-8 bg-blue-500 hover:bg-blue-600" onClick={() => avatarInputRef.current?.click()}><ImageIcon className="w-4 h-4 text-white" /></Button>
                    {avatarPreview && <Button type="button" size="icon" variant="destructive" className="h-8 w-8" onClick={handleRemoveAvatar}><Trash2 className="w-4 h-4" /></Button>}
                </div>
                <input id="avatar" type="file" accept="image/*" onChange={handleAvatarChange} ref={avatarInputRef} className="hidden" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">{user?.full_name}</h2>
                <p className="text-gray-400">@{user?.username}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="full_name">Nome Completo</Label>
                <div className="relative mt-2"><User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="full_name" name="full_name" value={formData.full_name} onChange={handleChange} className="pl-10" /></div>
              </div>
              <div>
                <Label htmlFor="username">Nome de Usuário</Label>
                <div className="relative mt-2"><User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="username" name="username" value={formData.username} onChange={handleChange} className="pl-10" /></div>
              </div>
              <div>
                <Label htmlFor="phone">Telefone</Label>
                <div className="relative mt-2"><Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="phone" name="phone" value={formData.phone} onChange={handleChange} className="pl-10" /></div>
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <div className="relative mt-2"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="email" name="email" value={session?.user?.email || ''} disabled className="pl-10 bg-white/5 cursor-not-allowed" /></div>
              </div>
              <div>
                <Label htmlFor="date_of_birth">Data de Nascimento</Label>
                <div className="relative mt-2"><Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="date_of_birth" value={user?.date_of_birth ? new Date(user.date_of_birth).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : ''} disabled className="pl-10 bg-white/5 cursor-not-allowed" /></div>
              </div>
              <div>
                <Label>Cargo</Label>
                <div className="relative mt-2"><User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input value={user?.role || 'Cidadão'} disabled className="pl-10 bg-white/5 cursor-not-allowed" /></div>
              </div>
              <div>
                <Label htmlFor="cpf">CPF</Label>
                <div className="relative mt-2"><FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="cpf" value={user?.cpf ? formatCPF(user.cpf) : ''} disabled className="pl-10 bg-white/5 cursor-not-allowed" /></div>
              </div>
              <div>
                <Label htmlFor="rg">RG</Label>
                <div className="relative mt-2"><FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" /><Input id="rg" value={user?.rg ? formatRG(user.rg) : ''} disabled className="pl-10 bg-white/5 cursor-not-allowed" /></div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
                Salvar Alterações
              </Button>
            </div>
          </form>
        </motion.div>
      </div>
    </>
  );
};

export default Settings;