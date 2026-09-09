import CelebrationBackdrop from '@/components/CelebrationBackdrop';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PartyPopper, ArrowRight, Check, Loader2, Flag } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { fetchPublicParties } from '@/lib/parties';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export default function PartyMembershipWelcome() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [welcome, setWelcome] = useState(null);
  const [saving, setSaving] = useState(false);
  const loadingState = useRef(null);
  const load = useCallback(async () => {
    const state = loadingState.current;
    if (!user?.id || !state?.active || state.userId !== user.id) return;
    if (state.busy) { state.queued = true; return; }
    state.busy = true;
    state.queued = false;
    try {
      const { data, error } = await supabase.from('notifications').select('id,type,metadata')
        .eq('user_id', user.id).in('type', ['party_membership_confirmed', 'party_approved'])
        .is('metadata->>celebration_seen_at', null).order('created_at').limit(20);
      if (error) throw error;
      if (!state.active) return;
      let nextWelcome = null;
      for (const event of data || []) {
        const [party] = await fetchPublicParties(event.metadata?.party_id);
        if (!state.active) return;
        if (!party || (event.type === 'party_membership_confirmed' && !party.members.some(member => member.id === event.metadata?.membership_id && member.user_id === user.id))) {
          const result = await supabase.rpc('acknowledge_party_welcome', { p_notification_id: event.id });
          if (result.error) throw result.error;
          continue;
        }
        nextWelcome = { ...event, party };
        break;
      }
      if (state.active) setWelcome(nextWelcome);
    } catch (error) {
      console.warn('Não foi possível consultar a confirmação de filiação:', error.message);
    } finally {
      state.busy = false;
      if (state.queued && state.active) void load();
    }
  }, [user?.id]);
  useEffect(() => {
    const state = { userId: user?.id, active: true, busy: false, queued: false };
    loadingState.current = state;
    setWelcome(null);
    void load();
    return () => { state.active = false; };
  }, [load, user?.id]);
  useDomainRealtime('party-welcome', user?.id, [
    { table: 'notifications', filter: `user_id=eq.${user?.id}` },
    { table: 'party_members', filter: `user_id=eq.${user?.id}` },
  ], load, Boolean(user?.id));

  const acknowledge = async (visit = false) => {
    if (!welcome || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('acknowledge_party_welcome', { p_notification_id: welcome.id });
      if (error) throw error;
      const path = `/services/political-parties/${welcome.party.id}`;
      setWelcome(null);
      if (visit) navigate(path);
      void load();
    } catch {
      toast({ title: 'Não foi possível concluir', description: 'Tente novamente para registrar que você viu sua confirmação.', variant: 'destructive' });
    } finally { setSaving(false); }
  };
  return <><CelebrationBackdrop active={Boolean(welcome)} /><Dialog open={Boolean(welcome)} onOpenChange={(open) => { if (!open) void acknowledge(); }}>
    <DialogContent className="z-[60] sm:max-w-lg">
      <DialogHeader className="relative pt-4 text-center sm:text-center">
        {welcome?.party.logo_url ? <img src={welcome.party.logo_url} alt="" className="mx-auto mb-3 h-20 w-20 rounded-full border bg-background object-cover" /> : <Flag className="mx-auto mb-3 h-16 w-16 text-primary" />}
        <DialogTitle className="text-2xl">{welcome?.type === 'party_approved' ? 'Seu partido foi aprovado!' : `Parabéns, ${user?.full_name?.split(' ')[0]}!`}</DialogTitle>
        <DialogDescription>{welcome?.type === 'party_approved' ? `O ${welcome.party.name} (${welcome.party.acronym}) está oficialmente ativo. Como liderança, você já pode organizar a participação do partido na vida política.` : `Você faz parte do ${welcome?.party.name} (${welcome?.party.acronym}). Sua filiação está confirmada.`}</DialogDescription>
      </DialogHeader>
      <div className="relative space-y-4 py-2">
        <p className="text-sm leading-relaxed">Participe das decisões internas, converse com a presidência e a liderança e conquiste espaço na hierarquia partidária. Você poderá construir influência, buscar indicação e disputar eleições pelo partido, traçando seu caminho até o Parlamento ou a Presidência.</p>
        <div className="rounded-lg bg-secondary p-3 text-sm">
          <p><strong>Dono:</strong> {welcome?.party.owner?.full_name || 'Não informado'}</p>
          <p><strong>Fundador:</strong> {welcome?.party.founder?.full_name || 'Não informado'}</p>
          <p><strong>Presidência:</strong> {welcome?.party.president?.full_name || 'Cargo vago'}</p>
          <p><strong>Vice-presidência:</strong> {welcome?.party.vice_president?.full_name || 'Cargo vago'}</p>
        </div>
        <Button className="w-full" disabled={saving} onClick={() => acknowledge(true)}><PartyPopper className="mr-2 h-4 w-4" />Conhecer meu partido<ArrowRight className="ml-2 h-4 w-4" /></Button>
        <Button className="w-full" variant="ghost" disabled={saving} onClick={() => acknowledge()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Continuar minha jornada</Button>
      </div>
    </DialogContent>
  </Dialog></>;
}
