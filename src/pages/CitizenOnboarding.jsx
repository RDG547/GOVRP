import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft, ArrowRight, BadgeCheck, Banknote, Briefcase, Building2, CalendarDays, Check,
  CheckCircle2, FileText, Fingerprint, Flag, ImagePlus, Landmark, Loader2,
  LogOut, MapPin, Save, ShieldCheck, Sparkles, User, Vote,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import BrazilFlag from '@/components/onboarding/BrazilFlag';
import { OfficialDocument } from '@/components/dic/OfficialDocument';
import { ASPIRATIONS, PROGRESS_STEPS, getDocument, getProgressIndex } from '@/lib/citizenOnboarding';
import { BRAZIL_STATES, fetchMunicipalitiesByState } from '@/lib/brazilianLocations';
import { formatCurrency } from '@/lib/utils';
import {
  ACCEPTED_IMAGE_EXTENSIONS, ACCEPTED_IMAGE_MIME_TYPES, IMAGE_ACCEPT_ATTRIBUTE,
  MAX_AVATAR_UPLOAD_BYTES, validateSelectedFile,
} from '@/lib/security';
import { removeAvatarFile, uploadAvatarFile } from '@/lib/avatarStorage';
import { format, isValid, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const panelMotion = {
  initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -12 },
};

const CHARACTER_AVATARS = {
  male: Array.from({ length: 25 }, (_, index) => ({
    id: `male-${index + 1}`,
    url: `https://api.dicebear.com/9.x/adventurer/svg?seed=GOVRP-masculino-${String(index + 1).padStart(2, '0')}&backgroundColor=0f172a,1e293b,164e63`,
  })),
  female: Array.from({ length: 25 }, (_, index) => ({
    id: `female-${index + 1}`,
    url: `https://api.dicebear.com/9.x/adventurer/svg?seed=GOVRP-feminino-${String(index + 1).padStart(2, '0')}&backgroundColor=312e81,4c1d95,831843`,
  })),
};

const CharacterBirthDate = ({ value, onChange, minDate, maxDate }) => {
  const [typedValue, setTypedValue] = useState(value ? format(new Date(`${value}T12:00:00`), 'dd/MM/yyyy') : '');
  const selectedDate = value ? new Date(`${value}T12:00:00`) : undefined;

  useEffect(() => {
    setTypedValue(value ? format(new Date(`${value}T12:00:00`), 'dd/MM/yyyy') : '');
  }, [value]);

  const handleTyping = (event) => {
    const next = event.target.value.replace(/[^0-9/]/g, '').slice(0, 10);
    setTypedValue(next);
    if (!next) {
      onChange('');
      return;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(next)) {
      const parsedDate = parse(next, 'dd/MM/yyyy', new Date());
      if (isValid(parsedDate) && format(parsedDate, 'dd/MM/yyyy') === next
          && parsedDate >= minDate && parsedDate <= maxDate) {
        onChange(format(parsedDate, 'yyyy-MM-dd'));
      }
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        id="character-birth"
        inputMode="numeric"
        placeholder="DD/MM/AAAA"
        required
        value={typedValue}
        onChange={handleTyping}
        aria-describedby="character-birth-hint"
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="Selecionar data no calendário">
            <CalendarDays className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => date && onChange(format(date, 'yyyy-MM-dd'))}
            disabled={(date) => date < minDate || date > maxDate}
            defaultMonth={selectedDate || new Date(2000, 0, 1)}
            startMonth={minDate}
            endMonth={maxDate}
            captionLayout="dropdown"
            locale={ptBR}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};

const FieldSelect = ({ id, label, value, onChange, disabled, children, hint }) => (
  <div>
    <Label htmlFor={id}>{label}</Label>
    {hint && <p className="mb-2 mt-1 text-xs text-slate-400">{hint}</p>}
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-slate-950/80 px-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60">
      {children}
    </select>
  </div>
);

const StepShell = ({ eyebrow, title, description, children }) => (
  <motion.section {...panelMotion} className="mx-auto w-full max-w-4xl">
    <header className="mb-7 text-center">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">{eyebrow}</p>
      <h1 className="text-3xl font-bold text-white sm:text-4xl">{title}</h1>
      {description && <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">{description}</p>}
    </header>
    {children}
  </motion.section>
);

const CitizenOnboarding = () => {
  const { user, logout, refreshUser, setTriggerTutorial } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const avatarInputRef = useRef(null);
  const avatarPreviewUrlRef = useRef('');
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [working, setWorking] = useState('');
  const [previewDocument, setPreviewDocument] = useState(null);
  const [ceremony, setCeremony] = useState(null);
  const [viewStep, setViewStep] = useState('');
  const [accountCompletion, setAccountCompletion] = useState({ realFullName: '', realDateOfBirth: '', phone: '' });
  const [identity, setIdentity] = useState({ fullName: '', username: '', dateOfBirth: '', bio: '', avatarUrl: '', gender: '' });
  const [origin, setOrigin] = useState({ birthState: '', birthCity: '', residenceState: '', residenceCity: '' });
  const [birthCities, setBirthCities] = useState([]);
  const [residenceCities, setResidenceCities] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState({ birth: false, residence: false });
  const [locationError, setLocationError] = useState('');
  const [aspiration, setAspiration] = useState('');

  const loadOnboarding = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const { data, error } = await supabase.rpc('get_my_citizen_onboarding');
    if (error) {
      setLoading(false);
      setLoadError(error.message || 'Não foi possível carregar o Registro Nacional.');
      toast({ title: 'Não foi possível carregar o registro', description: error.message, variant: 'destructive' });
      return;
    }
    if (!data?.profile) {
      setLoading(false);
      setLoadError('Não foi possível carregar o Registro Nacional.');
      return;
    }
    const profile = data.profile;
    setState(data);
    setAccountCompletion({
      realFullName: data.account_identity?.real_full_name || '',
      realDateOfBirth: data.account_identity?.real_date_of_birth || '',
      phone: data.account_identity?.phone || '',
    });
    setIdentity({
      fullName: profile.full_name || '',
      username: profile.username_is_generated ? '' : profile.username || '',
      dateOfBirth: profile.date_of_birth || '',
      bio: profile.character_bio || '',
      avatarUrl: profile.avatar_url || '',
      gender: profile.character_gender || '',
    });
    setOrigin({
      birthState: profile.birth_state_code || '', birthCity: profile.birth_city_code || '',
      residenceState: profile.residence_state_code || profile.state_code || '',
      residenceCity: profile.residence_city_code || '',
    });
    setAspiration(profile.initial_aspiration || '');
    setViewStep(profile.onboarding_step || 'welcome');
    setLoading(false);
  }, [toast]);

  useEffect(() => { loadOnboarding(); }, [loadOnboarding]);

  useEffect(() => () => {
    if (avatarPreviewUrlRef.current) URL.revokeObjectURL(avatarPreviewUrlRef.current);
  }, []);

  useEffect(() => {
    if (!origin.birthState) { setBirthCities([]); return undefined; }
    const controller = new AbortController();
    setLocationsLoading((current) => ({ ...current, birth: true }));
    fetchMunicipalitiesByState(origin.birthState, controller.signal)
      .then(setBirthCities)
      .catch((error) => { if (error.name !== 'AbortError') setLocationError(error.message); })
      .finally(() => setLocationsLoading((current) => ({ ...current, birth: false })));
    return () => controller.abort();
  }, [origin.birthState]);

  useEffect(() => {
    if (!origin.residenceState) { setResidenceCities([]); return undefined; }
    const controller = new AbortController();
    setLocationsLoading((current) => ({ ...current, residence: true }));
    fetchMunicipalitiesByState(origin.residenceState, controller.signal)
      .then(setResidenceCities)
      .catch((error) => { if (error.name !== 'AbortError') setLocationError(error.message); })
      .finally(() => setLocationsLoading((current) => ({ ...current, residence: false })));
    return () => controller.abort();
  }, [origin.residenceState]);

  const profile = state?.profile;
  const documents = state?.documents || [];
  const currentStep = ceremony ? 'citizenship' : viewStep || profile?.onboarding_step || 'welcome';
  const progressIndex = getProgressIndex(currentStep);
  const furthestProgressIndex = getProgressIndex(profile?.onboarding_step || 'welcome');
  const selectedAspiration = ASPIRATIONS.find((item) => item.key === profile?.initial_aspiration);
  const accountNeedsCompletion = !state?.account_identity?.real_full_name || !state?.account_identity?.real_date_of_birth || !state?.account_identity?.phone;

  const run = async (key, callback) => {
    if (working) return;
    setWorking(key);
    try { await callback(); } catch (error) {
      toast({ title: 'Não foi possível concluir esta etapa', description: error.message, variant: 'destructive' });
    } finally { setWorking(''); }
  };

  const start = () => run('start', async () => {
    const { error } = await supabase.rpc('start_citizen_onboarding');
    if (error) throw error;
    await loadOnboarding();
  });

  const completeAccount = (event) => {
    event.preventDefault();
    run('account', async () => {
      const { error } = await supabase.rpc('update_my_account_identity', {
        p_real_full_name: accountCompletion.realFullName,
        p_real_date_of_birth: accountCompletion.realDateOfBirth,
        p_phone: accountCompletion.phone,
        p_phone_country_code: '+55',
      });
      if (error) throw error;
      await loadOnboarding();
      toast({ title: 'Dados privados da conta confirmados' });
    });
  };

  const uploadAvatar = async (file) => {
    const validation = validateSelectedFile(file, { allowedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES, allowedExtensions: ACCEPTED_IMAGE_EXTENSIONS, maxBytes: MAX_AVATAR_UPLOAD_BYTES, label: 'avatar' });
    if (!validation.ok) throw new Error(validation.error);
    const uploaded = await uploadAvatarFile(file);
    return { filePath: uploaded.path, publicUrl: uploaded.publicUrl };
  };

  const setUploadedAvatarPreview = (file) => {
    if (!file) return;
    const validation = validateSelectedFile(file, { allowedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES, allowedExtensions: ACCEPTED_IMAGE_EXTENSIONS, maxBytes: MAX_AVATAR_UPLOAD_BYTES, label: 'avatar' });
    if (!validation.ok) {
      toast({ title: 'Imagem inválida', description: validation.error, variant: 'destructive' });
      if (avatarInputRef.current) avatarInputRef.current.value = '';
      return;
    }
    if (avatarPreviewUrlRef.current) URL.revokeObjectURL(avatarPreviewUrlRef.current);
    avatarPreviewUrlRef.current = URL.createObjectURL(file);
    setIdentityField('avatarUrl', avatarPreviewUrlRef.current);
  };

  const selectProvidedAvatar = (avatarUrl) => {
    if (avatarPreviewUrlRef.current) {
      URL.revokeObjectURL(avatarPreviewUrlRef.current);
      avatarPreviewUrlRef.current = '';
    }
    if (avatarInputRef.current) avatarInputRef.current.value = '';
    setIdentityField('avatarUrl', avatarUrl);
  };

  const removePreviousUploadedAvatar = async (previousUrl, nextUrl) => {
    const marker = '/storage/v1/object/public/avatars/';
    if (!previousUrl?.includes(marker) || previousUrl === nextUrl) return;
    const previousPath = decodeURIComponent(previousUrl.split(marker)[1]?.split('?')[0] || '');
    if (previousPath.startsWith(`${user.id}/`)) {
      await removeAvatarFile(previousPath);
    }
  };

  const saveIdentity = (event) => {
    event.preventDefault();
    run('identity', async () => {
      let avatarUrl = identity.avatarUrl;
      let uploadedPath = null;
      const avatarFile = avatarInputRef.current?.files?.[0];
      const previousAvatarUrl = profile.avatar_url || '';
      if (avatarFile) {
        const uploadedAvatar = await uploadAvatar(avatarFile);
        uploadedPath = uploadedAvatar.filePath;
        avatarUrl = uploadedAvatar.publicUrl;
      }
      const { error } = await supabase.rpc('save_citizen_identity', {
        p_full_name: identity.fullName, p_username: identity.username,
        p_date_of_birth: identity.dateOfBirth, p_character_bio: identity.bio || null,
        p_avatar_url: avatarUrl || null,
        p_character_gender: identity.gender,
      });
      if (error) {
        if (uploadedPath) await removeAvatarFile(uploadedPath);
        throw error;
      }
      await removePreviousUploadedAvatar(previousAvatarUrl, avatarUrl);
      if (avatarPreviewUrlRef.current) {
        URL.revokeObjectURL(avatarPreviewUrlRef.current);
        avatarPreviewUrlRef.current = '';
      }
      if (avatarInputRef.current) avatarInputRef.current.value = '';
      await refreshUser();
      await loadOnboarding();
    });
  };

  const saveOrigin = (event) => {
    event.preventDefault();
    run('origin', async () => {
      const birthCity = birthCities.find((city) => city.code === origin.birthCity);
      const residenceCity = residenceCities.find((city) => city.code === origin.residenceCity);
      if (!birthCity || !residenceCity) throw new Error('Selecione os dois municípios.');
      const { error } = await supabase.rpc('save_citizen_origin', {
        p_birth_state_code: origin.birthState, p_birth_city_code: birthCity.code, p_birth_city_name: birthCity.name,
        p_residence_state_code: origin.residenceState, p_residence_city_code: residenceCity.code, p_residence_city_name: residenceCity.name,
      });
      if (error) throw error;
      await loadOnboarding();
    });
  };

  const saveAspiration = () => run('profile', async () => {
    if (!aspiration) throw new Error('Selecione uma aspiração inicial.');
    const { error } = await supabase.rpc('save_citizen_aspiration', { p_initial_aspiration: aspiration });
    if (error) throw error;
    await loadOnboarding();
  });

  const issueDocument = (type) => run(`document:${type}`, async () => {
    const { data, error } = await supabase.rpc('issue_citizen_onboarding_document', { p_document_type: type });
    if (error) throw error;
    toast({ title: data.created ? `${type} emitido` : `${type} já estava emitido`, description: 'O documento foi preservado no seu registro oficial.' });
    await loadOnboarding();
  });

  const openBankAccount = () => run('bank', async () => {
    const { data, error } = await supabase.rpc('ensure_citizen_bank_account');
    if (error) throw error;
    toast({ title: data.created ? 'Conta bancária aberta' : 'Conta bancária preservada', description: data.created ? `Saldo inicial: ${formatCurrency(data.account.balance)}` : 'Nenhuma conta ou saldo foi duplicado.' });
    await loadOnboarding();
  });

  const finalize = () => run('finalize', async () => {
    const { data, error } = await supabase.rpc('finalize_citizen_onboarding');
    if (error) throw error;
    setCeremony({ ...state, profile: data.profile });
  });

  const enterGovrp = async () => {
    await refreshUser();
    setTriggerTutorial(true);
    navigate('/dashboard', { replace: true });
  };

  const setIdentityField = (field, value) => setIdentity((current) => ({ ...current, [field]: value }));
  const setOriginField = (field, value) => setOrigin((current) => ({ ...current, [field]: value }));
  const navigateToOnboardingStep = (step, index) => {
    if (working || index > furthestProgressIndex) return;
    setViewStep(step);
  };
  const officialUser = useMemo(() => ceremony?.profile || profile || {}, [ceremony, profile]);
  const currentYear = new Date().getFullYear();
  const todayInput = new Date().toISOString().slice(0, 10);
  const maximumCharacterBirthDate = new Date(`${todayInput}T12:00:00`);
  const minimumCharacterBirthDate = new Date(currentYear - 120, 0, 1, 12);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-emerald-400" /><span className="sr-only">Carregando registro</span></div>;
  if (loadError || !state) return <div className="flex min-h-screen items-center justify-center p-4"><div className="max-w-md rounded-2xl border border-red-400/20 bg-slate-950/80 p-6 text-center"><h1 className="text-xl font-semibold text-white">Registro temporariamente indisponível</h1><p role="alert" className="mt-3 text-sm text-slate-300">{loadError || 'Não foi possível carregar seus dados.'}</p><Button onClick={loadOnboarding} className="mt-5">Tentar novamente</Button></div></div>;

  const renderDocuments = (types, title, description) => {
    const allIssued = types.every((type) => getDocument(documents, type));
    return (
      <StepShell eyebrow="Registro Nacional de Cidadania" title={title} description={description}>
        <div className="grid gap-4 md:grid-cols-2">
          {types.map((type) => {
            const document = getDocument(documents, type);
            const Icon = type === 'CPF' ? Fingerprint : type === 'RG' ? FileText : type === 'CTD' ? Briefcase : Vote;
            return <motion.div key={type} layout className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
              <div className="flex items-start gap-4"><span className="rounded-xl bg-emerald-500/10 p-3 text-emerald-300"><Icon className="h-7 w-7" /></span><div className="min-w-0 flex-1"><h2 className="font-semibold text-white">{type === 'CTD' ? 'Carteira de Trabalho' : type}</h2><p className="mt-1 text-sm text-slate-400">{document ? `Nº ${document.document_number}` : 'Ainda não emitido'}</p></div>{document && <CheckCircle2 className="h-6 w-6 text-emerald-400" />}</div>
              <div className="mt-5 flex flex-wrap gap-2">{document ? <Button variant="outline" onClick={() => setPreviewDocument(document)}>Visualizar</Button> : <Button onClick={() => issueDocument(type)} disabled={Boolean(working)}>{working === `document:${type}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Emitir</Button>}</div>
            </motion.div>;
          })}
        </div>
        {allIssued && <div className="mt-6 flex justify-end"><Button onClick={() => issueDocument(types[types.length - 1])} disabled={Boolean(working)}>Continuar <ArrowRight className="ml-2 h-4 w-4" /></Button></div>}
      </StepShell>
    );
  };

  return (
    <>
      <Helmet><title>Registro Nacional de Cidadania - GOV.RP</title><meta name="robots" content="noindex,nofollow" /></Helmet>
      <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#12372a_0,#07111f_38%,#020617_100%)] px-4 pb-12 pt-[max(1rem,env(safe-area-inset-top))] text-white sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:36px_36px]" />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-5 flex items-center justify-between gap-3 border-b border-white/10 pb-4"><div className="flex items-center gap-3"><img src="/icon-192x192.png" alt="GOVRP" className="h-10 w-10 rounded-xl" /><div><p className="font-semibold">Registro Nacional</p><p className="text-xs text-slate-400">Cidadania GOVRP</p></div></div><Button variant="ghost" onClick={logout}><LogOut className="mr-2 h-4 w-4" />Sair</Button></div>

          {currentStep !== 'welcome' && (
            <div className="mb-8 rounded-2xl border border-white/10 bg-slate-950/55 p-4">
              <div className="mb-3 flex items-center justify-between text-xs text-slate-300">
                <span>Etapa {progressIndex + 1} de {PROGRESS_STEPS.length}</span>
                <span>{PROGRESS_STEPS[progressIndex]?.label}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7" aria-label={`Etapa ${progressIndex + 1} de ${PROGRESS_STEPS.length}`}>
                {PROGRESS_STEPS.map((item, index) => (
                  <button
                    key={item.key}
                    type="button"
                    disabled={index > furthestProgressIndex || Boolean(working)}
                    onClick={() => navigateToOnboardingStep(item.key, index)}
                    aria-label={`${index < progressIndex ? 'Voltar para' : 'Ir para'} ${item.label}`}
                    aria-current={item.key === currentStep ? 'step' : undefined}
                    className={`h-2 rounded-full transition-colors disabled:cursor-not-allowed ${index <= furthestProgressIndex ? 'bg-gradient-to-r from-emerald-500 to-blue-500' : 'bg-white/10'} ${item.key === currentStep ? 'ring-2 ring-white/70 ring-offset-2 ring-offset-slate-950' : ''}`}
                  />
                ))}
              </div>
              {progressIndex > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-4"
                  disabled={Boolean(working)}
                  onClick={() => navigateToOnboardingStep(PROGRESS_STEPS[progressIndex - 1].key, progressIndex - 1)}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Voltar para {PROGRESS_STEPS[progressIndex - 1].label}
                </Button>
              ) : null}
            </div>
          )}

          {profile.onboarding_mode === 'legacy_migration' && currentStep !== 'citizenship' && <div className="mx-auto mb-6 max-w-4xl rounded-xl border border-blue-400/20 bg-blue-500/10 p-4 text-sm text-blue-100"><strong>Atualizamos o sistema de cidadania.</strong> Seus documentos, saldo, cargos, partido e histórico foram preservados. Confirme apenas os dados que faltam.</div>}

          <AnimatePresence mode="wait">
            {currentStep === 'welcome' && <StepShell key="welcome" eyebrow="Conta GOVRP criada" title="Bem-vindo ao GOVRP" description="Agora vamos registrar o cidadão que você irá interpretar dentro da nossa nação. Ele terá identidade, documentos, patrimônio, carreira e uma história construída pelas suas decisões.">{accountNeedsCompletion ? <form onSubmit={completeAccount} className="mx-auto max-w-2xl rounded-3xl border border-blue-300/20 bg-slate-950/70 p-6 sm:p-8"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Dados da conta · privados/OOC</p><h2 className="mt-2 text-2xl font-semibold">Complete sua conta</h2><p className="mt-2 text-sm leading-6 text-slate-300">Contas criadas por Google, Facebook ou Discord também precisam dos dados mínimos da pessoa real. Eles não serão exibidos como dados do personagem.</p><div className="mt-6 grid gap-5 sm:grid-cols-2"><div className="sm:col-span-2"><Label htmlFor="oauth-real-name">Nome completo real</Label><Input id="oauth-real-name" className="mt-2" required minLength={3} maxLength={120} value={accountCompletion.realFullName} onChange={(event) => setAccountCompletion((current) => ({ ...current, realFullName: event.target.value }))} /></div><div><Label htmlFor="oauth-real-birth">Nascimento real</Label><Input id="oauth-real-birth" className="mt-2" type="date" required min={`${currentYear - 120}-01-01`} max={`${currentYear - 13}-12-31`} value={accountCompletion.realDateOfBirth} onChange={(event) => setAccountCompletion((current) => ({ ...current, realDateOfBirth: event.target.value }))} /></div><div><Label htmlFor="oauth-phone">Telefone</Label><Input id="oauth-phone" className="mt-2" inputMode="tel" required value={accountCompletion.phone} onChange={(event) => setAccountCompletion((current) => ({ ...current, phone: event.target.value }))} placeholder="DDD + número" /></div></div><div className="mt-6 flex justify-end"><Button type="submit" disabled={Boolean(working)}>{working === 'account' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Confirmar dados privados</Button></div></form> : <div className="mx-auto grid max-w-4xl items-center gap-8 rounded-3xl border border-emerald-300/20 bg-slate-950/60 p-6 sm:p-9 md:grid-cols-[240px_1fr]"><BrazilFlag className="mx-auto h-52 w-52" /><div><h2 className="text-2xl font-semibold">Sua conta existe. Seu cidadão ainda vai nascer.</h2><p className="mt-3 leading-7 text-slate-300">Os dados reais da conta permanecem privados. O nome, o nascimento e a trajetória que você criar agora pertencem ao universo do RP.</p><Button onClick={start} disabled={Boolean(working)} className="mt-6 bg-emerald-600 hover:bg-emerald-700">{working === 'start' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <User className="mr-2 h-5 w-5" />}Criar meu cidadão</Button></div></div>}</StepShell>}

            {currentStep === 'identity' && (
              <StepShell key="identity" eyebrow="Etapa 1 · Identidade" title="Quem será o seu cidadão?" description="Esses dados serão públicos dentro do RP. Eles não alteram seu nome real nem os dados privados da conta.">
                <form onSubmit={saveIdentity} className="grid gap-6 rounded-3xl border border-white/10 bg-slate-950/60 p-5 sm:p-8 md:grid-cols-[230px_1fr]">
                  <div>
                    <button type="button" onClick={() => avatarInputRef.current?.click()} className="group relative mx-auto block h-36 w-36 overflow-hidden rounded-full border-2 border-dashed border-emerald-400/50 bg-slate-900">
                      <img src={identity.avatarUrl || `https://api.dicebear.com/7.x/micah/svg?seed=${identity.username || user.id}`} alt="Prévia do avatar do personagem" className="h-full w-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition group-hover:opacity-100"><ImagePlus /></span>
                    </button>
                    <input ref={avatarInputRef} type="file" accept={IMAGE_ACCEPT_ATTRIBUTE} className="hidden" onChange={(event) => setUploadedAvatarPreview(event.target.files?.[0])} />
                    <Button type="button" variant="outline" size="sm" className="mx-auto mt-3 flex" onClick={() => avatarInputRef.current?.click()}>
                      <ImagePlus className="mr-2 h-4 w-4" /> Enviar minha foto
                    </Button>
                    <p className="mt-2 text-center text-xs text-slate-400">Opcional · a prévia aparece antes de salvar</p>

                    <div className="mt-5 text-left">
                      <Label htmlFor="character-gender">Sexo do personagem</Label>
                      <Select value={identity.gender} onValueChange={(value) => setIdentityField('gender', value)}>
                        <SelectTrigger id="character-gender" className="mt-2"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">Masculino</SelectItem>
                          <SelectItem value="female">Feminino</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {identity.gender ? (
                      <div className="mt-5 text-left">
                        <p className="mb-2 text-xs font-medium text-slate-300">Ou escolha um avatar GOVRP</p>
                        <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2 custom-scrollbar">
                          {CHARACTER_AVATARS[identity.gender].map((avatar) => (
                            <button
                              key={avatar.id}
                              type="button"
                              onClick={() => selectProvidedAvatar(avatar.url)}
                              aria-label={`Selecionar avatar ${avatar.id}`}
                              aria-pressed={identity.avatarUrl === avatar.url}
                              className={`aspect-square overflow-hidden rounded-lg border-2 transition ${identity.avatarUrl === avatar.url ? 'border-emerald-400 ring-2 ring-emerald-400/20' : 'border-transparent hover:border-white/40'}`}
                            >
                              <img src={avatar.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-5">
                    <div>
                      <Label htmlFor="character-name">Nome civil do personagem</Label>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <Input id="character-name" required minLength={5} maxLength={80} value={identity.fullName} onChange={(event) => setIdentityField('fullName', event.target.value)} placeholder="Ricardo Almeida Monteiro" />
                        <Button type="button" variant="outline" onClick={() => setIdentityField('fullName', state.account_identity?.real_full_name || user.real_full_name || '')}>Usar meu nome real</Button>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">Nomes civis podem se repetir; CPF, ID e @username são únicos.</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="character-birth">Nascimento do cidadão</Label>
                        <div className="mt-2">
                          <CharacterBirthDate
                            value={identity.dateOfBirth}
                            onChange={(value) => setIdentityField('dateOfBirth', value)}
                            minDate={minimumCharacterBirthDate}
                            maxDate={maximumCharacterBirthDate}
                          />
                        </div>
                        <p id="character-birth-hint" className="mt-1 text-xs text-slate-400">Digite no formato brasileiro ou use o calendário.</p>
                      </div>
                      <div>
                        <Label htmlFor="character-username">@username público</Label>
                        <Input id="character-username" className="mt-2" required minLength={3} maxLength={20} value={identity.username} onChange={(event) => setIdentityField('username', event.target.value.toLowerCase())} placeholder="ricardo.monteiro" />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="character-bio">Biografia inicial <span className="text-slate-400">(opcional)</span></Label>
                      <textarea id="character-bio" maxLength={300} value={identity.bio} onChange={(event) => setIdentityField('bio', event.target.value)} className="mt-2 min-h-24 w-full rounded-md border border-white/10 bg-slate-950/80 p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Advogado paulista interessado em política e economia." />
                      <p className="text-right text-xs text-slate-500">{identity.bio.length}/300</p>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={!identity.gender || Boolean(working)}>
                        {working === 'identity' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar identidade
                      </Button>
                    </div>
                  </div>
                </form>
              </StepShell>
            )}

            {currentStep === 'origin' && <StepShell key="origin" eyebrow="Etapa 2 · Origem" title="De onde vem o seu cidadão?" description="Nascimento e residência são informações distintas e estruturadas com códigos oficiais do IBGE."><form onSubmit={saveOrigin} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 sm:p-8"><div className="mb-6 grid items-center gap-5 rounded-2xl border border-emerald-400/15 bg-emerald-500/5 p-4 sm:grid-cols-[90px_1fr]"><BrazilFlag className="mx-auto h-20 w-20" /><div><p className="font-semibold">País de nascimento e residência</p><p className="text-slate-300">🇧🇷 Brasil <span className="text-xs text-slate-500">· único país disponível nesta versão</span></p></div></div><div className="grid gap-6 md:grid-cols-2"><fieldset className="space-y-5 rounded-2xl border border-white/10 p-5"><legend className="px-2 font-semibold"><Flag className="mr-2 inline h-4 w-4" />Nascimento</legend><FieldSelect id="birth-state" label="Estado de nascimento" value={origin.birthState} onChange={(value) => setOrigin((current) => ({ ...current, birthState: value, birthCity: '' }))}><option value="">Selecione</option>{BRAZIL_STATES.map((stateItem) => <option key={stateItem.code} value={stateItem.code}>{stateItem.name}</option>)}</FieldSelect><FieldSelect id="birth-city" label="Município de nascimento" value={origin.birthCity} onChange={(value) => setOriginField('birthCity', value)} disabled={!origin.birthState || locationsLoading.birth}><option value="">{locationsLoading.birth ? 'Carregando municípios…' : 'Selecione'}</option>{birthCities.map((city) => <option key={city.code} value={city.code}>{city.name}</option>)}</FieldSelect></fieldset><fieldset className="space-y-5 rounded-2xl border border-white/10 p-5"><legend className="px-2 font-semibold"><MapPin className="mr-2 inline h-4 w-4" />Residência</legend><FieldSelect id="residence-state" label="Estado de residência" value={origin.residenceState} onChange={(value) => setOrigin((current) => ({ ...current, residenceState: value, residenceCity: '' }))}><option value="">Selecione</option>{BRAZIL_STATES.map((stateItem) => <option key={stateItem.code} value={stateItem.code}>{stateItem.name}</option>)}</FieldSelect><FieldSelect id="residence-city" label="Município de residência" value={origin.residenceCity} onChange={(value) => setOriginField('residenceCity', value)} disabled={!origin.residenceState || locationsLoading.residence}><option value="">{locationsLoading.residence ? 'Carregando municípios…' : 'Selecione'}</option>{residenceCities.map((city) => <option key={city.code} value={city.code}>{city.name}</option>)}</FieldSelect></fieldset></div>{locationError && <p role="alert" className="mt-4 text-sm text-red-300">{locationError}</p>}<div className="mt-6 flex justify-end"><Button type="submit" disabled={Boolean(working) || locationsLoading.birth || locationsLoading.residence}>{working === 'origin' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}Confirmar origem e residência</Button></div></form></StepShell>}

            {currentStep === 'profile' && <StepShell key="profile" eyebrow="Etapa 3 · Perfil" title="Quem é o seu cidadão?" description="A aspiração apenas personaliza recomendações e o tutorial. Ela não concede cargo, dinheiro, atributos ou vantagens."><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{ASPIRATIONS.map(({ key, title, icon: Icon, description }) => <button key={key} type="button" onClick={() => setAspiration(key)} className={`rounded-2xl border p-5 text-left transition ${aspiration === key ? 'border-emerald-400 bg-emerald-500/10 ring-2 ring-emerald-400/20' : 'border-white/10 bg-slate-950/60 hover:border-white/25'}`}><div className="flex items-center gap-3"><Icon className="h-7 w-7 text-emerald-300" /><h2 className="font-semibold">{title}</h2>{aspiration === key && <Check className="ml-auto h-5 w-5 text-emerald-400" />}</div><p className="mt-3 text-sm leading-6 text-slate-400">{description}</p></button>)}</div><div className="mt-6 flex justify-end"><Button onClick={saveAspiration} disabled={!aspiration || Boolean(working)}>{working === 'profile' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}Continuar</Button></div></StepShell>}

            {currentStep === 'civil_documents' && <React.Fragment key="civil">{renderDocuments(['CPF', 'RG'], 'Sua identidade está sendo registrada', 'CPF e RG são gerados de forma única pelo backend e passam a pertencer ao cidadão, nunca à conta real.')}</React.Fragment>}
            {currentStep === 'mandatory_documents' && <React.Fragment key="mandatory">{renderDocuments(['Título de Eleitor', 'CTD'], 'Documentos para a vida pública e profissional', 'O Título permite exercer direitos políticos; a Carteira de Trabalho acompanhará sua trajetória profissional.')}</React.Fragment>}

            {currentStep === 'initial_status' && <StepShell key="status" eyebrow="Etapa 6 · Situação inicial" title="Seu cidadão está pronto para começar" description="Os dados abaixo são consultados nos sistemas reais. Nenhuma informação foi sorteada ou inventada."><div className="grid gap-5 lg:grid-cols-[1fr_320px]"><div className="rounded-3xl border border-white/10 bg-slate-950/60 p-6"><div className="mb-6 flex items-center gap-4"><img src={profile.avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${profile.username}`} alt="Avatar do cidadão" className="h-16 w-16 rounded-full object-cover" /><div><h2 className="text-xl font-semibold">{profile.full_name}</h2><p className="text-slate-400">{profile.residence_city_name || 'Município a confirmar'}/{profile.residence_state_code}</p></div></div><dl className="grid gap-4 sm:grid-cols-2">{[[Landmark, 'Cargo', profile.role || 'Cidadão'], [Flag, 'Partido', profile.party_affiliation ? 'Filiação ativa' : 'Sem filiação'], [Briefcase, 'Ocupação', profile.occupation || 'Desempregado'], [FileText, 'Antecedentes', profile.criminal_status || 'Nada consta'], [Sparkles, 'Reputação', (profile.reputation_points || 0) === 0 ? 'Neutra' : `${profile.reputation_points} pontos`], [Vote, 'Título de Eleitor', getDocument(documents, 'Título de Eleitor') ? 'Emitido' : 'Não possui']].map(([Icon, label, value]) => <div key={label} className="rounded-xl bg-white/5 p-4"><dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400"><Icon className="h-4 w-4" />{label}</dt><dd className="mt-2 font-medium">{value}</dd></div>)}</dl></div><div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/5 p-6"><Building2 className="h-9 w-9 text-emerald-300" /><h2 className="mt-4 text-xl font-semibold">Sua vida financeira</h2>{state.bank_account ? <><p className="mt-3 text-sm text-slate-300">Sua conta existente foi preservada.</p><p className="mt-5 text-2xl font-bold text-emerald-300">{formatCurrency(state.bank_account.balance)}</p></> : <p className="mt-3 text-sm leading-6 text-slate-300">Abra uma conta no Banco Nacional. O saldo inicial usa a configuração econômica vigente.</p>}<Button onClick={openBankAccount} disabled={Boolean(working)} className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700">{working === 'bank' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}{state.bank_account ? 'Preservar conta e continuar' : 'Abrir minha conta'}</Button></div></div></StepShell>}

            {currentStep === 'citizenship' && !ceremony && <StepShell key="finalize" eyebrow="Etapa 7 · Cidadania" title="Reconhecimento oficial" description="O backend verificará identidade, origem, quatro documentos e conta bancária antes de conceder a cidadania."><div className="mx-auto max-w-2xl rounded-3xl border border-emerald-400/20 bg-slate-950/70 p-8 text-center"><BadgeCheck className="mx-auto h-20 w-20 text-emerald-300" /><h2 className="mt-5 text-2xl font-semibold">{profile.full_name}</h2><p className="mt-2 text-slate-300">{profile.residence_city_name}/{profile.residence_state_code} · @{profile.username}</p><Button onClick={finalize} disabled={Boolean(working)} className="mt-7 bg-emerald-600 px-7 hover:bg-emerald-700">{working === 'finalize' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-5 w-5" />}Conceder cidadania</Button></div></StepShell>}

            {ceremony && <StepShell key="ceremony" eyebrow="República Digital" title="🇧🇷 Cidadania concedida" description={`O Governo da República Digital reconhece oficialmente ${officialUser.full_name} como cidadão do GOVRP.`}><motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-amber-300/30 bg-[linear-gradient(145deg,rgba(6,78,59,.8),rgba(15,23,42,.95))] p-6 shadow-2xl sm:p-9"><div className="grid items-center gap-7 sm:grid-cols-[150px_1fr]"><div className="text-center"><img src={officialUser.avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${officialUser.username}`} alt="Avatar oficial" className="mx-auto h-32 w-32 rounded-full border-4 border-amber-300/50 object-cover" /><BrazilFlag className="mx-auto mt-3 h-16 w-16" /></div><div><p className="text-xs uppercase tracking-[0.2em] text-amber-200">Certificado de cidadania</p><h2 className="mt-2 text-3xl font-bold">{officialUser.full_name}</h2><p className="mt-2 text-slate-300">Nascimento: {new Date(`${officialUser.date_of_birth}T00:00:00`).toLocaleDateString('pt-BR')}</p><p className="text-slate-300">Residência: {officialUser.residence_city_name}/{officialUser.residence_state_code}</p><p className="mt-3 text-sm text-emerald-200">Concedida em {new Date(officialUser.citizenship_created_at).toLocaleString('pt-BR')}</p></div></div><div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{['CPF', 'RG', 'Título de Eleitor', 'CTD'].map((type) => { const document = getDocument(documents, type); return <button type="button" key={type} onClick={() => setPreviewDocument(document)} className="rounded-xl border border-white/10 bg-black/20 p-3 text-left"><span className="text-xs text-slate-400">{type}</span><span className="mt-1 block truncate text-sm font-medium">{document?.document_number}</span></button>; })}</div><div className="mt-8 text-center"><Button onClick={enterGovrp} size="lg" className="bg-amber-500 text-slate-950 hover:bg-amber-400">Entrar no GOVRP <ArrowRight className="ml-2 h-5 w-5" /></Button><p className="mt-3 text-xs text-slate-400">Seu tutorial será personalizado para {selectedAspiration?.title || 'sua jornada'}.</p></div></motion.div></StepShell>}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>{previewDocument && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={`Visualização do ${previewDocument.type}`}><OfficialDocument user={officialUser} doc={previewDocument} onBack={() => setPreviewDocument(null)} /></motion.div>}</AnimatePresence>
    </>
  );
};

export default CitizenOnboarding;
