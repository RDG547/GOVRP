import AccountPasswordSettings from '@/components/AccountPasswordSettings';
import AccountEmailSettings from '@/components/AccountEmailSettings';
import WhatsAppAccountLink from '@/components/WhatsAppAccountLink';
import { formatDateBR } from '@/lib/dateTime';
import { formatLocaleBR } from '@/lib/dateTime';
import React, { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, Calendar, FileText, ImagePlus, Loader2, LockKeyhole, Mail, Phone, Save, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCPF, formatPhone, formatRG } from '@/lib/utils';
import {
  ACCEPTED_IMAGE_EXTENSIONS, ACCEPTED_IMAGE_MIME_TYPES, IMAGE_ACCEPT_ATTRIBUTE,
  MAX_AVATAR_UPLOAD_BYTES, extractStoragePathFromUrl, validateSelectedFile,
} from '@/lib/security';
import { removeAvatarFile, uploadAvatarFile } from '@/lib/avatarStorage';

const ReadOnlyField = ({ label, value, icon: Icon = LockKeyhole, hint }) => (
  <div>
    <Label>{label}</Label>
    {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    <div className="relative mt-2"><Icon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" /><Input value={value || 'Não informado'} readOnly className="cursor-not-allowed bg-white/5 pl-10 text-slate-300" /></div>
  </div>
);

const Settings = () => {
  const { user, session, refreshUser } = useAuth();
  const { toast } = useToast();
  const avatarInputRef = useRef(null);
  const [account, setAccount] = useState({ realFullName: '', realDateOfBirth: '', phone: '' });
  const [citizen, setCitizen] = useState({ bio: '', avatarUrl: '' });
  const [avatarFile, setAvatarFile] = useState(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [citizenLoading, setCitizenLoading] = useState(false);

  useEffect(() => {
    setAccount({
      realFullName: user?.real_full_name || '',
      realDateOfBirth: user?.real_date_of_birth || '',
      phone: user?.phone ? formatPhone(user.phone) : '',
    });
    setCitizen({ bio: user?.character_bio || '', avatarUrl: user?.avatar_url || '' });
  }, [user]);

  const saveAccount = async (event) => {
    event.preventDefault();
    setAccountLoading(true);
    try {
      const normalizedPhone = account.phone.replace(/\D/g, '');
      const { error } = await supabase.rpc('update_my_account_identity', {
        p_real_full_name: account.realFullName,
        p_real_date_of_birth: account.realDateOfBirth || null,
        p_phone: normalizedPhone || null,
        p_phone_country_code: '+55',
      });
      if (error) throw error;
      await refreshUser();
      toast({ title: 'Dados da conta atualizados', description: 'Essas informações permanecem privadas.' });
    } catch (error) {
      toast({ title: 'Erro ao atualizar a conta', description: error.message, variant: 'destructive' });
    } finally { setAccountLoading(false); }
  };

  const chooseAvatar = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const validation = validateSelectedFile(file, { allowedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES, allowedExtensions: ACCEPTED_IMAGE_EXTENSIONS, maxBytes: MAX_AVATAR_UPLOAD_BYTES, label: 'avatar' });
    if (!validation.ok) {
      toast({ title: 'Avatar inválido', description: validation.error, variant: 'destructive' });
      return;
    }
    setAvatarFile(file);
    setCitizen((current) => ({ ...current, avatarUrl: URL.createObjectURL(file) }));
  };

  const saveCitizen = async (event) => {
    event.preventDefault();
    setCitizenLoading(true);
    let uploadedPath = null;
    try {
      let avatarUrl = citizen.avatarUrl;
      let oldPath = null;
      if (avatarFile) {
        oldPath = extractStoragePathFromUrl(user.avatar_url, 'avatars');
        const uploadedAvatar = await uploadAvatarFile(avatarFile);
        uploadedPath = uploadedAvatar.path;
        avatarUrl = uploadedAvatar.publicUrl;
      }
      const { error } = await supabase.rpc('update_my_citizen_profile', { p_character_bio: citizen.bio || null, p_avatar_url: avatarUrl || null });
      if (error) throw error;
      if (oldPath) await removeAvatarFile(oldPath);
      await refreshUser();
      setAvatarFile(null);
      toast({ title: 'Perfil do cidadão atualizado' });
    } catch (error) {
      if (uploadedPath) await removeAvatarFile(uploadedPath);
      toast({ title: 'Erro ao atualizar o cidadão', description: error.message, variant: 'destructive' });
    } finally { setCitizenLoading(false); }
  };

  return (
    <>
      <Helmet><title>Configurações - GOV.RP</title><meta name="description" content="Gerencie separadamente sua conta privada e seu cidadão GOVRP." /></Helmet>
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <div className="mb-8 text-center"><h1 className="text-4xl font-bold text-white">Configurações</h1><p className="mt-3 text-slate-400">Conta real e cidadão do RP são identidades distintas.</p></div>
          <Tabs defaultValue="account" className="w-full">
            <TabsList className="mx-auto grid w-full max-w-xl grid-cols-3"><TabsTrigger value="account">Conta</TabsTrigger><TabsTrigger value="citizen">Cidadão</TabsTrigger><TabsTrigger value="whatsapp">WhatsApp</TabsTrigger></TabsList>

            <TabsContent value="account" className="mt-6">
              <form onSubmit={saveAccount} className="glass-effect rounded-2xl border border-white/10 p-6 sm:p-8">
                <div className="mb-7 rounded-xl border border-blue-400/20 bg-blue-500/10 p-4"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" /><div><h2 className="font-semibold text-blue-100">Informações privadas · OOC</h2><p className="mt-1 text-sm text-blue-100/75">Usadas para login, segurança e administração. Não aparecem em perfis, eleições, Banco, Rede X ou documentos do personagem.</p></div></div></div>
                <div className="grid gap-6 md:grid-cols-2">
                  <div><Label htmlFor="real-name">Nome completo real</Label><div className="relative mt-2"><User className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><Input id="real-name" required value={account.realFullName} onChange={(event) => setAccount((current) => ({ ...current, realFullName: event.target.value }))} className="pl-10" /></div></div>
                  <div><Label htmlFor="real-birth">Data de nascimento real</Label><div className="relative mt-2"><Calendar className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><Input id="real-birth" type="date" required value={account.realDateOfBirth} onChange={(event) => setAccount((current) => ({ ...current, realDateOfBirth: event.target.value }))} className="pl-10" /></div></div>
                  <div><Label htmlFor="account-phone">Telefone</Label><div className="relative mt-2"><Phone className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><Input id="account-phone" inputMode="tel" required value={account.phone} onChange={(event) => setAccount((current) => ({ ...current, phone: formatPhone(event.target.value) }))} className="pl-10" /></div></div>
                  <ReadOnlyField label="E-mail" value={session?.user?.email} icon={Mail} hint="Altere o endereço de login com confirmação por e-mail na seção abaixo." />
                </div>
                <div className="mt-7 flex justify-end"><Button type="submit" disabled={accountLoading}>{accountLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar dados da conta</Button></div>
              </form>
              <AccountPasswordSettings/>
              <AccountEmailSettings/>
            </TabsContent>

            <TabsContent value="citizen" className="mt-6">
              <form onSubmit={saveCitizen} className="glass-effect rounded-2xl border border-white/10 p-6 sm:p-8">
                <div className="mb-7 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4"><h2 className="font-semibold text-emerald-100">Informações do universo GOVRP · IC</h2><p className="mt-1 text-sm text-emerald-100/75">Estes dados representam o personagem. Documentos oficiais e nascimento não podem ser alterados livremente.</p></div>
                <div className="mb-8 flex flex-col items-center gap-5 sm:flex-row">
                  <div className="relative"><img src={citizen.avatarUrl || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="Avatar do cidadão" className="h-28 w-28 rounded-full border-2 border-emerald-400 object-cover" /><Button type="button" size="icon" onClick={() => avatarInputRef.current?.click()} className="absolute -bottom-1 -right-1 rounded-full"><ImagePlus className="h-4 w-4" /></Button><input ref={avatarInputRef} type="file" accept={IMAGE_ACCEPT_ATTRIBUTE} onChange={chooseAvatar} className="hidden" /></div>
                  <div className="text-center sm:text-left"><h2 className="text-2xl font-bold">{user?.full_name || 'Cidadão em registro'}</h2><p className="text-slate-400">@{user?.username}</p><p className="mt-2 text-sm text-slate-500">ID interno: {user?.citizen_id || 'emitido após migration'}</p></div>
                </div>
                <div className="grid gap-6 md:grid-cols-2">
                  <ReadOnlyField label="Nome civil do cidadão" value={user?.full_name} icon={User} hint="Mudanças civis exigem procedimento próprio." />
                  <ReadOnlyField label="Nascimento do cidadão" value={user?.date_of_birth ? formatDateBR(user.date_of_birth) : null} icon={Calendar} />
                  <ReadOnlyField label="CPF do cidadão" value={user?.cpf ? formatCPF(user.cpf) : null} icon={FileText} />
                  <ReadOnlyField label="RG do cidadão" value={user?.rg ? formatRG(user.rg) : null} icon={FileText} />
                  <ReadOnlyField label="Residência" value={user?.residence_city_name ? `${user.residence_city_name}/${user.residence_state_code}` : user?.state_name} icon={User} />
                  <ReadOnlyField label="Cargo" value={user?.role || 'Cidadão'} icon={User} />
                </div>
                <div className="mt-6"><Label htmlFor="citizen-bio">Biografia pública</Label><textarea id="citizen-bio" maxLength={300} value={citizen.bio} onChange={(event) => setCitizen((current) => ({ ...current, bio: event.target.value }))} className="mt-2 min-h-28 w-full rounded-md border border-white/10 bg-slate-950/70 p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" /><p className="text-right text-xs text-slate-500">{citizen.bio.length}/300</p></div>
                <div className="mt-7 flex justify-end"><Button type="submit" disabled={citizenLoading}>{citizenLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar perfil público</Button></div>
              </form>
            </TabsContent>
            <TabsContent value="whatsapp" className="mt-6"><WhatsAppAccountLink /></TabsContent>
          </Tabs>

          <div className="mt-8 rounded-2xl border border-red-500/20 bg-red-500/10 p-5 sm:flex sm:items-center sm:justify-between sm:gap-5"><div><h2 className="text-lg font-semibold">Solicitar exclusão da conta</h2><p className="mt-1 text-sm text-red-100/80">Use o procedimento formal para encerrar conta e dados associados.</p></div><Button asChild variant="destructive" className="mt-4 sm:mt-0"><Link to="/account-deletion">Solicitar exclusão <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div>
        </motion.div>
      </div>
    </>
  );
};

export default Settings;
