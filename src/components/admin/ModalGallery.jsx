import React,{lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {FlaskConical,Loader2,AlertTriangle} from 'lucide-react';
import {SalaryPaymentView} from '@/components/SalaryPaymentPopup';
import {OfficeNotificationView} from '@/components/ElectionOfficeAwardPopup';
import {BusinessBalanceView} from '@/components/BusinessBalancePopup';
import {DailyCheckInView} from '@/components/DailyCheckInPopup';
import {ViceCandidacyDecisionView} from '@/components/ViceCandidacyDecisionPopup';
import {MODAL_CATALOG} from '@/lib/modalCatalog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {GovSelect} from '@/components/ui/gov-select';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
const BlueprintPreview=lazy(()=>import('./modal-preview/BlueprintPreview'));
const core=[['balance','Balanço empresarial'],['daily','Check-in diário'],['vice','Convite para compor chapa presidencial'],['salary','Salário depositado'],['role','Mudança de cargo'],['victory','Vitória eleitoral'],['election','Resultado eleitoral'],['invitation','Convite ministerial']].map(([id,title])=>({id,title,source:'Apresentação compartilhada com o RP'}));
const aliases=[['purchase','Compra','src/components/business/PurchaseDialog.jsx:1'],['sale','Venda','src/pages/services/EntrepreneurPortal.jsx:1'],['confirmation','Confirmação','src/components/bank/OpenAccount.jsx:1'],['deletion','Exclusão','src/components/admin/ContentModeration.jsx:1'],['prison','Prisão','src/components/admin/CitizenCustodyControl.jsx:1'],['fine','Multa','src/pages/services/PolicePanel.jsx:3']].map(([id,title,template])=>({id,title,template,source:template.split(':')[0]}));
const person={id:'preview-citizen',name:'Maria Exemplo',avatar_url:null,party:{name:'Partido Exemplo',acronym:'PE',color:'#22d3ee'}},participation={eligible:100,participants:80,valid_votes:70,blank_votes:6,null_votes:4,abstentions:20};
export default function ModalGallery(){
 const [selected,setSelected]=useState(null),[search,setSearch]=useState(''),[state,setState]=useState('success'),[width,setWidth]=useState('desktop'),[role,setRole]=useState('Deputado'),[feedback,setFeedback]=useState('');
 const close=useCallback(()=>setSelected(null),[]),act=useCallback(()=>setFeedback('Ação de teste concluída. Nenhum dado do RP foi alterado.'),[]);
 const previousFocus=useRef(null);
 useEffect(()=>{
  if(!selected||!['balance','daily','vice'].includes(selected.id))return;
  previousFocus.current=document.activeElement;
  const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
  const buttons=()=>[...document.querySelectorAll('[data-gallery-preview] button:not(:disabled),[data-gallery-preview] a[href]')];
  buttons()[0]?.focus();
  const keyboard=event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const elements=buttons(),first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
  document.addEventListener('keydown',keyboard);
  return()=>{document.removeEventListener('keydown',keyboard);document.body.style.overflow=previousOverflow;previousFocus.current?.focus?.();};
 },[selected,close]);
 const open=entry=>{setFeedback('');setSelected(entry);};
 const rows=[...core,...aliases,...MODAL_CATALOG].filter(entry=>`${entry.title} ${entry.source}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
 const office=selected&&['role','victory','election','invitation'].includes(selected.id)&&state==='success';
 let notification;
 if(office){
  notification=selected.id==='invitation'?{type:'minister_invitation',id:'preview',invitation:{expires_at:new Date(Date.now()+86400000).toISOString(),inviter:{full_name:'Presidente Exemplo'},ministry:{name:'Ministério da Saúde'}}}:selected.id==='election'||selected.id==='victory'?{type:'election_result_published',bundle:{sections:[{id:'example',name:'Eleição de Exemplo',office:'Presidente',status:'settled',participation,winners:[{...person,ticket_id:'ticket',office_role:'Presidente',votes:70,percentage:100}]}]}}:{type:'role_changed',content:'Seu cargo foi atualizado no GOVRP.',metadata:{old_role:'Cidadão',new_role:role,reason:'Nomeação de exemplo',origin:'appointment'}};
 }
 const template=selected&&(selected.template?MODAL_CATALOG.find(row=>row.id===selected.template):MODAL_CATALOG.find(row=>row.id===selected.id));
 let preview=null;
 if(selected){
  if(template)preview=<Suspense fallback={<p role="status">Carregando a apresentação do modal…</p>}><BlueprintPreview entry={template} role={role} width={width} state={state} onClose={close} onFeedback={setFeedback}/></Suspense>;
  else if(state!=='success')preview=<Dialog open onOpenChange={value=>{if(!value)close();}}><DialogContent style={width==='mobile'?{maxWidth:320}:undefined}><DialogHeader><DialogTitle>{selected.title}</DialogTitle><DialogDescription>Estado de teste · dados fictícios</DialogDescription></DialogHeader>{state==='loading'?<p role="status" className="flex gap-2"><Loader2 className="animate-spin"/>Carregando…</p>:state==='error'?<p role="alert" className="flex gap-2 text-destructive"><AlertTriangle/>Não foi possível carregar este registro de exemplo.</p>:<p>Nenhum registro de exemplo disponível.</p>}<Button onClick={close}>Fechar</Button></DialogContent></Dialog>;
  else if(office)preview=<OfficeNotificationView preview notification={notification} close={close} respond={()=>{act();close();}}/>;
  else if(selected.id==='salary')preview=<SalaryPaymentView payment={{amount:1250,role,paid_at:'2026-10-15T12:00:00Z'}} salaryInfo={{role,title:role,salary:1250}} onDismiss={close}/>;
  else if(selected.id==='balance')preview=<BusinessBalanceView notification={{id:'example',content:'O balanço anual da Empresa Exemplo foi processado.',created_at:'2026-10-15T12:00:00Z',metadata:{business_name:'Empresa Exemplo',gross_revenue:5000,operating_cost:2000,net_result:3000}}} onDismiss={close}/>;
  else if(selected.id==='daily')preview=<DailyCheckInView status={{current_streak:6,next_streak:7,reward_preview_amount:150,reputation_reward:10,weekly_bonus_amount:50}} onClaim={()=>{act();close();}} onDismiss={close}/>;
  else if(selected.id==='vice')preview=<ViceCandidacyDecisionView onLater={close} pendingInvitation={{expires_at:new Date(Date.now()+86400000).toISOString(),server_now:new Date().toISOString(),created_at:'2026-10-15T12:00:00Z',metadata:{candidate_name:'Maria Exemplo',election_name:'Eleição presidencial de exemplo',political_name:'Maria Exemplo'}}} onDecision={()=>{act();close();}}/>;
 }
 return <section className="space-y-4"><h3 className="flex items-center gap-2 text-xl font-semibold"><FlaskConical/>Galeria / Pré-visualização de Modais</h3><p className="text-sm text-muted-foreground">Cada exemplo usa a apresentação ou o formulário do modal correspondente. Dados fictícios, campos editáveis e ações locais; nenhuma operação altera o RP.</p>
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Input aria-label="Buscar modal" placeholder="Buscar modal ou área" value={search} onChange={e=>setSearch(e.target.value)}/><GovSelect aria-label="Estado da prévia" value={state} onChange={e=>setState(e.target.value)}><option value="success">Sucesso / Conteúdo</option><option value="loading">Carregando</option><option value="error">Erro</option><option value="empty">Vazio</option></GovSelect><GovSelect aria-label="Largura da prévia" value={width} onChange={e=>setWidth(e.target.value)}><option value="desktop">Desktop</option><option value="mobile">Mobile · 320px</option></GovSelect><GovSelect aria-label="Cargo da prévia" value={role} onChange={e=>setRole(e.target.value)}>{['Cidadão','Presidente','Deputado','Senador','Juiz','Promotor','Policial'].map(r=><option key={r}>{r}</option>)}</GovSelect></div>
  <p className="text-xs text-muted-foreground">{rows.length} exemplos disponíveis</p><div className="grid max-h-[32rem] gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{rows.map(entry=><Button key={entry.id} data-modal-preview-id={entry.id} variant="outline" className="h-auto min-h-11 justify-start whitespace-normal text-left" onClick={()=>open(entry)}>{entry.title}</Button>)}</div>
  {feedback&&<p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">{feedback}</p>}
  {preview&&createPortal(<div data-gallery-preview={selected.id} role={['balance','daily','vice'].includes(selected.id)?'dialog':undefined} aria-modal={['balance','daily','vice'].includes(selected.id)?true:undefined} aria-label={selected.title}>{preview}</div>,document.body)}
 </section>;
}
