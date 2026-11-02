import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/lib/apiAuth.js'], bundle: true, format: 'esm', write: false,
  plugins: [{ name: 'isolated-auth-client', setup(builder) {
    builder.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'client', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const supabase = {}; export const supabaseUrl="http://127.0.0.1"; export const supabasePublishableKey="test";', loader: 'js' }));
  } }],
});
const { fetchWithSessionAuth, readySession } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const token = (value, expires = 3600) => ({ access_token: value, expires_at: Date.now() / 1000 + expires });
const client = (initial = token('initial')) => {
  let current = initial, count = 0;
  return { get count() { return count; }, auth: {
    getSession: async () => ({ data: { session: current } }),
    refreshSession: async () => { count++; await new Promise(resolve => setTimeout(resolve, 5)); current = token('renewed'); return { data: { session: current } }; },
  } };
};

const expiring = client(token('old', 1));
assert.equal((await readySession(expiring)).access_token, 'renewed');
assert.equal(expiring.count, 1);

const concurrent = client();
const attempts = [];
await Promise.all([1, 2].map(() => fetchWithSessionAuth('/api/admin/update-user', {
  method: 'POST', body: JSON.stringify({ role: 'Cidadão' }), headers: new Headers({ 'X-Test': 'kept' }),
}, concurrent, async (_url, options) => {
  assert.equal(options.headers.get('X-Test'), 'kept');
  assert.equal(options.headers.get('x-govrp-world-generation'), null, 'A autenticação não exige geração para requests comuns.');
  assert.equal(options.headers.get('Content-Type'), 'application/json');
  const authorization = options.headers.get('Authorization');
  attempts.push(authorization);
  return new Response(null, { status: authorization === 'Bearer initial' ? 401 : 200 });
})));
assert.equal(concurrent.count, 1);
assert.equal(attempts.filter(value => value === 'Bearer renewed').length, 2);

for (const status of [403, 409, 500, 503]) {
  const session = client(); let requests = 0;
  const response = await fetchWithSessionAuth('/api/admin/update-user', {}, session, async () => { requests++; return new Response(null, { status }); });
  assert.equal(response.status, status);
  assert.equal(requests, 1);
  assert.equal(session.count, 0);
}
const rejected = client(); let requests = 0;
await fetchWithSessionAuth('/api/admin/update-user', {}, rejected, async () => { requests++; return new Response(null, { status: 401 }); });
assert.equal(requests, 2);
assert.equal(rejected.count, 1);

const empty = { auth: { getSession: async () => ({ data: { session: null } }) } };
await assert.rejects(() => fetchWithSessionAuth('/api/admin/update-user', {}, empty, () => assert.fail('Sessão incompleta enviou uma ação')), /Sua sessão expirou/);
console.log('OK autenticação compartilhada: renovação antecipada/concorrente, retry único de 401, sessão ausente bloqueada e nenhuma repetição de mutações em 403/409/500/503.');
