// Ban checks use a same-origin Vercel API and a server-issued HttpOnly browser token.
// This is not a physical device fingerprint; clearing cookies can rotate the identifier.
const ACCESS_URL='/api/world-runtime';
const requestAccess=async(payload,token=null)=>{
  let response;
  try {
    response=await fetch(ACCESS_URL,{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
      body:JSON.stringify(payload)
    });
  }catch{
    throw new Error('Não foi possível verificar a segurança da conta. Tente novamente.');
  }
  const data=await response.json().catch(()=>({}));
  if(response.status===403 && data.code==='GOVRP_MODERATION_BAN'){
    const error=new Error(data.reason||'Acesso bloqueado pela moderação do GOVRP.');
    error.code='GOVRP_MODERATION_BAN';
    throw error;
  }
  // A revoked Supabase session must be distinguished from a moderation ban,
  // a temporary network failure or a genuinely unavailable service.
  if (response.status === 401) {
    const invalid = new Error('Sua sessão anterior foi encerrada. Entre novamente para continuar.');
    invalid.code = 'GOVRP_SESSION_REVOKED';
    throw invalid;
  }
  if(!response.ok||data.allowed!==true){
    throw new Error(data.error||'Verificação de acesso indisponível. Tente novamente.');
  }
  return true;
};
export const checkRegistrationAccess=email=>requestAccess({action:'preflight',email});
export const verifySignedInAccess=accessToken=>requestAccess({action:'attest'},accessToken);
