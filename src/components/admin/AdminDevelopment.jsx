import React,{useState} from 'react';
import {Link} from 'react-router-dom';
import {FlaskConical,Loader2,Save} from 'lucide-react';
import {useAuth} from '@/contexts/AuthContext';
import {useToast} from '@/components/ui/use-toast';
import {Button} from '@/components/ui/button';
import {GovSelect} from '@/components/ui/gov-select';
import ModalGallery from './ModalGallery';
const roles=['Cidadão','Presidente','Vice-Presidente','Deputado','Senador','Policial','Delegado','Promotor','Juiz','Ministro','Empresário','Agente Secreto','Militar','Presidente do STF','Presidente do Banco Nacional','Presidente do Portal Eleitoral'];
const panels=[['Presidente','/dashboard/president'],['Parlamento','/services/parliament/panel'],['Polícia','/services/justice?view=authority'],['Justiça','/services/justice?view=authority'],['Sistema prisional','/services/prison'],['Inteligência','/services/agies/panel'],['Forças Armadas','/services/armed-forces/panel'],['Empresas','/services/entrepreneur-portal?tab=country'],['Banco','/services/bank']];
export default function AdminDevelopment(){
 const {user,setAdminDevelopmentMode}=useAuth(),{toast}=useToast();const [draft,setDraft]=useState(()=>({mode:user.admin_development?.mode||'normal',simulatedRole:user.admin_development?.simulated_role||'Cidadão',executeReal:false})),[busy,setBusy]=useState(false);
 const save=async event=>{event.preventDefault();setBusy(true);try{await setAdminDevelopmentMode(draft);toast({title:'Modo de visualização atualizado'});}catch(error){toast({title:'Não foi possível alterar o modo',description:error.message,variant:'destructive'});}finally{setBusy(false);}};
 return <section className="space-y-7"><h2 className="flex items-center gap-2 text-2xl font-semibold"><FlaskConical/>Desenvolvimento e pré-visualização</h2><p className="text-sm text-muted-foreground">Administração técnica independente do personagem. Seu cargo real é {user.canonical_role}. As simulações preservam as autoridades do mundo.</p>
  <form onSubmit={save} className="space-y-4 rounded-xl border p-4"><label className="block space-y-2 text-sm">Modo de visualização<GovSelect aria-label="Modo de visualização" value={draft.mode} onChange={e=>setDraft(current=>({...current,mode:e.target.value,executeReal:false}))}><option value="normal">Normal / Cargos Reais</option><option value="total">Acesso Total</option><option value="simulate">Simular Cargo</option></GovSelect></label>
  {draft.mode==='simulate'&&<label className="block space-y-2 text-sm">Cargo para simular<GovSelect aria-label="Cargo para simular" value={draft.simulatedRole} onChange={e=>setDraft(current=>({...current,simulatedRole:e.target.value}))}>{roles.map(role=><option key={role} value={role}>{role}</option>)}</GovSelect></label>}
  {draft.mode==='total'&&<label className="flex items-start gap-3 rounded-lg border border-red-500/40 p-3 text-sm"><input type="checkbox" checked={draft.executeReal} onChange={e=>setDraft(current=>({...current,executeReal:e.target.checked}))} className="mt-1"/>Executar no mundo real do RP. Confirmo que alterações afetam produção e serão registradas na auditoria.</label>}
  <Button disabled={busy} type="submit">{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Aplicar modo</Button></form>
  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{panels.map(([label,path])=><Button key={label} asChild variant="outline" className="h-auto min-h-11 whitespace-normal"><Link to={path}>{label}</Link></Button>)}</div>
  <ModalGallery/>
 </section>;
}
