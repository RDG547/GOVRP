import React,{useMemo,useState} from 'react';
import {Circle,Loader2,AlertTriangle} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {GovSelect} from '@/components/ui/gov-select';
import UserSelectOption from '@/components/UserSelectOption';
import PartyIdentity from '@/components/parliament/PartyIdentity';
import {PurchaseTotals,ItemTaxDetails} from '@/components/business/PurchaseBreakdown';
import TransactionTaxBreakdown from '@/components/bank/TransactionTaxBreakdown';
import {formatCurrency} from '@/lib/utils';
import {formatDateTimeBR,formatLocaleBR} from '@/lib/dateTime';
import {componentRegistry} from './componentRegistry';
import templates from './blueprints.json';
import {fixtureValue,previewPerson,previewRecord,previewDate} from './fixtures';

const forbidden=new Set(['__proto__','prototype','constructor','caller','callee']);
const blueprints=templates.modals;
const methods=new Set(['map','filter','find','some','every','includes','join','slice','at','flat','flatMap','toFixed','toString','toLowerCase','toUpperCase','toLocaleLowerCase','toLocaleUpperCase','trim','replace','replaceAll','split','startsWith','endsWith','indexOf']);
const formatDate=value=>{const date=new Date(value||previewDate);return Number.isNaN(date.getTime())?'15/10/2026':date.toLocaleDateString('pt-BR');};
const globals={Number,String,Boolean,parseFloat,parseInt,Math,Object:{keys:Object.keys,values:Object.values,entries:Object.entries,fromEntries:Object.fromEntries},Array:{isArray:Array.isArray},JSON:{stringify:JSON.stringify},Date:{now:()=>Date.parse(previewDate)},formatCurrency,formatDateTimeBR,formatLocaleBR,format:formatDate,formatDate,cn:(...parts)=>parts.filter(p=>typeof p==='string').join(' ')};
const child=value=>React.isValidElement(value)||typeof value==='string'||typeof value==='number'?value:Array.isArray(value)?value.map(child):null;

// Interpret only presentation data and a small set of pure operations. This is
// deliberately not JavaScript eval: network, effects, original handlers, storage,
// navigation and arbitrary host functions do not exist in this environment.
function environment(blueprint,role,values,render) {
 const cache={...values},resolving=new Set();let budget=12000;
 const get=name=>{
  if(Object.hasOwn(cache,name))return cache[name];
  if(Object.hasOwn(globals,name))return globals[name];
  if(resolving.has(name))return undefined;
  resolving.add(name);
  const initial=evaluate(blueprint.bindings[name]);
  const value=fixtureValue(name,initial,role);
  cache[name]=value;resolving.delete(name);return value;
 };
 const block=(node,scope)=>{
  if(node.type!=='BlockStatement')return evaluate(node,scope);
  const local={...scope};
  for(const statement of node.body){
   if(statement.type==='ReturnStatement')return evaluate(statement.argument,local);
   if(statement.type==='VariableDeclaration')for(const d of statement.declarations)if(d.id.type==='Identifier')local[d.id.name]=evaluate(d.init,local);
   if(statement.type==='IfStatement'&&evaluate(statement.test,local))return block(statement.consequent,local);
  }
 };
 const evaluate=(node,scope={})=>{
  if(!node||--budget<0)return undefined;
  try{
   switch(node.type){
    case 'StringLiteral':case 'NumericLiteral':case 'BooleanLiteral':return node.value;
    case 'NullLiteral':return null;
    case 'Identifier':return Object.hasOwn(scope,node.name)?scope[node.name]:get(node.name);
    case 'JSXElement':case 'JSXFragment':return render(node,scope,evaluate);
    case 'ArrayExpression':return node.elements.flatMap(n=>n?.type==='SpreadElement'?evaluate(n.argument,scope)||[]:[evaluate(n,scope)]);
    case 'ObjectExpression':{const result={};for(const p of node.properties){if(p.type==='SpreadElement')Object.assign(result,evaluate(p.argument,scope));else{const key=p.computed?evaluate(p.key,scope):p.key.name??p.key.value;if(!forbidden.has(key))result[key]=evaluate(p.value,scope);}}return result;}
    case 'MemberExpression':case 'OptionalMemberExpression':{const object=evaluate(node.object,scope),key=node.computed?evaluate(node.property,scope):node.property.name;return forbidden.has(key)?undefined:object?.[key];}
    case 'ConditionalExpression':return evaluate(evaluate(node.test,scope)?node.consequent:node.alternate,scope);
    case 'LogicalExpression':{const left=evaluate(node.left,scope);return node.operator==='&&'?(left?evaluate(node.right,scope):left):node.operator==='||'?(left||evaluate(node.right,scope)):(left??evaluate(node.right,scope));}
    case 'UnaryExpression':{const v=evaluate(node.argument,scope);return node.operator==='!'?!v:node.operator==='-'?-v:node.operator==='+'?+v:node.operator==='typeof'?typeof v:undefined;}
    case 'BinaryExpression':{const a=evaluate(node.left,scope),b=evaluate(node.right,scope);switch(node.operator){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;case '===':case '==':return a===b;case '!==':case '!=':return a!==b;case '>':return a>b;case '<':return a<b;case '>=':return a>=b;case '<=':return a<=b;default:return undefined;}}
    case 'TemplateLiteral':return node.quasis.map((q,i)=>q.value.cooked+(i<node.expressions.length?String(evaluate(node.expressions[i],scope)??''):'')).join('');
    case 'ArrowFunctionExpression':case 'FunctionExpression':return (...args)=>block(node.body,{...scope,...Object.fromEntries(node.params.map((p,i)=>[p.name,args[i]]))});
    case 'NewExpression':return node.callee.name==='Date'?new Date(evaluate(node.arguments[0],scope)||previewDate):undefined;
    case 'CallExpression':case 'OptionalCallExpression':{
     const args=node.arguments.map(n=>evaluate(n,scope)),callee=node.callee;
     if(callee.type==='Identifier'){
      if(['useState','useMemo','useCallback'].includes(callee.name))return typeof args[0]==='function'?args[0]():args[0];
      if(callee.name==='Boolean')return Boolean(args[0]);
      if(Object.hasOwn(globals,callee.name)&&typeof globals[callee.name]==='function')return globals[callee.name](...args);
      if(/currency|money|amount/i.test(callee.name))return formatCurrency(Number(args[0])||0);
      if(/^format.*date|^format.*time/i.test(callee.name))return formatDate(args[0]);
      return undefined;
     }
     const object=evaluate(callee.object,scope),key=callee.computed?evaluate(callee.property,scope):callee.property?.name;
     if(forbidden.has(key))return undefined;
     if([Math,globals.Object,globals.Array,globals.JSON,globals.Date].includes(object)&&typeof object?.[key]==='function')return object[key](...args);
     if((Array.isArray(object)||typeof object==='string'||typeof object==='number')&&methods.has(key)&&typeof object?.[key]==='function')return object[key](...args);
     if(object instanceof Date&&['toLocaleDateString','toLocaleString','toISOString'].includes(key))return object[key](...args);
     return undefined;
    }
    default:return undefined;
   }
  }catch{return undefined;}
 };
 return {evaluate,get};
}

const safeCustom={UserSelectOption,PartyIdentity,PurchaseTotals,ItemTaxDetails,TransactionTaxBreakdown};
const tagName=n=>n?.type==='JSXMemberExpression'?`${tagName(n.object)}.${tagName(n.property)}`:n?.name;
function PreviewTemplate({entry,role,width,onClose,onFeedback,definition,embeddedProps={},depth=0}) {
 const [values,setValues]=useState({});
 const blueprint=definition||blueprints[entry.id];
 const content=useMemo(()=>{
  const update=(name,value)=>setValues(current=>({...current,[name]:value}));
  const render=(node,scope,evaluate)=>{
   if(node.type==='JSXText')return /^\s*$/.test(node.value)&&node.value.includes('\n')?null:node.value.replace(/\s+/g,' ');
   if(node.type==='JSXExpressionContainer')return child(evaluate(node.expression,scope));
   if(node.type==='JSXFragment')return <React.Fragment>{node.children.map((n,i)=><React.Fragment key={i}>{render(n,scope,evaluate)}</React.Fragment>)}</React.Fragment>;
   if(node.type!=='JSXElement')return null;
   const tag=tagName(node.openingElement.name),attrs={},attributeNodes={};
   for(const a of node.openingElement.attributes){if(a.type!=='JSXAttribute')continue;const name=a.name.name;attributeNodes[name]=a.value;attrs[name]=!a.value?true:a.value.type==='StringLiteral'?a.value.value:evaluate(a.value.expression,scope);}
   const children=node.children.map(n=>render(n,scope,evaluate)).filter(value=>value!==null&&value!==undefined&&value!==false&&value!=='').map((value,index)=>React.isValidElement(value)?React.cloneElement(value,{key:value.key??index}):value);
   if(['script','iframe','object','embed','style'].includes(tag))return null;
   if(tag==='Link')return <span {...{className:attrs.className}}>{children}</span>;
   if(tag==='DialogContent'||tag==='AlertDialogContent')return <DialogContent className={typeof attrs.className==='string'?attrs.className.replace(/\[&>button\]:hidden/g,''):undefined} onEscapeKeyDown={onClose} style={{...attrs.style,...(width==='mobile'?{maxWidth:320}:{})}} data-preview-source={entry.id}>{children}<DialogDescription className="sr-only">Prévia isolada de {entry.title}, com dados fictícios.</DialogDescription></DialogContent>;
   if(tag==='AlertDialogTitle')return <DialogTitle {...attrs}>{children}</DialogTitle>;
   if(tag==='AlertDialogDescription')return <DialogDescription {...attrs}>{children}</DialogDescription>;
   if(tag==='Dialog'||tag==='AlertDialog')return null;
   const inputTag=['Input','Textarea','CurrencyInput','GovSelect','Select','Checkbox','Switch','input','textarea','select'].includes(tag);
   if(inputTag){
    const expression=attributeNodes.value?.expression||attributeNodes.checked?.expression;
    const storeValue=value=>{
     if(expression?.type==='Identifier')update(expression.name,value);
     else if(['MemberExpression','OptionalMemberExpression'].includes(expression?.type)&&expression.object.type==='Identifier'){
      const name=expression.object.name,key=expression.computed?evaluate(expression.property,scope):expression.property.name;
      if(!forbidden.has(key))update(name,{...evaluate(expression.object,scope),[key]:value});
     }
    };
    attrs.onChange=event=>storeValue(event.target.type==='checkbox'?event.target.checked:event.target.value);
    attrs.onValueChange=storeValue;attrs.onCheckedChange=storeValue;
    if(attrs.value!==undefined&&typeof attrs.value==='object')attrs.value='';
   }
   if(tag==='form')attrs.onSubmit=event=>{event.preventDefault();onFeedback('Ação de teste concluída. Nenhum dado do RP foi alterado.');};
   if(['Button','button','AlertDialogAction','AlertDialogCancel'].includes(tag)){
    attrs.type='button';attrs.onClick=()=>{
     const label=node.children.filter(n=>n.type==='JSXText').map(n=>n.value).join('');
     if(/fechar|cancelar|voltar|continuar|entendi/i.test(label))onClose();else onFeedback('Ação de teste concluída. Nenhum dado do RP foi alterado.');
    };
   }
   if(tag==='img'){attrs.src=undefined;attrs.alt=attrs.alt||'Imagem de exemplo';}
   if(tag==='CitizenSelector')return <label className="block space-y-2 text-sm">{attrs.label||'Selecionar cidadão'}<GovSelect value={values.previewCitizen||''} onChange={e=>update('previewCitizen',e.target.value)}><option value="">Selecione um cidadão</option><option value="example">Maria Exemplo · {role}</option></GovSelect></label>;
   if(tag==='PaymentSelector')return <label className="block space-y-2 text-sm">Forma de pagamento<GovSelect value={values.previewPayment||'balance'} onChange={e=>update('previewPayment',e.target.value)}><option value="balance">Saldo em conta · R$ 10.000,00</option><option value="credit">Cartão de crédito · final 1234</option></GovSelect></label>;
   const alias=blueprint.aliases[tag];
   if(alias?.startsWith('embedded:')&&depth<4){const nested=templates.embedded[alias.slice(9)];if(nested)return <PreviewTemplate entry={entry} definition={nested} embeddedProps={attrs} role={role} width={width} onClose={onClose} onFeedback={onFeedback} depth={depth+1}/>;}
   const Component=['AlertDialogAction','AlertDialogCancel'].includes(tag)?Button:componentRegistry[alias]||safeCustom[tag];
   if(Component){
    if(tag==='UserSelectOption'&&!attrs.user)attrs.user=previewPerson(role);
    if(tag==='PartyIdentity'&&!attrs.party)attrs.party=previewRecord(role).party;
    if(tag==='PurchaseTotals'&&!Array.isArray(attrs.items))attrs.items=[previewRecord(role)];
    if(tag==='ItemTaxDetails'&&!attrs.item)attrs.item=previewRecord(role);
    return React.createElement(Component,attrs,...children);
   }
   if(/^[a-z]/.test(tag)&&!tag.includes('.'))return React.createElement(tag,attrs,...children);
   if(/Icon$/.test(tag))return <Circle className={attrs.className||'h-5 w-5'}/>;
   // Embedded form adapters are supplied with their own extracted template below.
   return <div className={attrs.className} data-preview-component={tag}>{children.length?children:<Input aria-label={tag} placeholder="Dados de exemplo"/>}</div>;
  };
  const sourceValues=entry.source.endsWith('/CompanyManagement.jsx')?{editor:{...previewRecord(role),kind:'change'}}:entry.id==='src/pages/dashboards/panels/PresidentDashboard.jsx:5'?{reviewState:{action:'veto_partial',bill:{title:'Projeto de exemplo'}}}:{};
  const env=environment(blueprint,role,{title:entry.title,...sourceValues,...embeddedProps,...values},render);
  return render(blueprint.tree,{},env.evaluate);
 },[blueprint,depth,embeddedProps,entry,onClose,onFeedback,role,values,width]);
 return content;
}

export default function BlueprintPreview({entry,role,width,state,onClose,onFeedback}) {
 if(!blueprints[entry.id])throw new Error(`Modal sem prévia específica: ${entry.id}`);
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}>{state==='success'?<PreviewTemplate key={entry.id} entry={entry} role={role} width={width} onClose={onClose} onFeedback={onFeedback}/>:<DialogContent style={width==='mobile'?{maxWidth:320}:undefined}><DialogHeader><DialogTitle>{entry.title}</DialogTitle><DialogDescription>Estado de teste · dados fictícios</DialogDescription></DialogHeader>{state==='loading'?<p role="status" className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin"/>Carregando {entry.title.toLocaleLowerCase('pt-BR')}…</p>:state==='error'?<p role="alert" className="flex gap-2 text-destructive"><AlertTriangle/>Não foi possível carregar este registro de exemplo.</p>:<p>Nenhum registro disponível para {entry.title.toLocaleLowerCase('pt-BR')}.</p>}<Button onClick={onClose}>Fechar</Button></DialogContent>}</Dialog>;
}
