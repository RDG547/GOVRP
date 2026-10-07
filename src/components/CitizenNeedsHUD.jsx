import { NEEDS } from '@/lib/citizenNeedsPresentation';
import Inventory from '@/components/dashboard/Inventory';
import { ArrowLeft } from 'lucide-react';
import { MoreHorizontal, Smartphone } from 'lucide-react';
import CitizenResidences from '@/components/CitizenResidences';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import CitizenConsumables from '@/components/CitizenConsumables';
import React, { useEffect, useState } from 'react';
import { HeartPulse, Utensils, Droplets, ShowerHead, Users, Moon, ShoppingBasket, Home, Package, Loader2, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCitizenNeeds } from '@/contexts/CitizenNeedsContext';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

export { NEEDS } from '@/lib/citizenNeedsPresentation';

export default function CitizenNeedsHUD({ mobile = false }) {
  const { user } = useAuth();
  const context = useCitizenNeeds();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [housing, setHousing] = useState(false);
  const [inventory, setInventory] = useState(false);
  const [residences, setResidences] = useState([]);
  const [housingBusy, setHousingBusy] = useState(false);
  const loadHomes = async () => {
    const result = await supabase.rpc('get_my_residences');
    if (result.error) throw result.error;
    setResidences(result.data || []);
    return result.data || [];
  };
  const showHomes = async () => {
    if (housingBusy) return;
    setHousingBusy(true);
    try {
      const homes = await loadHomes();
      if (!homes.length) {
        toast({ title: 'Você ainda não possui uma moradia', description: 'Conheça as ofertas da Imobiliária Nacional.' });
        setOpen(false); navigate('/services/national-housing');
      } else { setConsumables(false); setInventory(false); setHousing(true); }
    } catch { toast({ title: 'Não foi possível carregar suas moradias', variant: 'destructive' }); }
    finally { setHousingBusy(false); }
  };
  useDomainRealtime('citizen-residences', user?.id, ['citizen_residences', 'residence_leases'], () => { void loadHomes().catch(()=>{}); }, Boolean(user?.id && housing));
  const [open, setOpen] = useState(false);
  const [launcher,setLauncher] = useState(true);
  const [consumables, setConsumables] = useState(false);
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
    <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" aria-label={mobile?'Abrir menu do cidadão':'Estado do cidadão'} title={mobile?'Menu do cidadão':'Estado do cidadão'} onClick={() => { setLauncher(true); void refresh(); }} className={`${mobile ? '-mt-5 h-14 w-14' : 'h-12 w-12'} flex items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-lg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>{mobile?<MoreHorizontal className="h-7 w-7"/>:<HeartPulse className="h-7 w-7" />}</button></PopoverTrigger>
    <PopoverContent onEscapeKeyDown={()=>setOpen(false)} side="top" align={mobile ? 'center' : 'start'} sideOffset={12} className="z-[90] w-[min(350px,calc(100vw-1.5rem))] max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl bg-popover p-4 shadow-xl">
      {mobile&&launcher?<div className="space-y-2"><Button variant="ghost" className="w-full justify-start" onClick={()=>setLauncher(false)}><HeartPulse className="mr-3 h-5 w-5 text-rose-500"/>Estado do Cidadão</Button><Button variant="ghost" className="w-full justify-start" onClick={()=>{setOpen(false);window.dispatchEvent(new Event('govrp:open-phone'));}}><Smartphone className="mr-3 h-5 w-5 text-cyan-500"/>Celular</Button></div>:<>
      <button type="button" aria-label="Fechar estado do cidadão" onClick={()=>setOpen(false)} className="float-right flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4"/></button><div className="mb-4 flex gap-3"><img src={user.avatar_url || '/logo.png'} alt="" className="h-12 w-12 rounded-full object-cover" /><div className="min-w-0"><h2 className="font-semibold">Estado do cidadão</h2><p className="break-words text-sm">{user.full_name}</p><p className="text-xs text-muted-foreground">{needs?.age_rp ?? '…'} anos no RP</p></div></div>
      {inventory ? <section className="space-y-3"><Button variant="ghost" size="sm" onClick={()=>setInventory(false)}><ArrowLeft className="mr-2 h-4 w-4"/>Voltar ao estado do cidadão</Button><Inventory compact/></section> : housing ? <CitizenResidences residences={residences} onBack={()=>setHousing(false)}/> : consumables ? <CitizenConsumables onBack={() => { setConsumables(false); void refresh(); }} /> : error ? <p role="status" className="text-sm">{error}</p> : !needs ? <Loader2 className="animate-spin" /> : <div className="space-y-3">{NEEDS.map(({key,name,icon:Icon,color,text}) => { const value=Math.round(Number(needs[key])); return <div key={key}><div className="mb-1 flex justify-between text-sm"><span className={`flex items-center gap-2 ${text}`}><Icon className="h-4 w-4" />{name}</span><span>{value}%{value<20 ? ' · Atenção' : ''}</span></div><div role="progressbar" aria-label={name} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${color}`} style={{width:`${value}%`}} /></div></div>; })}</div>}
      {needs?.grace_until_rp > needs?.rp_now && <p className="mt-3 text-xs text-muted-foreground">Período de adaptação: conheça seu cidadão com tranquilidade.</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">{!consumables && <Button variant="outline" size="sm" className="h-auto flex-col gap-1 py-2" onClick={()=>{setHousing(false);setInventory(false);setConsumables(true);}}><Utensils className="h-4 w-4" />Meus consumíveis</Button>}{!inventory&&<Button variant="outline" size="sm" className="h-auto flex-col gap-1 py-2" onClick={()=>{setHousing(false);setConsumables(false);setInventory(true);}}><Package className="h-4 w-4"/>Meu inventário</Button>}{[{to:'/services/health',label:'SNS · Saúde',icon:HeartPulse},{to:'/services/national-market',label:'Mercado',icon:ShoppingBasket},{to:'/services/x',label:'Socializar',icon:Users}].map(({to,label,icon:Icon})=><Button key={to} asChild variant="outline" size="sm" className="h-auto flex-col gap-1 py-2"><Link to={to} onClick={()=>setOpen(false)}><Icon className="h-4 w-4" />{label}</Link></Button>)}<Button variant="outline" size="sm" className="h-auto flex-col gap-1 py-2" disabled={housingBusy} onClick={showHomes}>{housingBusy?<Loader2 className="h-4 w-4 animate-spin"/>:<Home className="h-4 w-4"/>}Moradia</Button></div>
      </>}
    </PopoverContent></Popover>
  </div>;
}
