import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isRevokedSessionError,clearLocalSessionAndOpenLogin} from '../src/lib/sessionRecovery.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const auth=read('src/contexts/AuthContext.jsx');
const access=read('src/lib/moderationAccess.js');
const host='https://nojlfilayycebrtyybzf.supabase.co';
const key='sb-nojlfilayycebrtyybzf-auth-token';

assert.equal(isRevokedSessionError({code:'GOVRP_SESSION_REVOKED'}),true);
assert.equal(isRevokedSessionError(new Error('Sessão inválida.')),true);
assert.equal(isRevokedSessionError(new Error('Invalid Refresh Token: Refresh Token Not Found')),true);
assert.equal(isRevokedSessionError(new Error('Session not found')),true);
assert.equal(isRevokedSessionError({code:'GOVRP_MODERATION_BAN',message:'Acesso bloqueado pela moderação'}),false);
assert.equal(isRevokedSessionError(new Error('Falha de conexão')),false);

const makeEnvironment=()=>{
 const store=new Map([[key,'revoked'],['other-preferences','keep']]);
 let destination;
 return {store, get destination(){return destination;},
  setTimeout,clearTimeout,
  localStorage:{removeItem:k=>store.delete(k)},
  location:{replace:next=>{destination=next;}}
 };
};

const env=makeEnvironment();
const scopes=[];
await clearLocalSessionAndOpenLogin({auth:{signOut:async args=>{scopes.push(args.scope);return {error:null};}}},host,env);
assert.deepEqual(scopes,['local'],'Sign-out must not revoke any other device.');
assert.equal(env.store.has(key),false,'Only this Supabase session should be cleared.');
assert.equal(env.store.get('other-preferences'),'keep','Unrelated storage must survive.');
assert.equal(env.destination,'/login?session=expired','The login page must open after local recovery.');

const failing=makeEnvironment();
await clearLocalSessionAndOpenLogin({auth:{signOut:async () => {throw new Error('Session not found');}}},host,failing);
assert.equal(failing.store.has(key),false,'Invalid remote session must not prevent local cleanup.');
assert.equal(failing.destination,'/login?session=expired','Backend 403 must not trap the browser on an error screen.');

assert.ok(auth.includes("supabase.auth.signOut({ scope: 'local' })"),'Normal logout must not invalidate other devices.');
assert.ok(auth.includes('isRevokedSessionError(error)')&&auth.includes('void returnToLogin()'),'Revoked session must exit stale authentication wall.');
assert.ok(auth.includes('Entrar novamente'),'Other auth failures still need a manual login escape.');
assert.ok(access.includes("response.status === 401")&&access.includes("invalid.code = 'GOVRP_SESSION_REVOKED'"),
 '401 invalid sessions must be distinguished from moderation bans.');
assert.ok(access.includes("data.code==='GOVRP_MODERATION_BAN'"),'Moderation bans must remain enforced.');
console.log('✓ Session recovery keeps other devices alive, handles revoked JWTs and returns to login.');
