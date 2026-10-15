// UI feedback only. Database triggers and API authorization independently enforce
// the persisted mode, even if a caller changes this in-memory flag.
let preview=false;
export const setAdminPreview=enabled=>{preview=enabled===true;};
export const isAdminPreview=()=>preview;
export const ADMIN_PREVIEW_MESSAGE='Você está em pré-visualização. Nenhuma ação real foi executada.';
export function previewRequestBlocked(input,options={}){
 if(!preview)return false;
 const url=new URL(typeof input==='string'?input:input.url,globalThis.location?.origin||'https://govrp.vercel.app');
 const method=(options.method||input?.method||'GET').toUpperCase();
 if(['GET','HEAD','OPTIONS'].includes(method))return false;
 if(url.pathname.includes('/storage/v1/'))return true;
 if(!url.pathname.includes('/rest/v1/'))return false;
 const name=url.pathname.split('/rpc/')[1];
 return !name||!(name==='set_admin_development_mode'||/^(get_|admin_get_|search_|quote_|can_|is_|simulate_)/.test(name));
}
