import CitizenSleepPanel from '@/components/CitizenSleepPanel';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBasket, Home, ShoppingCart, ShowerHead, Moon, Loader2, Check, X, Package } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCitizenNeeds } from '@/contexts/CitizenNeedsContext';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { GovSelect } from '@/components/ui/gov-select';
import { LEGAL_REALTIME_TABLES } from '@/lib/legalMeasures';

const money = value => Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function NationalCitizenCommerce({ housing = false }) {
  const { user } = useAuth(); const { act, sleeping } = useCitizenNeeds(); const { toast } = useToast();
  const [offers,setOffers] = useState([]); const [residences,setResidences] = useState([]);
  const [search,setSearch] = useState(''); const [category,setCategory] = useState('all');
  const [selected,setSelected] = useState(null); const [busy,setBusy] = useState(''); const [error,setError] = useState('');
  const actionKey = useRef(null);
  const load = useCallback(async () => {
    const [catalog,owned] = await Promise.all([supabase.rpc('get_state_citizen_offers',{p_housing:housing}),supabase.from('citizen_residences').select('*').eq('owner_id',user.id).eq('status','owned')]);
    if(catalog.error || owned.error) {setError('Não foi possível carregar o serviço. Tente novamente.');return;}
    setOffers(catalog.data || []);setResidences(owned.data || []);setError('');
  },[housing,user.id]);
  useEffect(()=>{setSelected(null);setCategory('all');void load();},[load]);
  useDomainRealtime('citizen-commerce',user.id,['products','state_enterprises','citizen_residences',...LEGAL_REALTIME_TABLES],load);
  const current = offers.find(offer=>offer.id===selected?.id);
  const choose = item => { actionKey.current=crypto.randomUUID();setSelected(item); };
  const buy = async () => {
    if(!current || busy) return;setBusy('buy');
    try {
      const {data,error:failure}=await supabase.rpc('buy_product',{p_product_id:current.id,p_payment_method:'balance',p_card_id:null,p_idempotency_key:actionKey.current});
      if(failure)throw failure;if(!data.success)throw new Error(data.message);
      setSelected(null);await load();toast({title:'Compra concluída',description:housing?'Sua residência está no seu patrimônio e já pode ser usada.':'O produto está no seu inventário. Use Consumir quando precisar.'});
    }catch(failure){toast({title:'Compra não concluída',description:failure.message,variant:'destructive'});}finally{setBusy('');}
  };
  const handleHomeAction = async (residence,action) => {
    if(busy)return;setBusy(`${residence.id}:${action}`);
    try {await act(action,residence.id,crypto.randomUUID());toast({title:action==='bath'?'Banho concluído':'Descanso iniciado',description:'Seu estado foi atualizado.'});}
    catch(failure){toast({title:'Não foi possível concluir',description:failure.message,variant:'destructive'});}finally{setBusy('');}
  };
  const Icon=housing?Home:ShoppingBasket;
  const visible=offers.filter(item=>(category==='all'||(housing?item.residence_spec.state:item.category)===category)&&`${item.name} ${item.residence_spec?.city||''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return <div className="mx-auto min-w-0 max-w-6xl space-y-6 px-3 py-8 sm:px-6"><header className="space-y-3"><h1 className="flex items-center gap-3 text-2xl font-bold"><Icon className="h-8 w-8 text-primary" />{housing?'Imobiliária Nacional':'Mercado Nacional'}</h1><p className="text-muted-foreground">{housing?'Adquira sua residência com dinheiro do RP. Todas as moradias permitem dormir e tomar banho.':'Alimentos e bebidas essenciais para seu cidadão. Compare também as ofertas dos jogadores no Negócios Livres.'}</p><Button asChild variant="outline"><Link to="/services/inventory"><Package className="mr-2 h-4 w-4" />Meu inventário</Link></Button></header>
    {housing&&<CitizenSleepPanel />}{housing&&!sleeping&&<section className="space-y-3"><h2 className="text-xl font-semibold">Minhas propriedades</h2>{!residences.length?<p className="text-sm text-muted-foreground">Você ainda não possui uma residência.</p>:residences.map(home=><Card key={home.id}><CardHeader><CardTitle>{home.name}</CardTitle></CardHeader><CardContent className="space-y-3"><p>{home.city} / {home.state} · {home.area_sqm} m² · Adquirida por {money(home.purchase_price)}</p><div className="flex flex-wrap gap-2"><Button disabled={Boolean(busy)} onClick={()=>handleHomeAction(home,'bath')}><ShowerHead className="mr-2 h-4 w-4" />Tomar banho</Button><Button disabled={Boolean(busy)} onClick={()=>handleHomeAction(home,'sleep')}><Moon className="mr-2 h-4 w-4" />Dormir</Button></div></CardContent></Card>)}</section>}
    <div className="grid gap-3 sm:grid-cols-2"><Input aria-label="Buscar ofertas" placeholder={housing?'Buscar por nome ou cidade':'Buscar alimento ou bebida'} value={search} onChange={e=>setSearch(e.target.value)}/><GovSelect aria-label={housing?'Estado':'Categoria'} value={category} onChange={e=>setCategory(e.target.value)}><option value="all">{housing?'Todos os estados':'Todas as categorias'}</option>{[...new Set(offers.map(item=>housing?item.residence_spec.state:item.category))].map(value=><option key={value} value={value}>{value}</option>)}</GovSelect></div>
    {error&&<div role="alert">{error}<Button onClick={load}>Tentar novamente</Button></div>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visible.map(item=><Card key={item.id} className="min-w-0 overflow-hidden"><div className="flex h-32 items-center justify-center bg-gradient-to-br from-primary/20 to-secondary">{item.image_url?<img src={item.image_url} alt={item.name} className="h-full w-full object-cover"/>:<Icon aria-hidden="true" className="h-16 w-16 text-primary/70"/>}</div><CardHeader><CardTitle className="text-lg">{item.name}</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">{item.description}</p>{housing?<p className="text-sm">{item.residence_spec.city} / {item.residence_spec.state} · {item.residence_spec.area_sqm} m²</p>:<p className="text-sm">{Object.entries(item.consumable_effects).map(([need,value])=>`${need==='hunger'?'Fome':'Sede'} +${value}`).join(' · ')}</p>}<p className="text-xl font-semibold">{money(item.quote?.total_debited)}</p><p className="text-xs text-muted-foreground">Valor: {money(item.price)} · Impostos e taxas: {money(item.quote?.buyer_tax)}</p><Button className="w-full" disabled={item.quote?.restricted} onClick={()=>choose(item)}><ShoppingCart className="mr-2 h-4 w-4" />{item.quote?.restricted?'Indisponível por norma vigente':'Comprar'}</Button></CardContent></Card>)}</div>
    <Dialog open={Boolean(selected)} onOpenChange={open=>{if(!open&&!busy)setSelected(null);}}><DialogContent><DialogHeader><DialogTitle>Confirmar compra</DialogTitle><DialogDescription>{current?.name || selected?.name}</DialogDescription></DialogHeader>{current?<div className="space-y-2"><p>Valor: {money(current.price)}</p><p>Impostos e taxas: {money(current.quote.buyer_tax)}</p><p className="font-semibold">Total debitado: {money(current.quote.total_debited)}</p>{current.quote.total_debited!==selected?.quote.total_debited&&<p role="status">O preço foi atualizado pelas regras vigentes. Confira o total antes de confirmar.</p>}</div>:<p>Esta oferta ficou indisponível.</p>}<DialogFooter><Button variant="outline" disabled={Boolean(busy)} onClick={()=>setSelected(null)}><X className="mr-2 h-4 w-4"/>Cancelar</Button><Button disabled={!current||current.quote?.restricted||Boolean(busy)} onClick={buy}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Check className="mr-2 h-4 w-4"/>}Confirmar compra</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
