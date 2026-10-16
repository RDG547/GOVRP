import {readdir,readFile,writeFile} from 'node:fs/promises';
import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import pathModule from 'node:path';
const traverse=traverseModule.default;
async function files(dir){return(await Promise.all((await readdir(dir,{withFileTypes:true})).map(item=>item.isDirectory()?files(`${dir}/${item.name}`):item.name.endsWith('.jsx')?[`${dir}/${item.name}`]:[]))).flat();}
const entries=[],blueprints={},embedded={},components=new Map(),documents=new Map();
const clean=value=>JSON.parse(JSON.stringify(value,(key,item)=>['loc','start','end','extra','leadingComments','trailingComments','innerComments'].includes(key)?undefined:item));
const tagName=node=>node?.type==='JSXMemberExpression'?`${tagName(node.object)}.${tagName(node.property)}`:node?.name;
const names={CompanyManagement:'Função e salário',CompanyProduction:'Comprar insumo',EntrepreneurPortal:'Colocar empresa à venda',CandidacyManagement:'Revisar candidatura',DigitalArchive:'Consultar documento',ServiceDocumentation:'Documentação do serviço',ArmedForces:'Forças Armadas',Police:'Polícia',AuthorityJusticeDashboard:'Ações da autoridade judicial',ElectionOfficeAwardPopup:'Avisos institucionais e mudança de cargo',ElectoralManagement:'Gestão eleitoral',ResetManagement:'Reinicialização do RP',ServiceAccess:'Selecionar acesso ao serviço',PartyDetailsDialog:'Detalhes do Partido',FollowListModal:'Seguidores / Seguindo'};
const manual=new Set(['UserSelectOption','PartyIdentity','PurchaseTotals','ItemTaxDetails','TransactionTaxBreakdown','CitizenSelector','PaymentSelector','Link']);
const sanitize=node=>{
 if(!node||typeof node!=='object')return;
 if(node.type==='JSXOpeningElement')node.attributes=node.attributes.filter(a=>a.type==='JSXAttribute'&&!/^(on[A-Z]|ref|dangerouslySetInnerHTML|action|formAction|href|to)$/.test(a.name.name));
 for(const value of Object.values(node))if(Array.isArray(value))value.forEach(sanitize);else if(value&&typeof value==='object')sanitize(value);
};
const sourceModule=(file,raw)=>raw.startsWith('.')?'@/'+pathModule.posix.normalize(pathModule.posix.join(pathModule.posix.dirname(file),raw)).replace(/^src\//,''):raw;
function returnTemplate(binding){
 if(!binding)return null;
 let fn=binding.path;
 if(fn.isVariableDeclarator())fn=fn.get('init');
 if(fn?.isCallExpression()&&fn.node.callee.type==='MemberExpression'&&fn.node.callee.property.name==='forwardRef')fn=fn.get('arguments.0');
 if(!fn?.isFunction())return null;
 if(fn.get('body').isJSXElement()||fn.get('body').isJSXFragment())return fn.get('body');
 let result;
 fn.traverse({ReturnStatement(p){if(result||p.getFunctionParent()!==fn)return;const arg=p.get('argument');if(arg.isJSXElement()||arg.isJSXFragment())result=arg;}});
 return result;
}
function importedTemplate(module,exportName){
 const file=module.replace(/^@\//,'src/').replace(/\.jsx$/,'')+'.jsx',ast=documents.get(file);
 if(!ast)return null;
 let binding;
 traverse(ast,{Program(p){
  if(exportName!=='default')binding=p.scope.getBinding(exportName);
  else p.get('body').forEach(item=>{if(!item.isExportDefaultDeclaration())return;const d=item.get('declaration');binding=d.isIdentifier()?p.scope.getBinding(d.node.name):{path:d};});
 }});
 return {file,path:returnTemplate(binding)};
}
function compile(template,file){
 const bindings={},aliases={},allBindings=template.scope.getAllBindings();
 const tree=clean(template.node);sanitize(tree);
 const needed=new Set(),tags=new Set();
 const inspect=node=>{if(!node||typeof node!=='object')return;if(node.type==='Identifier')needed.add(node.name);if(node.type==='JSXOpeningElement')tags.add(tagName(node.name));for(const value of Object.values(node))if(Array.isArray(value))value.forEach(inspect);else inspect(value);};
 inspect(tree);
 for(const [key,binding] of Object.entries(allBindings)){
  const node=binding.path.node;
  if(binding.kind==='module'){
   const module=sourceModule(file,binding.path.parent.source.value),imported=node.imported?.name||'default';
   if(module.startsWith('@/components/ui/')||['lucide-react','react-icons/fa','react-icons/md','react-icons/hi','react-icons/bs'].includes(module)){
    const identity=module+':'+imported;
    if(!components.has(identity))components.set(identity,{module,imported,key:`PreviewComponent${components.size}`});
    aliases[key]=components.get(identity).key;
   }else if(tags.has(key)&&!manual.has(key)){
    const target=importedTemplate(module,imported);
    if(target?.path){const id=`${target.file}#${imported}`;aliases[key]=`embedded:${id}`;if(!(id in embedded)){embedded[id]=null;embedded[id]=compile(target.path,target.file);}}
   }
  }else{
   if(tags.has(key)&&!manual.has(key)){
    const jsx=returnTemplate(binding);
    if(jsx){const id=`${file}#${key}`;aliases[key]=`embedded:${id}`;if(!(id in embedded)){embedded[id]=null;embedded[id]=compile(jsx,file);}}
   }
   if(node.type==='VariableDeclarator'&&node.id.type==='Identifier')bindings[key]=clean(node.init);
   else if(node.type==='VariableDeclarator'&&node.id.type==='ArrayPattern'&&node.init?.type==='CallExpression'&&node.init.callee.name==='useState'&&node.id.elements[0]?.name===key)bindings[key]=clean(node.init.arguments[0]||{type:'NullLiteral'});
  }
 }
 const used={};
 for(let round=0;round<8;round++)for(const key of needed){
  if(key in used||!(key in bindings))continue;
  const value=bindings[key];
  if(value&&(['ArrowFunctionExpression','FunctionExpression'].includes(value.type)||JSON.stringify(value).length>12000))continue;
  if(value?.type==='CallExpression'&&['useCallback','useEffect'].includes(value.callee?.name))continue;
  sanitize(value);used[key]=value;inspect(value);
 }
 return {tree,bindings:used,aliases};
}
for(const file of await files('src')){
 if(file.includes('/ui/')||file.includes('/admin/modal-preview/')||file.endsWith('/ModalGallery.jsx'))continue;
 documents.set(file,parse(await readFile(file,'utf8'),{sourceType:'module',plugins:['jsx']}));
}
for(const [file,ast] of documents){let index=0;
 traverse(ast,{JSXElement(path){const name=tagName(path.node.openingElement.name);if(!['DialogTitle','AlertDialogTitle'].includes(name))return;
  const texts=path.node.children.filter(n=>n.type==='JSXText').map(n=>n.value.trim()).filter(Boolean);
  path.traverse({StringLiteral(p){if(p.findParent(parent=>parent.isJSXAttribute()))return;if((p.parentPath.isConditionalExpression()&&['consequent','alternate'].includes(p.key)||p.parentPath.isLogicalExpression()&&p.key==='right')&&p.node.value.trim())texts.push(p.node.value.trim());},TemplateElement(p){if(!p.findParent(parent=>parent.isJSXAttribute())&&p.node.value.cooked.trim())texts.push(p.node.value.cooked.trim());}});
  const text=texts.join(' / ').replace(/\s+/g,' ').slice(0,140),fallback=names[file.split('/').at(-1).replace('.jsx','')]||file.split('/').at(-1).replace('.jsx','').replace(/([a-z])([A-Z])/g,'$1 $2');
  const title=/[\p{L}\p{N}]/u.test(text)?text:fallback,id=`${file}:${++index}`;
  const content=path.findParent(parent=>parent.isJSXElement()&&['DialogContent','AlertDialogContent'].includes(tagName(parent.node.openingElement.name)));
  if(!content)throw new Error(`O modal ${id} não possui conteúdo para pré-visualização.`);
  blueprints[id]=compile(content,file);entries.push({id,title,source:file});
 }});
}
entries.sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
await writeFile('src/lib/modalCatalog.js',`// Generated from the real modal templates by tools/sync-modal-catalog.mjs.\nexport const MODAL_CATALOG=${JSON.stringify(entries,null,1)};\n`);
await writeFile('src/components/admin/modal-preview/blueprints.json',JSON.stringify({modals:blueprints,embedded}));
await writeFile('src/components/admin/modal-preview/componentRegistry.jsx',`// Generated from UI components used by the real modal templates.\n${[...components.values()].map(c=>c.imported==='default'?`import ${c.key} from '${c.module}';`:`import {${c.imported} as ${c.key}} from '${c.module}';`).join('\n')}\nexport const componentRegistry={${[...components.values()].map(c=>c.key).join(',')}};\n`);
console.log(`${entries.length} modais com conteúdo específico; ${Object.keys(embedded).length} apresentações incorporadas.`);
