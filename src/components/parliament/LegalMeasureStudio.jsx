import {publishBillProposedNews} from '@/lib/newsPublisher';
import React, { useCallback, useEffect, useId, useState } from 'react';
import { BookOpen, Loader2, Coins, Shield, Scale, Newspaper, Landmark, HeartPulse, Construction, FileText, Tag, ScrollText, CalendarClock, Users, Percent, Settings2, Send, MapPin, ListChecks, PlusCircle, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/ui/currency-input';
import { GovSelect } from '@/components/ui/gov-select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PROPOSAL_CATEGORIES, proposalCategory, applicableProposal, LEGAL_MEASURE_MODELS, LEGAL_REALTIME_TABLES, LEGAL_KIND_LABELS, LEGAL_BASIS_LABELS, createMeasureDraft, measurePayload, measureSummary } from '@/lib/legalMeasures';
import { formatDateTimeBR } from '@/lib/dateTime';

const categoryIcons = { Coins, Shield, Scale, Newspaper, Landmark, HeartPulse, Construction };
const sanctions = {fine_fixed:'Multa fixa',fine_percentage:'Multa percentual',warning:'Advertência',regularization:'Obrigação de regularização',business_suspension:'Suspensão temporária de empresa'};
const bases = {personal_balance:'Saldo pessoal',business_cash:'Caixa da empresa',business_revenue:'Receita mensal registrada da empresa',party_treasury:'Caixa do partido'};
const infrastructure = {roads:'Rodovias',energy:'Energia',ports:'Portos',airports:'Aeroportos',telecom:'Telecomunicações',industry:'Indústria',health:'Saúde'};
const audience = {all:'Todos',citizen:'Cidadãos',business:'Empresas',party:'Partidos'};
const definitionLabels = {reference_kind:'Origem da norma anterior',reference_id:'Norma anterior',basis:'Atividade',nature:'Forma de cobrança',payer:'Responsável',audience:'Público',sector_id:'Setor',category:'Categoria / atividade',document_type:'Documento',min_amount:'Operação mínima',max_amount:'Operação máxima',exempt_below:'Isenção até',minimum:'Limite mínimo',maximum:'Limite máximo',fine:'Multa penal',budget:'Orçamento total',eligible_balance_max:'Saldo máximo elegível',discount_rate:'Redução',discount_sector_id:'Setor beneficiado',scope_mode:'Escopo',weekdays:'Dias da semana',hour_from:'Das',hour_until:'Até',region_codes:'Estados',sanction_kind:'Sanção',infraction:'Infração',conditions:'Condições de aplicação',calculation_basis:'Base de cálculo',recurrence_multiplier:'Multiplicador por reincidência definitiva',late_interest_rate:'Juros diários',duration_days:'Duração em dias reais',operation:'Medida',ideologies:'Ideologias / orientações abrangidas',exempt_ideologies:'Ideologias / orientações isentas',period_days:'Período do limite em dias',region_code:'Estado',infrastructure_kind:'Infraestrutura',construction_days:'Dias de construção'};
export default function LegalMeasureStudio({houseId=null,onCreated,buttonLabel='Propor Projeto',open:controlledOpen,onOpenChange,hideTrigger=false}) {
 const {user}=useAuth(); const {toast}=useToast(); const prefix=useId();
 const [ownOpen,setOwnOpen]=useState(false); const open=controlledOpen??ownOpen;
 const setOpen=value=>{setOwnOpen(value);onOpenChange?.(value);};
 const [extraSanction,setExtraSanction]=useState(null);
 const [mode,setMode]=useState('scratch'),[category,setCategory]=useState('economy'),[templateId,setTemplateId]=useState(''),[draft,setDraft]=useState(null);
 const [title,setTitle]=useState(''),[summary,setSummary]=useState(''),[text,setText]=useState(''),[type,setType]=useState(''),[source,setSource]=useState(houseId?'bill':''),[selectedHouse,setSelectedHouse]=useState(houseId||'');
 const [rules,setRules]=useState([]),[authority,setAuthority]=useState([]),[sectors,setSectors]=useState([]),[houses,setHouses]=useState([]),[businessTypes,setBusinessTypes]=useState([]),[catalogs,setCatalogs]=useState({});
 const [loading,setLoading]=useState(false),[loadError,setLoadError]=useState(false),[saving,setSaving]=useState(false),[review,setReview]=useState(false);
 const executive=['Admin','Presidente'].includes(user?.role)||user?.admin_total_access||user?.is_admin||(user?.is_platform_admin&&user?.admin_development?.mode==='total')||user?.effective_roles?.includes('Presidente');
 const load=useCallback(async()=>{
  const results=await Promise.all([supabase.from('government_rules').select('*').order('description'),supabase.from('legal_authority_rules').select('*'),supabase.from('economic_sectors').select('id,name').order('name'),supabase.from('parliament_houses').select('id,name'),supabase.from('business_types').select('id,name,category').eq('is_active',true).order('name'),supabase.rpc('get_legislative_catalogs')]);
  const error=results.find(result=>result.error)?.error;setLoadError(Boolean(error));
  if(error){console.error('Catálogos legislativos indisponíveis',error);return;}
  setRules(results[0].data||[]);setAuthority(results[1].data||[]);setSectors(results[2].data||[]);setHouses(results[3].data||[]);setBusinessTypes(results[4].data||[]);setCatalogs(results[5].data||{});
 },[]);
 useEffect(()=>{if(open){setLoading(true);void load().finally(()=>setLoading(false));}},[open,load]);
 useDomainRealtime('legal-rules','public',LEGAL_REALTIME_TABLES,load,open);
 const update=patch=>{setDraft(current=>({...current,...patch}));setReview(false);};
 const definition=patch=>{setDraft(current=>({...current,definition:{...current.definition,...patch}}));setReview(false);};
 const selectTemplate=id=>{
  const template=LEGAL_MEASURE_MODELS.find(item=>item.id===id);setTemplateId(id);setReview(false);
  if(!template){setDraft(null);return;}
  setExtraSanction(null);setDraft(createMeasureDraft(template));setTitle(template.title);setSummary(`${template.title}, conforme os parâmetros e a vigência definidos nesta proposta.`);
  setText(`Art. 1º. ${template.title}, nos termos dos efeitos estruturados anexos a esta norma.\nArt. 2º. A aplicação observará os destinatários, condições, limites e procedimentos expressamente indicados no anexo.\nArt. 3º. A vigência respeitará a data definida após publicação válida, preservadas as operações e decisões anteriores.`);
 };
 const chooseMode=value=>{setMode(value);setExtraSanction(null);setReview(false);setDraft(null);setTemplateId('');setTitle('');setSummary('');setText('');};
 const field=(name,label,element,Icon=Settings2)=> <div className="min-w-0 space-y-1.5"><Label className="flex items-center gap-2 text-left" htmlFor={`${prefix}-${name}`}><Icon className="h-4 w-4 shrink-0 text-cyan-400"/>{label}</Label>{React.cloneElement(element,{id:`${prefix}-${name}`})}</div>;
 const select=(value,onChange,options,placeholder='Selecione')=><GovSelect value={value??''} onChange={event=>onChange(event.target.value)}><option value="">{placeholder}</option>{Object.entries(options).map(([key,label])=><option key={key} value={key}>{label}</option>)}</GovSelect>;
 const d=draft?.definition||{}; const kind=draft?.kind; const current=rules.find(rule=>rule.rule_key===draft?.rule_key); const template=LEGAL_MEASURE_MODELS.find(item=>item.id===templateId);
 const decimal=(key,label,ratio=false)=>field(key,label,<Input type="number" min="0" step="0.01" value={d[key]==null?'':ratio?Number((d[key]*100).toFixed(6)):d[key]} onChange={event=>definition({[key]:event.target.value===''?'':Number(event.target.value)/(ratio?100:1)})}/>,ratio?Percent:Coins);
 const currency=(key,label)=>field(key,label,<CurrencyInput value={d[key]??''} onValueChange={value=>definition({[key]:value})}/>,Coins);
 const multi=(key,label,values)=><fieldset className="min-w-0 rounded-lg border p-3"><legend className="px-1 text-sm font-medium">{label}</legend><div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">{values.map(([value,label])=><label key={value} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={(d[key]||[]).includes(value)} onChange={event=>definition({[key]:event.target.checked?[...(d[key]||[]),value]:(d[key]||[]).filter(item=>item!==value)})}/>{label}</label>)}</div></fieldset>;
 const formatDefinition=(key,value)=>{
  if(key==='reference_id')return catalogs.norms?.find(item=>item.source_id===value)?.title||value;
  if(key==='reference_kind')return value==='bill'?'Lei':'Decreto';
  if(key==='operation') return template?.title||value;
  if(['sector_id','discount_sector_id'].includes(key))return sectors.find(item=>item.id===value)?.name||value;
  if(key==='category')return businessTypes.find(item=>item.id===value)?.name||value;
  if(key==='weekdays')return value.map(day=>['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][day]).join(', ');
  if(Array.isArray(value))return value.map(item=>catalogs.regions?.find(region=>region.code===item)?.name||item).join(', ');
  if(['minimum','maximum','fine','budget','eligible_balance_max','min_amount','max_amount','exempt_below'].includes(key))return Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  return ({...LEGAL_BASIS_LABELS,...audience,...sanctions,...bases,...infrastructure,fixed:'Valor fixo',percentage:'Percentual',buyer:'Comprador / solicitante',seller:'Vendedor',total:'Total',hours:'Horário',weekdays:'Dias da semana',period:'Período temporário'})[value]??String(value);
 };
 const submit=async()=>{
  if(saving)return; setSaving(true);
  try{
   if(!source||source==='bill'&&!type)throw new Error('Selecione a via institucional e o tipo de projeto.');
   if(title.trim().length<5||summary.trim().length<20||text.trim().length<40)throw new Error('Complete o título, a ementa e o texto legal antes de enviar.');
   const params={p_title:title,p_summary:summary,p_full_text:text,p_house_id:houseId||selectedHouse||null};
   let result;
   if(mode==='template'){
    if(!draft)throw new Error('Selecione um modelo e configure seus parâmetros.');
    if(templateId==='legacy-sanction'&&!d.reference_id)throw new Error('Selecione a norma anterior cujos dispositivos serão estruturados.');
    if(templateId.includes('incentive')&&(d.discount_rate==null||d.discount_rate===''))throw new Error('Defina expressamente o percentual de redução tributária.');
    if(templateId.includes('incentive')&&!d.discount_sector_id)throw new Error('Selecione o setor beneficiado pelo incentivo.');
    if(draft.action!=='revoke'&&!d.audience&&kind!=='project')throw new Error('Selecione o público afetado.');
    result=await supabase.rpc('submit_structured_legal_measure',{...params,p_source_kind:source,p_effects:[measurePayload(draft),...(extraSanction?[measurePayload({...extraSanction,name:`Sanção por descumprimento de ${draft.name}`,validity_mode:draft.validity_mode,valid_from:draft.valid_from,valid_until:draft.valid_until})]:[])],p_type:type||'PL'});
   }else{
    if(source==='decree')throw new Error('Para decretos, escolha um modelo e confirme a competência executiva.');
    result=await supabase.rpc('propose_parliament_bill',{...params,p_type:type});
   }
   if(result.error)throw result.error;
   if(source==='bill'){try{await publishBillProposedNews(supabase,{bill:{...result.data,title,summary,type},authorName:user.full_name||user.username,houseName:houses.find(h=>h.id===(houseId||selectedHouse))?.name});}catch(error){console.error('Publicação de notícia do projeto',error);}}
   toast({title:source==='decree'?'Decreto salvo para publicação':'Proposta enviada ao Parlamento',description:'Os efeitos dependem da tramitação, publicação e vigência. O texto livre não executa regras.'});setOpen(false);await onCreated?.(result.data);
  }catch(error){console.error('Proposta legislativa recusada',error);const message=/^[A-Z_0-9]+$/.test(error.message||'')?'Confira os parâmetros, a competência e a vigência da medida.':error.message;toast({title:'Não foi possível enviar a medida',description:message,variant:'destructive'});}finally{setSaving(false);}
 };
 const ruleOptions=rules.filter(rule=>rule.rule_kind===kind&&rule.is_active&&(!template?.ruleKey||rule.rule_key===template.ruleKey));
 const competence=authority.find(item=>item.capability===kind);
 const rate=d.nature==='percentage'||d.sanction_kind==='fine_percentage';
 const activeModels=LEGAL_MEASURE_MODELS.filter(item=>proposalCategory(item)===category&&applicableProposal(item,rules));
 return <>
  {!hideTrigger&&<Button variant="outline" onClick={()=>setOpen(true)}><BookOpen className="mr-2 h-4 w-4"/>{buttonLabel}</Button>}
  <Dialog open={open} onOpenChange={value=>{if(!saving)setOpen(value);}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Propor Projeto</DialogTitle><DialogDescription>Crie o texto e configure efeitos verificáveis. Nenhuma regra muda antes da tramitação e da publicação.</DialogDescription></DialogHeader>
   <div className="flex flex-wrap justify-center gap-2"><Button variant={mode==='scratch'?'default':'outline'} onClick={()=>chooseMode('scratch')}><PlusCircle className="mr-2 h-4 w-4"/>Criar do zero</Button><Button variant={mode==='template'?'default':'outline'} onClick={()=>chooseMode('template')}><BookOpen className="mr-2 h-4 w-4"/>Usar modelo de proposta</Button></div>
   {loading&&<p className="flex items-center justify-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin"/>Consultando catálogos…</p>}
   {loadError&&<Button variant="outline" onClick={load}>Tentar carregar catálogos novamente</Button>}
   {mode==='template'&&<>
    <div className="flex flex-wrap gap-2" aria-label="Categorias de propostas">{PROPOSAL_CATEGORIES.map(item=>{const Icon=categoryIcons[item.icon]||BookOpen;return <Button key={item.id} size="sm" variant={category===item.id?'default':'outline'} aria-pressed={category===item.id} onClick={()=>{setCategory(item.id);selectTemplate('');}}><Icon className="mr-2 h-4 w-4"/>{item.label}</Button>;})}</div>
    {field('model','Modelo de proposta',select(templateId,selectTemplate,Object.fromEntries(activeModels.map(item=>[item.id,item.title]))),BookOpen)}
   </>}
   <div className="grid gap-3 sm:grid-cols-2">
    {!houseId&&field('source','Via institucional',select(source,value=>{setSource(value);setReview(false);},{bill:'Projeto para votação no Parlamento',...(executive?{decree:'Decreto dentro da competência executiva'}:{})}),Landmark)}
    {source==='bill'&&field('type','Tipo de projeto',select(type,value=>{setType(value);setReview(false);},{PL:'Projeto de Lei (PL)',PEC:'Emenda à Constituição (PEC)'}),ScrollText)}
    {source==='bill'&&!houseId&&field('house','Casa de origem',select(selectedHouse,value=>{setSelectedHouse(value);setReview(false);},Object.fromEntries(houses.map(item=>[item.id,item.name]))),Landmark)}
   </div>
   {source==='bill'&&type&&<p className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm" role="status">{type==='PEC'?'PEC: exige 2/3 dos integrantes de cada Casa, arredondados para cima, e aprovação nas duas Casas. A Presidência participa conforme a regra qualificada.':'PL: maioria simples dos votos válidos, respeitado o quórum mínimo de deliberação do RP. Abstenções não são votos favoráveis; a Presidência conserva o voto de desempate.'}</p>}
   {draft&&<section className="space-y-4 rounded-xl border p-3 sm:p-4">
    <p className="text-sm font-medium">{LEGAL_KIND_LABELS[kind]} · {draft.action==='create'?'Criação':draft.action==='change'?'Alteração':'Revogação'}</p>
    {draft.action!=='create'&&field('rule','Regra vigente a alterar',select(draft.rule_key,key=>{const rule=rules.find(item=>item.rule_key===key);setDraft(createMeasureDraft(template,rule));setReview(false);},Object.fromEntries(ruleOptions.map(item=>[item.rule_key,item.description]))),BookOpen)}
    {current&&<p className="rounded-lg bg-secondary p-3 text-sm">Situação vigente: {measureSummary({...draft,action:'change'},current)}. A escolha não modifica a norma atual.</p>}
    {field('name','Nome da regra',<Input value={draft.name} onChange={event=>update({name:event.target.value})}/>,Tag)}
    {draft.action!=='revoke'&&<>
     <div className="grid gap-3 sm:grid-cols-2">
      {kind!=='project'&&field('audience','Público afetado',select(d.audience,value=>definition({audience:value}),Object.fromEntries(Object.entries(audience).filter(([key])=>{if(kind==='sanction')return true;if(kind==='regulation')return key==='all'||(d.operation?.startsWith('party_')?key==='party':key==='citizen');if(d.basis==='license')return ['all','business'].includes(key);if(['transfer','document'].includes(d.basis)||kind==='penalty')return ['all','citizen'].includes(key);return key!=='party';}))),Users)}
      {['tax','fee','restriction'].includes(kind)&&field('basis','Atividade / base de cálculo',select(d.basis,value=>{definition({basis:value,audience:undefined,sector_id:undefined,category:undefined,document_type:undefined,payer:undefined,nature:undefined});update({value:'',sector_scope:''});},Object.fromEntries(Object.entries(LEGAL_BASIS_LABELS).filter(([key])=>kind!=='restriction'||key!=='document'))),ListChecks)}
      {['tax','fee'].includes(kind)&&<>
       {field('nature','Forma de cobrança',select(d.nature,value=>{definition({nature:value});update({value:''});},{...(!['document','license'].includes(d.basis)?{percentage:'Percentual'}:{}),fixed:'Valor fixo'}),Coins)}
       {field('payer','Quem paga',select(d.payer,value=>definition({payer:value}),{buyer:'Comprador / solicitante',...(d.basis==='purchase'?{seller:'Vendedor'}:{})}),Users)}
      </>}
      {kind==='sanction'&&<>
       {field('sanction','Sanção prevista',select(d.sanction_kind,value=>definition({sanction_kind:value}),sanctions),Scale)}
       {d.sanction_kind==='fine_percentage'&&field('calculation','Base de cálculo',select(d.calculation_basis,value=>definition({calculation_basis:value}),Object.fromEntries(Object.entries(bases).filter(([key])=>d.audience==='citizen'?key==='personal_balance':d.audience==='party'?key==='party_treasury':d.audience==='business'?key.startsWith('business_'):false))),Percent)}
       {d.sanction_kind==='business_suspension'&&decimal('duration_days','Duração da suspensão (dias reais)')}
      </>}
      {kind==='project'&&<>
       {field('region','Estado da obra',select(d.region_code,value=>definition({region_code:value}),Object.fromEntries((catalogs.regions||[]).map(item=>[item.code,item.name]))),MapPin)}
       {field('infrastructure','Infraestrutura',select(d.infrastructure_kind,value=>definition({infrastructure_kind:value}),infrastructure),Construction)}
       {decimal('construction_days','Prazo de construção (1 a 90 dias reais)')}
      </>}
      {field('value',rate?'Percentual (%)':kind==='project'?'Orçamento da obra (R$)':kind==='penalty'?'Pena de referência (anos RP)':kind==='regulation'&&['electoral_minimum_age','electoral_minimum_experience'].includes(d.operation)?'Mínimo exigido (dias de conta / experiência)':kind==='regulation'&&!['party_registration_fee','party_donation_limit'].includes(d.operation)?'Referência (informe 0 para medida sem cobrança)':'Valor (R$)',rate||['penalty','regulation'].includes(kind)?<Input type="number" min="0" step="0.01" value={draft.value===''?'':rate?Number((draft.value*100).toFixed(6)):draft.value} onChange={event=>update({value:event.target.value===''?'':Number(event.target.value)/(rate?100:1)})}/>:<CurrencyInput value={draft.value} onValueChange={value=>update({value})}/>,rate?Percent:Coins)}
      {['tax','fee','benefit'].includes(kind)&&d.basis!=='transfer'&&field('sector','Abrangência setorial',select(draft.sector_scope,value=>{update({sector_scope:value});definition({sector_id:value==='all'?undefined:value});},{all:'Todos os setores',...Object.fromEntries(sectors.map(item=>[item.id,item.name]))}),ListChecks)}
      {d.basis==='purchase'&&field('product-category','Categoria de produto (opcional)',select(d.category??'all',value=>definition({category:value==='all'?undefined:value}),{all:'Todas as categorias',...Object.fromEntries((catalogs.categories||[]).map(item=>[item,item]))}),Tag)}
      {d.basis==='license'&&field('activity','Ramo empresarial (opcional)',select(d.category??'all',value=>definition({category:value==='all'?undefined:value}),{all:'Todos os ramos',...Object.fromEntries(businessTypes.map(item=>[item.id,item.name]))}),Tag)}
      {d.basis==='document'&&field('document','Documento',select(d.document_type,value=>definition({document_type:value}),Object.fromEntries(['CNH','Passport','RG','CPF','CTD','CNPJ','Título de Eleitor','Certificado de Reservista','Certidão de Casamento','Registro Profissional'].map(item=>[item,item]))),FileText)}
      {['tax','fee'].includes(kind)&&<>{currency('min_amount','Operação mínima (opcional)')}{currency('max_amount','Operação máxima (opcional)')}{currency('exempt_below','Isenção até (opcional)')}</>}
      {templateId.includes('incentive')&&<>{decimal('discount_rate','Redução da cobrança (%)',true)}{field('discount-sector','Setor beneficiado',select(d.discount_sector_id,value=>definition({discount_sector_id:value}),Object.fromEntries(sectors.map(item=>[item.id,item.name]))),Users)}</>}
      {kind==='penalty'&&<>{decimal('minimum','Pena mínima (anos RP)')}{decimal('maximum','Pena máxima (anos RP)')}{currency('fine','Multa penal prevista')}</>}
      {kind==='benefit'&&<>{currency('budget','Orçamento total máximo')}{currency('eligible_balance_max','Saldo máximo elegível (opcional)')}</>}
      {kind==='sanction'&&d.sanction_kind?.startsWith('fine_')&&<>{currency('minimum','Multa mínima (opcional)')}{currency('maximum','Multa máxima (opcional)')}{decimal('recurrence_multiplier','Multiplicador por reincidência definitiva (opcional)')}{decimal('late_interest_rate','Juros diários após vencimento (%, opcional)',true)}</>}
      {kind==='regulation'&&d.operation==='party_donation_limit'&&decimal('period_days','Período de apuração das doações (dias)')}
     </div>
     {kind==='sanction'&&<>{field('norm-reference',templateId==='legacy-sanction'?'Norma anterior a estruturar':'Referência a norma anterior (opcional)',select(d.reference_id??'none',value=>{const norm=catalogs.norms?.find(item=>item.source_id===value);definition({reference_kind:norm?.source_kind,reference_id:norm?.source_id});},{none:'Sem referência a norma anterior',...Object.fromEntries((catalogs.norms||[]).map(item=>[item.source_id,`Diário nº ${item.publication_number} · ${item.title}`]))}),BookOpen)}<p className="text-xs text-muted-foreground">A norma anterior permanece no histórico. Estes dispositivos estruturados dependem de nova aprovação e publicação; o texto antigo não é interpretado automaticamente.</p>{field('infraction','Infração prevista na lei',<Textarea value={d.infraction||''} onChange={event=>definition({infraction:event.target.value})}/>,Scale)}{field('conditions','Condições que o juiz deve verificar',<Textarea value={d.conditions||''} onChange={event=>definition({conditions:event.target.value})}/>,ListChecks)}<p className="text-xs text-muted-foreground">Responsabilidade depende da decisão do juiz. A lei não condena automaticamente. Advertências e regularização ficam na decisão; suspensão exige prazo e empresa identificada.</p></>}
     {['restriction','regulation'].includes(kind)&&<>
      {field('scope','Escopo de aplicação',select(d.scope_mode,value=>definition({scope_mode:value,weekdays:undefined,hour_from:undefined,hour_until:undefined}),{total:'Total',hours:'Por horário',weekdays:'Por dias da semana',period:'Período temporário'}),CalendarClock)}
      {d.scope_mode==='hours'&&<div className="grid gap-3 sm:grid-cols-2">{field('from-hour','Das',<Input type="time" value={d.hour_from||''} onChange={event=>definition({hour_from:event.target.value})}/>,CalendarClock)}{field('until-hour','Até',<Input type="time" value={d.hour_until||''} onChange={event=>definition({hour_until:event.target.value})}/>,CalendarClock)}</div>}
      {d.scope_mode==='weekdays'&&multi('weekdays','Dias da semana',['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'].map((label,index)=>[index,label]))}
     </>}
     {kind==='regulation'&&d.operation?.startsWith('party_')&&<>{field('ideology-scope','Abrangência por ideologia / orientação',select(draft.ideology_scope,value=>{update({ideology_scope:value});definition({ideologies:undefined});},{all:'Universal — todas as ideologias',selected:'Somente ideologias selecionadas'}),Users)}{draft.ideology_scope==='selected'&&multi('ideologies','Ideologias / orientações abrangidas',(catalogs.ideologies||[]).map(item=>[item,item]))}{multi('exempt_ideologies','Exceções de ideologia / orientação (opcional)',(catalogs.ideologies||[]).map(item=>[item,item]))}</>}
     {['tax','fee','restriction','benefit'].includes(kind)&&<>{field('territory-scope','Abrangência territorial',select(draft.territory_scope,value=>{update({territory_scope:value});definition({region_codes:undefined});},{country:'País inteiro',states:'Estados específicos'}),MapPin)}{draft.territory_scope==='states'&&multi('region_codes','Estados abrangidos',(catalogs.regions||[]).map(item=>[item.code,item.name]))}</>}
    </>}
    {kind!=='sanction'&&draft.action!=='revoke'&&<section className="space-y-3 rounded-lg border p-3"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(extraSanction)} onChange={event=>{setExtraSanction(event.target.checked?createMeasureDraft({kind:'sanction',action:'create',title:`Sanção por descumprimento de ${draft.name}`,definition:{}}):null);setReview(false);}}/>Prever sanção judicial por descumprimento (opcional)</label>{extraSanction&&<div className="space-y-3"><p className="text-xs text-muted-foreground">O juiz deverá reconhecer a responsabilidade em processo próprio. Esta previsão não aplica culpa ou multa automaticamente.</p>{field('extra-sanction-kind','Sanção por descumprimento',select(extraSanction.definition.sanction_kind,value=>{setExtraSanction(previous=>({...previous,value:'',definition:{...previous.definition,sanction_kind:value}}));setReview(false);},{fine_fixed:'Multa fixa',fine_percentage:'Multa percentual',warning:'Advertência',regularization:'Obrigação de regularização'}),Scale)}{field('extra-audience','Público da sanção',select(extraSanction.definition.audience,value=>{setExtraSanction(previous=>({...previous,definition:{...previous.definition,audience:value,calculation_basis:undefined}}));setReview(false);},audience),Users)}{extraSanction.definition.sanction_kind==='fine_percentage'&&field('extra-base','Base de cálculo da sanção',select(extraSanction.definition.calculation_basis,value=>{setExtraSanction(previous=>({...previous,definition:{...previous.definition,calculation_basis:value}}));setReview(false);},Object.fromEntries(Object.entries(bases).filter(([key])=>extraSanction.definition.audience==='citizen'?key==='personal_balance':extraSanction.definition.audience==='party'?key==='party_treasury':extraSanction.definition.audience==='business'?key.startsWith('business_'):false))),Percent)}{field('extra-value',extraSanction.definition.sanction_kind==='fine_percentage'?'Percentual da multa (%)':'Valor da sanção (R$; informe 0 para medida sem cobrança)',<Input type="number" min="0" step="0.01" value={extraSanction.value===''?'':extraSanction.definition.sanction_kind==='fine_percentage'?extraSanction.value*100:extraSanction.value} onChange={event=>{setExtraSanction(previous=>({...previous,value:event.target.value===''?'':Number(event.target.value)/(extraSanction.definition.sanction_kind==='fine_percentage'?100:1)}));setReview(false);}}/>,Coins)}{['infraction','conditions'].map((key,index)=><React.Fragment key={key}>{field(`extra-${key}`,index?'Condições de aplicação pelo juiz':'Conduta infracional',<Textarea value={extraSanction.definition[key]||''} onChange={event=>{setExtraSanction(previous=>({...previous,definition:{...previous.definition,[key]:event.target.value}}));setReview(false);}}/>,ListChecks)}</React.Fragment>)}</div>}</section>}
    <div className="grid gap-3 sm:grid-cols-2">{field('validity','Início da vigência',select(draft.validity_mode,value=>update({validity_mode:value,valid_from:''}),{immediate:'Após publicação válida',date:'Data e hora específicas'}),CalendarClock)}{draft.validity_mode==='date'&&field('start','Data e hora (Brasília)',<Input type="datetime-local" value={draft.valid_from} onChange={event=>update({valid_from:event.target.value})}/>,CalendarClock)}{field('end','Fim da vigência (obrigatório para benefício e restrição temporária)',<Input type="datetime-local" value={draft.valid_until} onChange={event=>update({valid_until:event.target.value})}/>,CalendarClock)}</div>
    {source==='decree'&&<p role="status" className="rounded-lg border p-3 text-sm">{competence?.description}{!competence?.decree_allowed&&' Esta matéria exige aprovação legislativa.'}</p>}
   </section>}
   <div className="space-y-3">{field('title','Título',<Input value={title} onChange={event=>{setTitle(event.target.value);setReview(false);}}/>,Tag)}{field('summary','Ementa e explicação',<Textarea value={summary} onChange={event=>{setSummary(event.target.value);setReview(false);}}/>,FileText)}{field('text','Texto legal',<Textarea rows={6} value={text} onChange={event=>{setText(event.target.value);setReview(false);}}/>,ScrollText)}</div>
   <section aria-live="polite" className="space-y-3 rounded-xl bg-secondary p-4"><h3 className="text-center font-semibold">O que esta medida fará se entrar em vigor?</h3>{draft?<><p className="break-words text-sm">{measureSummary(draft,current)}</p><dl className="grid gap-2 text-sm sm:grid-cols-2">{Object.entries(d).filter(([,value])=>value!==''&&value!=null&&(!Array.isArray(value)||value.length)).map(([key,value])=><div className="min-w-0" key={key}><dt className="text-muted-foreground">{definitionLabels[key]||key}</dt><dd className="break-words">{formatDefinition(key,value)}</dd></div>)}</dl><p className="text-sm">Vigência: {draft.validity_mode==='immediate'?'após publicação válida':draft.valid_from?formatDateTimeBR(new Date(draft.valid_from)):'ainda não definida'}.{draft.valid_until&&` Até ${formatDateTimeBR(new Date(draft.valid_until))}.`}</p>{kind==='project'&&<p className="text-xs">A publicação cria a obra no Governo. O orçamento é reservado quando houver saldo no Tesouro; a construção e a manutenção seguem os prazos existentes. Os efeitos regionais dependem da conclusão.</p>}</>:<p className="text-sm">Texto para deliberação. Nenhum efeito automático foi configurado.</p>}{extraSanction&&<p className="text-sm">Sanção adicional: {sanctions[extraSanction.definition.sanction_kind]||'a definir'} · {audience[extraSanction.definition.audience]||'público a definir'} · {extraSanction.value===''?'valor a definir':extraSanction.definition.sanction_kind==='fine_percentage'?`${Number(extraSanction.value)*100}%`:`R$ ${Number(extraSanction.value).toLocaleString('pt-BR')}`}.</p>}<p className="text-xs text-muted-foreground">Operações anteriores e decisões já registradas preservam seus snapshots. A validação técnica de competência não substitui controle judicial de constitucionalidade.</p></section>
   <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={review} onChange={event=>setReview(event.target.checked)}/>Revisei o texto, o quórum, a vigência e os efeitos desta proposta.</label>
   <DialogFooter><Button variant="outline" disabled={saving} onClick={()=>setOpen(false)}><X className="mr-2 h-4 w-4"/>Cancelar</Button><Button disabled={!review||saving||loadError||mode==='template'&&!draft||source==='decree'&&!competence?.decree_allowed} onClick={submit}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Send className="mr-2 h-4 w-4"/>}{source==='decree'?'Salvar decreto':'Propor Projeto'}</Button></DialogFooter>
  </DialogContent></Dialog>
 </>;
}
