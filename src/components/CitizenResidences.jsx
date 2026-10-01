import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Home, Loader2, Moon, ShowerHead } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCitizenNeeds } from '@/contexts/CitizenNeedsContext';
import { useToast } from '@/components/ui/use-toast';

export default function CitizenResidences({ residences, onBack }) {
  const { act, sleeping } = useCitizenNeeds();
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const handleHomeAction = async (home, action) => {
    if (busy || sleeping) return;
    setBusy(`${home.id}:${action}`);
    try {
      await act(action, home.id, crypto.randomUUID());
      toast({ title: action === 'bath' ? 'Banho concluído' : 'Descanso iniciado' });
    } catch (error) {
      toast({ title: 'Não foi possível concluir', description: error.message, variant: 'destructive' });
    } finally { setBusy(''); }
  };
  return <section className="space-y-3">
    <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4"/>Voltar</Button>
    <h3 className="flex items-center gap-2 font-semibold"><Home className="h-5 w-5"/>Minhas Moradias</h3>
    {!residences.length && <p className="text-sm">Você ainda não possui uma moradia própria ou alugada.</p>}
    {residences.map(home => <article key={home.id} className="space-y-2 rounded-xl border p-3">
      <h4 className="break-words font-medium">{home.name}</h4>
      <p className="text-xs text-muted-foreground">{home.city} / {home.state} · {home.area_sqm} m² · {Number(home.purchase_price||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</p>
      <p className="text-xs text-muted-foreground">{home.is_tenant ? 'Alugada' : 'Própria'} · Banho +{home.hygiene_recovery || 100}% · Descanso em até {home.sleep_minutes || 15} min{home.can_use === false ? ' · Uso indisponível durante aluguel ou pendência' : ''}</p>
      <div className="flex flex-wrap gap-2">{[['bath','Tomar banho',ShowerHead],['sleep','Dormir',Moon]].map(([action,label,Icon]) => <Button key={action} size="sm" disabled={Boolean(busy)||sleeping||home.can_use===false} onClick={()=>handleHomeAction(home,action)}>{busy===`${home.id}:${action}`?<Loader2 className="mr-1 h-4 w-4 animate-spin"/>:<Icon className="mr-1 h-4 w-4"/>}{label}</Button>)}</div>
    </article>)}
    <Button asChild variant="outline" size="sm"><Link to="/services/national-housing">Conhecer outras moradias</Link></Button>
  </section>;
}
