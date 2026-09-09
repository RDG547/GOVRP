import React, { useEffect, useState } from 'react';
import { HeartPulse, Utensils, Droplets, ShowerHead, Users, Moon, ShoppingBasket, Home, Package, Loader2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCitizenNeeds } from '@/contexts/CitizenNeedsContext';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

export const NEEDS = [
  { key: 'health', name: 'Saúde', icon: HeartPulse, color: 'bg-rose-500', text: 'text-rose-400' },
  { key: 'hunger', name: 'Fome', icon: Utensils, color: 'bg-orange-500', text: 'text-orange-400' },
  { key: 'thirst', name: 'Sede', icon: Droplets, color: 'bg-blue-500', text: 'text-blue-400' },
  { key: 'hygiene', name: 'Higiene', icon: ShowerHead, color: 'bg-cyan-500', text: 'text-cyan-400' },
  { key: 'social', name: 'Socialização', icon: Users, color: 'bg-purple-500', text: 'text-purple-400' },
  { key: 'sleep', name: 'Sono', icon: Moon, color: 'bg-indigo-500', text: 'text-indigo-400' },
];
export default function CitizenNeedsHUD({ mobile = false }) {
  const { user } = useAuth();
  const context = useCitizenNeeds();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const close = () => setOpen(false);
    media.addEventListener('change', close);
    return () => media.removeEventListener('change', close);
  }, []);
  useEffect(() => {
    if (!open) return;
    const escape = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);
  if (!user?.onboarding_completed || !context) return null;
  const { needs, error, refresh } = context;
  return <div className={mobile ? 'flex items-center justify-center' : 'fixed bottom-5 left-5 z-40 hidden md:block'}>
    <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" aria-label="Estado do cidadão" title="Estado do cidadão" onClick={() => { void refresh(); }} className={`${mobile ? '-mt-5 h-14 w-14' : 'h-12 w-12'} flex items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-lg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}><HeartPulse className="h-7 w-7" /></button></PopoverTrigger>
    <PopoverContent onEscapeKeyDown={()=>setOpen(false)} side="top" align={mobile ? 'center' : 'start'} sideOffset={12} className="z-[90] w-[min(350px,calc(100vw-1.5rem))] max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl bg-popover p-4 shadow-xl">
      <button type="button" aria-label="Fechar estado do cidadão" onClick={()=>setOpen(false)} className="float-right flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4"/></button><div className="mb-4 flex gap-3"><img src={user.avatar_url || '/logo.png'} alt="" className="h-12 w-12 rounded-full object-cover" /><div className="min-w-0"><h2 className="font-semibold">Estado do cidadão</h2><p className="break-words text-sm">{user.full_name}</p><p className="text-xs text-muted-foreground">{needs?.age_rp ?? '…'} anos no RP</p></div></div>
      {error ? <p role="status" className="text-sm">{error}</p> : !needs ? <Loader2 className="animate-spin" /> : <div className="space-y-3">{NEEDS.map(({key,name,icon:Icon,color,text}) => { const value=Math.round(Number(needs[key])); return <div key={key}><div className="mb-1 flex justify-between text-sm"><span className={`flex items-center gap-2 ${text}`}><Icon className="h-4 w-4" />{name}</span><span>{value}%{value<20 ? ' · Atenção' : ''}</span></div><div role="progressbar" aria-label={name} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${color}`} style={{width:`${value}%`}} /></div></div>; })}</div>}
      {needs?.grace_until_rp > needs?.rp_now && <p className="mt-3 text-xs text-muted-foreground">Período de adaptação: conheça seu cidadão com tranquilidade.</p>}
      <div className="mt-4 grid grid-cols-3 gap-2">{[{to:'/services/national-market',label:'Mercado',icon:ShoppingBasket},{to:'/services/inventory',label:'Meus itens',icon:Package},{to:'/services/national-housing',label:'Moradia',icon:Home}].map(({to,label,icon:Icon})=><Button key={to} asChild variant="outline" size="sm" className="h-auto flex-col gap-1 py-2"><Link to={to} onClick={()=>setOpen(false)}><Icon className="h-4 w-4" />{label}</Link></Button>)}</div>
    </PopoverContent></Popover>
  </div>;
}
