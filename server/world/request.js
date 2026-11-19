import process from 'node:process';

// Every authenticated application endpoint checks the same database authority
// before a service-role operation. Webhooks still validate their own signature.
export async function withWorldRequest(request, work, response) {
 const path=new URL(request.url||'/', 'http://localhost');
 if(request.method==='OPTIONS'||(path.pathname==='/api/donations/stripe-checkout'&&typeof request.headers['stripe-signature']==='string'))return work();
 const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY||process.env.VITE_SUPABASE_ANON_KEY;
 if(!url||!key) return work(); // Existing handlers report missing server configuration.
 try {
  const upstream=await globalThis.fetch(`${url.replace(/\/+$/,'')}/rest/v1/rpc/get_platform_access`,{
   method:'POST',headers:{apikey:key,'Content-Type':'application/json',...(request.headers.authorization?{Authorization:request.headers.authorization}:{})},body:'{}',signal:AbortSignal.timeout(8000),
  });
  const access=upstream.ok?await upstream.json():null;
  if(access?.allowed===true)return work();
  if(response){response.statusCode=503;response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','application/json; charset=utf-8');response.end(JSON.stringify({error:'A plataforma está temporariamente indisponível para esta conta.',code:'PLATFORM_UNAVAILABLE'}));return;}
  throw new Error('A plataforma está temporariamente indisponível para esta conta.');
 }catch(error){
  if(!response)throw error;
  response.statusCode=503;response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','application/json; charset=utf-8');response.end(JSON.stringify({error:'Não foi possível verificar a disponibilidade da plataforma. Tente novamente.'}));
 }
}
export const worldServerFetch=(input,options)=>globalThis.fetch(input,options);
