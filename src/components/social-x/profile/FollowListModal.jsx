import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, UserPlus, UserCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export default function FollowListModal({ isOpen, setIsOpen, userId, type, initialCount }) {
  const { user } = useAuth();
  const [list, setList] = useState([]), [page, setPage] = useState(0), [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    if (!isOpen) return;
    const id = ++request.current; setLoading(true);
    const result = await supabase.rpc('get_x_follow_page', {p_user_id:userId,p_direction:type,p_offset:page*30,p_search:search});
    if (id !== request.current) return;
    setList(result.data || []); setError(result.error ? 'Não foi possível carregar os perfis.' : ''); setLoading(false);
  }, [isOpen, userId, type, page, search]);
  useEffect(() => { const timer=setTimeout(load,150); return()=>{clearTimeout(timer);request.current++;}; }, [load]);
  useEffect(() => {setPage(0);setSearch('');}, [userId,type,isOpen]);
  useDomainRealtime('x-followers', `${userId}:${type}`, ['followers'], load, isOpen);
  usePublicProfileChanges(load,isOpen);
  const follow = async profile => {setBusy(profile.id);const result=await supabase.rpc('toggle_follow',{p_following_id:profile.id});if(result.error)setError('Não foi possível atualizar a relação.');else await load();setBusy('');};
  const total=Number(list[0]?.total_count ?? (search ? 0 : initialCount));
  return <Dialog open={isOpen} onOpenChange={setIsOpen}><DialogContent className="flex max-h-[85dvh] flex-col"><DialogHeader><DialogTitle>{type==='followers'?'Seguidores':'Seguindo'} ({total})</DialogTitle><DialogDescription>Perfis públicos da Rede X.</DialogDescription></DialogHeader>
    <Input aria-label="Buscar perfis" placeholder="Buscar nome ou @usuário" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/>
    {error&&<p role="alert">{error}<Button variant="link" onClick={load}>Tentar novamente</Button></p>}
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">{loading&&<Loader2 aria-label="Atualizando perfis" className="mx-auto h-5 w-5 animate-spin"/>}{list.map(profile=><div key={profile.id} className="flex min-w-0 items-start gap-3"><Link to={`/services/x/profile/${profile.x_handle}`} onClick={()=>setIsOpen(false)}><img src={profile.x_avatar_url||'/icon-192x192.png'} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover"/></Link><div className="min-w-0 flex-1"><Link to={`/services/x/profile/${profile.x_handle}`} onClick={()=>setIsOpen(false)} className="block hover:underline"><p className="truncate font-semibold">{profile.x_username}</p><p className="truncate text-xs text-muted-foreground">@{profile.x_handle}</p></Link><p className="mt-1 line-clamp-2 break-words text-sm">{profile.x_bio}</p>{profile.id!==user?.id&&<Button className="mt-2" size="sm" variant={profile.is_following?'outline':'default'} disabled={Boolean(busy)} onClick={()=>follow(profile)}>{profile.is_following?<UserCheck className="mr-2 h-4 w-4"/>:<UserPlus className="mr-2 h-4 w-4"/>}{profile.is_following?'Deixar de seguir':'Seguir'}</Button>}</div></div>)}{!loading&&!list.length&&<p className="py-6 text-center text-muted-foreground">Nenhum perfil encontrado.</p>}</div>
    <div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={!page||loading} onClick={()=>setPage(page-1)}>Anterior</Button><span className="text-xs">Página {page+1}</span><Button variant="outline" disabled={loading||(page+1)*30>=total} onClick={()=>setPage(page+1)}>Próxima</Button></div>
  </DialogContent></Dialog>;
}
