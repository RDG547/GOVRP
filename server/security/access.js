import crypto from 'node:crypto';
import net from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { isPlatformAdmin, assertRealWorldAction } from '../admin/development.js';
import { worldServerFetch } from '../world/request.js';

const ORIGIN = 'https://govrp.vercel.app';
const DEVICE_COOKIE = '__Host-govrp_browser';
const DEVICE_NAME_DEV = 'govrp_browser_dev';
const getSecret = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Variável obrigatória ausente: ' + name);
  return value;
};
const service = () => createClient(getSecret('VITE_SUPABASE_URL'),getSecret('SUPABASE_SECRET_KEY'),{
  global:{fetch:worldServerFetch}, auth:{autoRefreshToken:false,persistSession:false},
});
const json = (res,status,payload) => {
  res.statusCode=status;
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};
const cookieFor = (request,response) => {
  const secure=process.env.VERCEL==='1';
  const name=secure?DEVICE_COOKIE:DEVICE_NAME_DEV;
  const cookies=String(request.headers.cookie||'').split(';');
  let value=cookies.map(part=>part.trim()).find(part=>part.startsWith(name+'='))?.slice(name.length+1);
  if(!/^[a-f0-9]{64}$/.test(value||'')){
    value=crypto.randomBytes(32).toString('hex');
    response.setHeader('Set-Cookie',name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000'+(secure?'; Secure':''));
  }
  return crypto.createHash('sha256').update(value).digest('hex');
};
const trustedIp = (request) => {
  // Vercel overwrites X-Forwarded-For at its edge, so refuse multipart or arbitrary dev headers.
  if(process.env.VERCEL!=='1')return null;
  const raw=request.headers['x-forwarded-for'];
  if(typeof raw!=='string'||raw.includes(',')||!net.isIP(raw.trim()))return null;
  return raw.trim();
};
const readBody = async request => {
  if (request.body && typeof request.body==='object')return request.body;
  if(typeof request.body==='string')return request.body?JSON.parse(request.body):{};
  let input='';
  for await (const chunk of request){input+=chunk.toString();if(input.length>8000)throw new Error('Requisição muito grande.');}
  return input?JSON.parse(input):{};
};
const bearer = request => {
  const header=String(request.headers.authorization||'');
  return /^Bearer\s+\S+/i.test(header)?header.replace(/^Bearer\s+/i,''):null;
};
const rpc = async (client,name,args) => {
  const {data,error}=await client.rpc(name,args);
  if(error)throw new Error(error.message||'Falha na verificação de acesso.');
  return data;
};
const reject = (res,detail,code=403) => json(res,code,{allowed:false,code:'GOVRP_MODERATION_BAN',reason:detail||'Acesso bloqueado pela moderação do GOVRP. Solicite uma revisão ao CDA.'});
const trimmed = value => typeof value==='string'?value.trim():'';

export async function authAccessHandler(request,response){
  if(request.method!=='POST')return json(response,405,{error:'Método inválido.'});
  try{
    if(request.headers.origin && ![ORIGIN,'https://'+request.headers.host].includes(request.headers.origin)){
      return json(response,403,{error:'Origem não autorizada.'});
    }
    const body=await readBody(request);
    const client=service();
    const tokenHash=cookieFor(request,response);
    const ip=trustedIp(request);
    if(body.action==='preflight'){
      const email=trimmed(body.email).toLowerCase();
      if(email.length>254)return json(response,400,{error:'E-mail inválido.'});
      const result=await rpc(client,'govrp_server_check_access',{p_email:email||null,p_ip:ip,p_device_hash:tokenHash,p_user_id:null});
      return result.allowed?json(response,200,{allowed:true}):reject(response,result.reason);
    }
    if(body.action==='attest'){
      const token=bearer(request);
      if(!token)return json(response,401,{error:'Sessão não informada.'});
      const {data,error}=await client.auth.getUser(token);
      if(error||!data?.user?.id)return json(response,401,{error:'Sessão inválida.'});
      const result=await rpc(client,'govrp_server_check_access',{
        p_email:null,p_ip:ip,p_device_hash:tokenHash,p_user_id:data.user.id,
      });
      if(!result.allowed)return reject(response,result.reason);
      await rpc(client,'govrp_server_record_device',{
        p_user_id:data.user.id,p_device_hash:tokenHash,p_ip:ip,
        p_agent:trimmed(request.headers['user-agent']).slice(0,280)
      });
      return json(response,200,{allowed:true});
    }
    return json(response,400,{error:'Operação inválida.'});
  }catch(error){
    console.error('[auth-access]',error?.message);
    return json(response,503,{error:'Verificação de acesso indisponível. Tente novamente em instantes.'});
  }
}

export async function adminBanHandler(request,response){
  if(request.method!=='POST')return json(response,405,{error:'Método inválido.'});
  try{
    const token=bearer(request);
    if(!token)return json(response,401,{error:'Sessão administrativa ausente.'});
    const client=service();
    const {data,error}=await client.auth.getUser(token);
    const actor=data?.user?.id;
    if(error||!actor)return json(response,401,{error:'Sessão administrativa inválida.'});
    if(!await isPlatformAdmin(client,actor))return json(response,403,{error:'Somente administradores podem aplicar banimentos.'});
    await assertRealWorldAction(client,actor);
    const body=await readBody(request);
    const userId=trimmed(body.userId);
    if(!/^[a-f0-9-]{36}$/i.test(userId))return json(response,400,{error:'Usuário inválido.'});
    if(actor===userId)return json(response,403,{error:'Você não pode banir sua própria conta.'});
    const {data:target,error:targetError}=await client.auth.admin.getUserById(userId);
    if(targetError||!target?.user)return json(response,404,{error:'Conta não encontrada.'});
    const authorized=createClient(getSecret('VITE_SUPABASE_URL'),
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()||getSecret('VITE_SUPABASE_ANON_KEY'),{
        global:{fetch:worldServerFetch,headers:{Authorization:'Bearer '+token}},
        auth:{persistSession:false,autoRefreshToken:false}
      });
    if(body.action==='ban'){
      const reason=trimmed(body.reason);
      if(reason.length<10||reason.length>1000)return json(response,400,{error:'Informe um motivo entre 10 e 1000 caracteres.'});
      const scope=body.scope&&typeof body.scope==='object'?body.scope:{};
      const id=await rpc(authorized,'govrp_admin_apply_ban',{p_user_id:userId,p_reason:reason,p_scope:scope});
      try{
        const {error:banError}=await client.auth.admin.updateUserById(userId,{ban_duration:'876000h'});
        if(banError)throw banError;
      }catch(authError){
        try{await rpc(authorized,'govrp_admin_revoke_ban',{p_ban_id:id});}
        catch(rollbackError){console.error('[admin-ban:revoke-rollback]',rollbackError?.message);}
        throw authError;
      }
      return json(response,200,{success:true,banId:id});
    }
    if(body.action==='unban'){
      const context=await rpc(authorized,'govrp_admin_ban_context',{p_user_id:userId});
      const id=context?.current_ban?.id;
      if(!id)return json(response,400,{error:'Nenhum banimento ativo.'});
      const {error:unbanError}=await client.auth.admin.updateUserById(userId,{ban_duration:'none'});
      if(unbanError)throw unbanError;
      try{await rpc(authorized,'govrp_admin_revoke_ban',{p_ban_id:id});}
      catch(revokeError){
        await client.auth.admin.updateUserById(userId,{ban_duration:'876000h'}).catch(()=>{});
        throw revokeError;
      }
      return json(response,200,{success:true});
    }
    return json(response,400,{error:'Ação desconhecida.'});
  }catch(error){
    console.error('[admin-ban]',error?.message);
    return json(response,403,{error:error?.message||'Falha no banimento.'});
  }
}
