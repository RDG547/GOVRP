import React, { useEffect, useState } from 'react';

import { ArrowLeft, BatteryFull, Briefcase, HeartPulse, Home, Landmark, LineChart, MessageSquare, Newspaper, Phone, Signal, Smartphone, Store, Wifi, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const APPS = [
  ['Banco', '/services/bank', Landmark, 'bg-emerald-600'],
  ['X', '/services/x', MessageSquare, 'bg-slate-900'],
  ['Negócios Livre', '/services/business', Store, 'bg-blue-600'],
  ['Internet', '/services/internet', Wifi, 'bg-cyan-700'],
  ['Telefonia', '/services/phone', Phone, 'bg-violet-600'],
  ['Moradia', '/services/national-housing', Home, 'bg-emerald-700'],
  ['Meu trabalho', '/services/my-work', Briefcase, 'bg-amber-700'],
  ['Notícias', '/news', Newspaper, 'bg-rose-600'],
  ['SNS', '/services/health', HeartPulse, 'bg-red-600'],
  ['Bolsa de Valores', '/services/stock-exchange', LineChart, 'bg-indigo-600'],
];
export default function CitizenPhone() {
  const { user } = useAuth();

  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [recent, setRecent] = useState([]);
  const [screen, setScreen] = useState('home');
  const [appPath, setAppPath] = useState(null);
  useEffect(() => { const show=()=>{setOpen(true);setScreen('home');}; window.addEventListener('govrp:open-phone',show);return()=>window.removeEventListener('govrp:open-phone',show); }, []);
  useEffect(() => {
    if (!open) return undefined;
    setClock(new Date());
    const interval = setInterval(() => setClock(new Date()), 15000);
    return () => clearInterval(interval);
  }, [open]);
  if (!user?.onboarding_completed) return null;
  const launch = app => {
    setRecent(current => [app[1], ...current.filter(path => path !== app[1])].slice(0, 4));
    setScreen('app');
    setAppPath(app[1]);
  };
  const appButton = (app, dock = false) => {
    const [name, path, Icon, color] = app;
    return <button key={path} type="button" onClick={() => launch(app)} aria-label={`Abrir ${name}`} className="group flex min-w-0 flex-col items-center gap-1 rounded-xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><span className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-md transition-transform group-hover:scale-105 ${color}`}><Icon className="h-6 w-6 text-white"/></span>{!dock && <span className="min-h-8 text-center text-[11px] leading-4 text-white">{name}</span>}</button>;
  };
  return <><button type="button" aria-label="Abrir celular" title="Celular" onClick={()=>{setScreen('home');setOpen(true);}} className="fixed bottom-[5.25rem] left-5 z-40 hidden h-12 w-12 items-center justify-center rounded-full border-4 border-background bg-slate-800 text-white shadow-lg hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-ring md:flex"><Smartphone className="h-6 w-6"/></button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent plain hideClose aria-describedby="phone-description" className="z-[95] w-[min(390px,calc(100vw-1rem))] max-w-[390px] gap-0 overflow-hidden rounded-[2.5rem] border-[7px] border-slate-800 bg-slate-950 p-0 sm:p-0 text-white shadow-2xl [&>button]:hidden">
        <DialogTitle className="sr-only">Celular do cidadão</DialogTitle><DialogDescription id="phone-description" className="sr-only">Abra os serviços dentro da tela do celular. Use voltar para retornar à tela inicial.</DialogDescription>
        <div className="relative flex h-[min(730px,calc(100dvh-3rem))] min-h-0 flex-col overflow-y-auto bg-gradient-to-br from-indigo-950 via-slate-900 to-cyan-950">
          <div className="flex shrink-0 items-center justify-between px-5 pt-3 text-xs"><time>{clock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time><div aria-hidden="true" className="h-5 w-20 rounded-full bg-black"/><span className="flex gap-1" aria-hidden="true"><Signal className="h-3 w-3"/><Wifi className="h-3 w-3"/><BatteryFull className="h-4 w-4"/></span></div>
          <div className="flex items-center justify-between px-3 pt-2"><Button size="icon" variant="ghost" aria-label="Voltar à tela inicial do celular" onClick={() => setScreen('home')}><ArrowLeft className="h-4 w-4"/></Button><h2 className="text-xs font-semibold">{screen==='app'?APPS.find(app=>app[1]===appPath)?.[0]:'Celular'}</h2><Button size="icon" variant="ghost" aria-label="Fechar celular" onClick={() => setOpen(false)}><X className="h-4 w-4"/></Button></div>
          {appPath&&<iframe key={appPath} name="govrp-phone-app" title={`Aplicativo ${APPS.find(app=>app[1]===appPath)?.[0]||''} no celular`} src={appPath} className={`min-h-0 w-full flex-1 border-0 bg-background ${screen==='app'?'block':'hidden'}`} />}
          {screen!=='app'&&<><div className="px-4 py-3"><p className="mb-4 text-center text-xs text-slate-300">{clock.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p><div className="grid grid-cols-4 gap-x-1 gap-y-3">{(screen === 'recent' ? recent.map(path => APPS.find(app => app[1] === path)) : APPS).map(app => appButton(app))}</div>{screen === 'recent' && !recent.length && <p className="py-8 text-center text-sm">Seus aplicativos recentes aparecerão aqui.</p>}</div><div className="mx-3 mb-3 mt-auto grid grid-cols-4 gap-1 rounded-3xl bg-white/10 p-2">{[APPS[0], APPS[1], APPS[2], APPS[4]].map(app => appButton(app, true))}</div></>}
          <nav aria-label="Navegação do celular" className="flex items-center justify-center gap-6 pb-3"><button className="rounded-lg px-2 py-2 text-xs focus-visible:ring-2 focus-visible:ring-white" onClick={() => setScreen('recent')}>Recentes</button><button className="h-10 w-16 rounded-lg focus-visible:ring-2 focus-visible:ring-white" aria-label="Tela inicial do celular" onClick={() => setScreen('home')}><span className="mx-auto block h-1 w-12 rounded-full bg-white"/></button><button className="rounded-lg px-2 py-2 text-xs focus-visible:ring-2 focus-visible:ring-white" onClick={() => setOpen(false)}>Fechar</button></nav>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
