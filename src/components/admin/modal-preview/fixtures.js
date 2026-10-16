// All data belongs to the preview. No user, account or world record is read.
export const previewDate = '2026-10-15T15:00:00.000Z';
export const previewPerson = role => ({id:'11111111-1111-4111-8111-111111111111',full_name:'Maria Exemplo',name:'Maria Exemplo',username:'maria.exemplo',x_handle:'maria.exemplo',role,avatar_url:null});
export function previewRecord(role) {
 const profile=previewPerson(role),party={id:'example-party',name:'Partido Exemplo',acronym:'PE',color:'#22d3ee',description:'Partido fictício para desenvolvimento.',created_at:previewDate,members:[{user_id:profile.id,profiles:profile,role:'Membro'}]};
 return {...profile,profile,profiles:profile,user:profile,party,title:'Registro de exemplo',description:'Dados fictícios para inspecionar esta interface.',summary:'Registro controlado da pré-visualização.',content:'Conteúdo de exemplo, sem efeito no mundo do RP.',number:'RP-EXEMPLO',reference:'RP-EXEMPLO',name:'Empresa Exemplo',business_name:'Empresa Exemplo',ministry:'Ministério da Saúde',status:'active',type:'PL',kind:'buy',created_at:previewDate,updated_at:previewDate,expires_at:'2026-12-31T15:00:00Z',due_date:previewDate,amount:1250,value:1250,price:1250,final_price:1250,total:1250,balance:10000,quantity:2,stock:100,tax_amount:25,gross_amount:1250,net_amount:1225,total_debited:1275,tax_rate_snapshot:.02,rate:2,account_number:'12345-6',bank_name:'Banco Nacional',agency:'0001',card_number:'4111111111111234',last_four:'1234',brand:'visa',limit:5000,available_limit:4000,term_months:12,installments:12,role_template_id:'example',salary:1250,base_weekly_salary:1250,annual_budget:10000,level:1,positions:1,region_code:'SP',color:'#22d3ee',metadata:{business_name:'Empresa Exemplo',gross_revenue:5000,operating_cost:2000,net_result:3000},founder:profile,president:profile,vice_president:profile,author:profile,sender:profile,recipient:profile,holder:profile,members:[profile],votes:70,percentage:70,participation:{eligible:100,participants:80,valid_votes:70,blank_votes:6,null_votes:4,abstentions:20}};
}
export function fixtureValue(name,initial,role) {
 const record=previewRecord(role);
 if(name==='user'||name==='canonicalUser'||name==='currentUser')return {...previewPerson(role),is_platform_admin:true,effective_roles:[role]};
 if(/selectedUser|selectedProfile|selectedCitizen|candidateTo|selectedCandidate/i.test(name))return {...record,...previewPerson(role)};
 if(/party$/i.test(name))return record.party;
 if(/^(loading|saving|busy|submitting|isLoading|isSaving|isSubmitting|isCreating|claiming|deleting|isDeleting|processing|isProcessing|unavailable|blocked|disabled|error|errors)/i.test(name))return initial??false;
 if(/^(can[A-Z]|has[A-Z]|isAuthorized|quoteReady)/.test(name))return true;
 if(initial!==null&&initial!==undefined){
  if(Array.isArray(initial))return initial.length?initial:[record];
  return initial;
 }
 if(/amount|price|balance|salary|value|total|fee|limit|cost|revenue/i.test(name))return 1250;
 if(/quantity|count|page|streak|days|duration/i.test(name))return 1;
 if(/^(is|show|open|has|can)[A-Z]/.test(name))return true;
 if(/^(form|draft|editor|data|selected|current|target|pending|detail|record|receipt|notification|candidate|account|business|company|transaction|bill|loan|card|offer|product|item|payment|election|profile|minister|government)/i.test(name))return record;
 if(/s$|list|options|rows/i.test(name))return [record];
 if(/form$|^editing|^.*To(Delete|Edit|Remove|Cancel)$/i.test(name))return record;
 return initial===null?record:undefined;
}
