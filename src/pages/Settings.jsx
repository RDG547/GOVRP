import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { User, Mail, Phone, Save, Image as ImageIcon, Loader2, Calendar, FileText } from 'lucide-react';
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
  const [loading, setLoading] = useState(false);

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
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      let avatar_url = user.avatar_url;
      if (avatarFile) {
        const fileExt = avatarFile.name.split('.').pop();
        const fileName = `${user.id}-${Date.now()}.${fileExt}`;
        const filePath = `avatars/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, avatarFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);
        
        avatar_url = urlData.publicUrl;
      }

      const unformattedPhone = formData.phone.replace(/\D/g, '');

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ 
          full_name: formData.full_name,
          username: formData.username,
          phone: unformattedPhone,
          avatar_url 
        })
        .eq('id', user.id);

      if (updateError) throw updateError;
      
      if (user.phone !== unformattedPhone) {
          const { error: authUpdateError } = await supabase.auth.updateUser({
              phone: unformattedPhone
          });
          if (authUpdateError) throw authUpdateError;
      }

      await refreshUser();
      toast({ title: "Sucesso!", description: "Seu perfil foi atualizado." });
    } catch (error) {
      console.error("Error updating profile:", error);
      toast({ title: "Erro", description: error.message, variant: "destructive" });
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
                <label htmlFor="avatar" className="absolute -bottom-1 -right-1 bg-blue-500 p-2 rounded-full cursor-pointer hover:bg-blue-600 transition-colors">
                  <ImageIcon className="w-4 h-4 text-white" />
                  <input id="avatar" type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                </label>
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