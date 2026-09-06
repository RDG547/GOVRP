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
      const { data, error } = await supabase.from('notifications').select('id,metadata')
        .eq('user_id', user.id).eq('type', 'party_membership_confirmed')
        .is('metadata->>celebration_seen_at', null).order('created_at').limit(20);
      if (error) throw error;
      if (!state.active) return;
      let nextWelcome = null;
      for (const event of data || []) {
        const [party] = await fetchPublicParties(event.metadata?.party_id);
        if (!state.active) return;
        if (!party?.members.some(member => member.id === event.metadata?.membership_id && member.user_id === user.id)) {
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
  return <Dialog open={Boolean(welcome)} onOpenChange={(open) => { if (!open) void acknowledge(); }}>
    <DialogContent className="overflow-hidden sm:max-w-lg">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 18 }, (_, i) => <span key={i} className="absolute h-2 w-1 rounded-sm bg-primary/40 motion-safe:animate-pulse" style={{ left: `${(i * 37) % 100}%`, top: `${(i * 23) % 45}%`, transform: `rotate(${i * 19}deg)`, animationDelay: `${i * 80}ms` }} />)}
      </div>
      <DialogHeader className="relative pt-4 text-center sm:text-center">
        {welcome?.party.logo_url ? <img src={welcome.party.logo_url} alt="" className="mx-auto mb-3 h-20 w-20 rounded-full border bg-background object-cover" /> : <Flag className="mx-auto mb-3 h-16 w-16 text-primary" />}
        <DialogTitle className="text-2xl">Sua vida partidária começa agora!</DialogTitle>
        <DialogDescription>Você faz parte do {welcome?.party.name} ({welcome?.party.acronym}). Sua filiação está confirmada.</DialogDescription>
      </DialogHeader>
      <div className="relative space-y-4 py-2">
        <p className="text-sm leading-relaxed">Conheça seus colegas, participe das decisões e construa sua trajetória política. Suas ideias podem ajudar a definir o futuro do país.</p>
        <div className="rounded-lg bg-secondary p-3 text-sm">
          <p><strong>Presidência:</strong> {welcome?.party.president?.full_name || 'Cargo vago'}</p>
          <p><strong>Vice-presidência:</strong> {welcome?.party.vice_president?.full_name || 'Cargo vago'}</p>
        </div>
        <Button className="w-full" disabled={saving} onClick={() => acknowledge(true)}><PartyPopper className="mr-2 h-4 w-4" />Conhecer meu partido<ArrowRight className="ml-2 h-4 w-4" /></Button>
        <Button className="w-full" variant="ghost" disabled={saving} onClick={() => acknowledge()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Continuar minha jornada</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
