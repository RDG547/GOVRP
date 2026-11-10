import { usePopupSlot, PopupQueueActions } from '@/contexts/PopupQueueContext';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Landmark, Check, Loader2, Users, ArrowRight, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import CitizenSelector from '@/components/CitizenSelector';
import MinistryMergeManager from '@/components/government/MinistryMergeManager';
import { roleIcon } from '@/lib/roleIcons';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function PresidentialFormationGuide() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [formation, setFormation] = useState(null);
  const [pendingRole, setPendingRole] = useState(true);
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(null);
  const [countdown, setCountdown] = useState(10);
  const loadSequence = useRef(0);

  const canGovern = user?.role === 'Presidente' || Boolean(user?.effective_roles?.includes('Presidente'));
  const cabinetPending = formation?.government?.cabinet_decision === 'pending';
  const ministries = formation?.ministries || [];
  const offices = formation?.offices || [];
  const remaining = Number(formation?.remaining ?? 0);
  const completed = Boolean(formation?.completed_at);
  const pendingMinistry = ministries.find(item =>
    !item.merged_into_id && !item.holder_id
    && !(item.invitation?.status === 'pending' && Date.parse(item.invitation.expires_at) > Date.now())
  );
  const pendingOffice = offices.find(item =>
    !item.appointment?.user_id
    && !(item.invitation?.status === 'pending'
      || (item.invitation?.status === 'accepted' && ['hearing', 'voting'].includes(item.invitation?.institutional_stage)))
  );
  const target = pendingMinistry || pendingOffice;
  const candidateOffice = pendingMinistry ? 'minister' : pendingOffice?.office_key;
  const officeTitle = pendingMinistry ? `Ministério: ${pendingMinistry.name}` : pendingOffice?.role_label;
  const TargetIcon = pendingMinistry ? Users : roleIcon(pendingOffice?.role_label);
  const appointedMinisters = Number(formation?.appointed_ministers ?? 0);
  const requiredMinisters = Number(formation?.required_ministers ?? 0);
  const appointedOffices = Number(formation?.appointed_offices ?? 0);
  const requiredOffices = Number(formation?.required_offices ?? 0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!canGovern) { setFormation(null); return; }
    const [f, roles] = await Promise.all([
      supabase.rpc('get_presidential_formation'),
      supabase.rpc('get_pending_office_notification'),
    ]);
    if (sequence !== loadSequence.current) return;
    if (f.error || roles.error) {
      console.warn('Formação presidencial:', f.error || roles.error);
      return;
    }
    setFormation(current => JSON.stringify(current) === JSON.stringify(f.data) ? current : f.data);
    setPendingRole(Boolean(roles.data?.id));
  }, [canGovern]);

  useEffect(() => { void load(); }, [load]);
  useDomainRealtime(
    'presidential-formation',
    user?.id,
    [{ table: 'notifications', filter: `user_id=eq.${user?.id}` },
      'ministers', 'system_settings', 'presidential_formation', 'profiles',
      'government_terms', 'minister_invitations'],
    load,
    canGovern
  );
  useEffect(() => { setSelected(''); }, [candidateOffice, pendingMinistry?.id]);

  const appoint = async () => {
    if (!selected || saving || !target) return;
    setSaving(true);
    try {
      const result = pendingMinistry
        ? await supabase.rpc('appoint_minister', { p_user_id: selected, p_ministry: pendingMinistry.name })
        : await supabase.rpc('manage_executive_appointment', {
          p_office_key: pendingOffice.office_key, p_user_id: selected,
          p_note: 'Formação inicial do Governo.',
        });
      if (result.error) throw result.error;
      if (result.data?.success === false) throw new Error(result.data.message);
      setSelected('');
      await load();
      toast({ title: 'Convite enviado', description: 'O cidadão terá 24 horas para responder. Apenas a posse conta como cargo preenchido.' });
    } catch (error) {
      toast({ title: 'Convite não enviado', description: error.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const chooseCabinet = async choice => {
    setSaving(true);
    try {
      const result = await supabase.rpc('choose_government_cabinet', { p_choice: choice });
      if (result.error) throw result.error;
      await load();
      toast({ title: choice === 'keep' ? 'Equipe mantida' : 'Nova equipe em formação' });
    } catch (error) {
      toast({ title: 'Não foi possível escolher a equipe', description: error.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const complete = async () => {
    if (saving || remaining > 0 || cabinetPending) return;
    setSaving(true);
    try {
      const result = await supabase.rpc('complete_presidential_formation');
      if (result.error) throw result.error;
      setDismissed(`${formation.id}:${formation.revision || 'initial'}`);
      navigate('/dashboard/president');
      toast({ title: 'Formação do Governo concluída' });
    } catch (error) {
      toast({ title: 'Formação ainda incompleta', description: error.message, variant: 'destructive' });
      await load();
    } finally { setSaving(false); }
  };

  const open = Boolean(formation && !pendingRole && !completed &&
    `${formation.id}:${formation.revision || 'initial'}` !== dismissed);
  const waitingKey = open && !cabinetPending && remaining > 0 && !target && formation?.awaiting
    ? `${formation.id}:${formation.revision || 'initial'}` : null;

  useEffect(() => {
    if (!waitingKey) return;
    const deadline = Date.now() + 10000;
    setCountdown(10);
    const timer = setInterval(() => {
      const value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setCountdown(value);
      if (!value) { setDismissed(waitingKey); clearInterval(timer); }
    }, 200);
    return () => clearInterval(timer);
  }, [waitingKey]);

  const slot = usePopupSlot(open ? `formation:${formation?.id}` : null, { priority: 30 });
  return (
    <Dialog open={open && slot}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto [&>button]:hidden"
        onEscapeKeyDown={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}>
        <DialogHeader>
          <Landmark className="mx-auto h-10 w-10 text-primary" />
          <DialogTitle className="text-center">
            {cabinetPending ? 'Como deseja conduzir o Governo?' :
              remaining === 0 ? 'Governo pronto' : target ? 'Forme seu Governo' : formation?.awaiting ? 'Aguardando sua equipe' : 'Forme seu Governo'}
          </DialogTitle>
          <DialogDescription className="text-center">
            {cabinetPending
              ? 'Você assumiu por sucessão. Escolha manter o gabinete atual ou formar um novo.'
              : 'Todos os ministérios independentes e as chefias estratégicas obrigatórias precisam estar preenchidos. Você pode mesclar pastas para reduzir o número de ministros necessários.'}
          </DialogDescription>
        </DialogHeader>
        <PopupQueueActions />

        {cabinetPending ? (
          <div className="grid gap-3">
            <Button disabled={saving} onClick={() => void chooseCabinet('keep')}>
              <Users className="mr-2 h-4 w-4" /> Manter atual equipe ministerial
            </Button>
            <Button variant="outline" disabled={saving} onClick={() => void chooseCabinet('reform')}>
              <Landmark className="mr-2 h-4 w-4" /> Formar nova equipe ministerial
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/70 bg-card/50 p-3 text-sm">
              <div>Ministérios com titular: <strong>{appointedMinisters}/{requiredMinisters}</strong></div>
              <div>Chefias obrigatórias: <strong>{appointedOffices}/{requiredOffices}</strong></div>
              <div className="mt-1 font-semibold">{remaining} cargo(s) ainda precisam ser preenchidos.</div>
            </div>

            {remaining === 0 ? (
              <Button className="w-full" disabled={saving} onClick={() => void complete()}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                Concluir formação do Governo
              </Button>
            ) : target ? (
              <div className="space-y-3 rounded-xl border border-border/60 p-3">
                <h3 className="flex items-center gap-2 font-semibold">
                  <TargetIcon className="h-4 w-4" /> {officeTitle}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {pendingMinistry
                    ? 'Selecione um cidadão para assumir esta pasta ministerial.'
                    : 'Esta chefia executiva precisa de nomeação aceita e efetivada.'}
                </p>
                <CitizenSelector key={`${candidateOffice}:${pendingMinistry?.id || 'office'}`}
                  label="Selecionar cidadão" executiveOffice={candidateOffice}
                  value={selected} onChange={setSelected} disabled={saving} />
                <Button className="w-full" disabled={!selected || saving} onClick={() => void appoint()}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  Enviar convite
                </Button>
              </div>
            ) : (
              <div className="space-y-3 text-center text-sm">
                <ShieldCheck className="mx-auto h-6 w-6 text-primary" />
                <p>{formation.awaiting || 0} convite(s) aguardam resposta. O cargo será preenchido após o aceite.</p>
                {waitingKey && (
                  <>
                    <p>Esta janela fechará em {countdown} segundos.</p>
                    <progress aria-label="Tempo para fechar" max="10" value={countdown}
                      className="h-2 w-full accent-primary" />
                  </>
                )}
                <Button variant="outline" onClick={() => setDismissed(`${formation.id}:${formation.revision || 'initial'}`)}>
                  Continuar enquanto aguardo
                </Button>
              </div>
            )}

            <MinistryMergeManager compact ministries={ministries}
              occupiedMinistries={ministries.filter(item => item.holder_id).map(item => item.name)}
              onUpdate={load} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
