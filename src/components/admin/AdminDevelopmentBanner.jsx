import React from 'react';
import {Link,useLocation} from 'react-router-dom';
import {FlaskConical} from 'lucide-react';
import {useAuth} from '@/contexts/AuthContext';
const owners=[['/president','Presidente'],['/parliament','Deputados e Senadores'],['/police','Polícia'],['/justice','Polícia, Ministério Público e Justiça'],['/penal','Sistema prisional'],['/armed','Forças Armadas'],['/agies','Inteligência'],['/entrepreneur','Empresários'],['/companies','Proprietários e gestores'],['/bank','Cidadãos e gestão bancária']];
export default function AdminDevelopmentBanner(){
 const {user}=useAuth(),{pathname}=useLocation();if(!user?.is_platform_admin||user.admin_development?.mode==='normal')return null;
 const owner=owners.find(([path])=>pathname.includes(path))?.[1];
 return <aside aria-label="Modo de desenvolvimento" className="mx-auto my-3 max-w-7xl space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><p className="flex items-center gap-2 font-semibold"><FlaskConical className="h-5 w-5 shrink-0"/>{user.admin_development.mode==='simulate'?`Simulando ${user.role}`:'Acesso Total'} · {user.is_admin_preview?'Pré-visualização: ações reais bloqueadas':'Execução real: ações auditadas'}</p><p>Cargo real: {user.canonical_role}.{owner&&` Normalmente disponível para: ${owner}.`}</p><Link className="underline" to="/admin-dashboard/development">Alterar modo de visualização</Link></aside>;
}
