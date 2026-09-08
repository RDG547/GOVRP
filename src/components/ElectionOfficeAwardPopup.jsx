import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Crown, Loader2, Landmark, Check, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { roleEventPresentation } from '@/lib/roleEvents';

// Reuses the office popup for every official role transition, including removals.
export default function ElectionOfficeAwardPopup() {
 const { user } = useAuth();
 const navigate = useNavigate();
 const { toast } = useToast();
 const [notification, setNotification] = useState(null);
 const request = useRef(0);
 const [saving, setSaving] = useState(false);
 const fetchPending = useCallback(async () => {
   const sequence = ++request.current;
   if (!user?.id) { setNotification(null); return; }
   const { data, error } = await supabase.from('notifications').select('id,content,link,created_at,type,metadata')
     .eq('user_id', user.id).eq('type', 'role_changed').is('metadata->>popup_shown_at', null).order('created_at').limit(1).maybeSingle();
   if (sequence !== request.current) return;
   if (error) console.error('Não foi possível consultar mudanças de cargo', error);
   else setNotification(data);
 }, [user?.id]);
 useEffect(() => { setNotification(null); void fetchPending(); return () => { request.current++; }; }, [fetchPending]);
 useDomainRealtime('role-notifications', user?.id, [{ table: 'notifications', filter: `user_id=eq.${user?.id}` }], fetchPending, Boolean(user?.id));
 const close = async (destination) => {
   if (!notification || saving) return;
   setSaving(true);
   try {
     const { error } = await supabase.rpc('acknowledge_role_change', { p_notification_id: notification.id });
     if (error) throw error;
     setNotification(null);
     if (destination) navigate(destination);
     await fetchPending();
   } catch (error) {
     console.error('Falha ao confirmar ciência do cargo', error);
     toast({ title: 'Não foi possível confirmar a leitura', description: 'Tente novamente.', variant: 'destructive' });
   } finally { setSaving(false); }
 };
 if (!user || !notification) return null;
 const info = roleEventPresentation(notification);
 const Icon = info.loss ? Landmark : Crown;
 return <Dialog open onOpenChange={open => { if (!open) void close(); }}>
   <DialogContent className="max-w-md" onInteractOutside={event => event.preventDefault()}>
     <DialogHeader>
       <Icon className={`mb-3 h-10 w-10 ${info.loss ? 'text-slate-400' : 'text-amber-400'}`} />
       <DialogTitle>{info.title}</DialogTitle>
       <DialogDescription>{notification.content}</DialogDescription>
     </DialogHeader>
     <p className="text-2xl font-semibold">{info.role}</p>
     <p className="text-sm text-muted-foreground">{info.description}</p>
     <div className="flex flex-col gap-2">
       <Button disabled={saving} onClick={() => close(info.to)}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}{info.action}</Button>
       <Button disabled={saving} variant="outline" onClick={() => close()}><Check className="mr-2 h-4 w-4" />Entendi</Button>
     </div>
   </DialogContent>
 </Dialog>;
}
