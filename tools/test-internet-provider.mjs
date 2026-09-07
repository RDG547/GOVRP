import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'tools', `.internet-provider-${process.pid}.cjs`);
try {
  await build({
    stdin: {
      contents: `import React from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { InternetSpeedProvider, useInternetSpeed } from './src/contexts/InternetSpeedContext.jsx';
        function LoginScreen() {
          const { currentService, userPlan, isLoading } = useInternetSpeed();
          return React.createElement('main', null, 'Entrar no GOVRP',
            React.createElement('output', null, JSON.stringify({ currentService, userPlan, isLoading })));
        }
        export const render = () => renderToStaticMarkup(
          React.createElement(InternetSpeedProvider, null, React.createElement(LoginScreen)));
      `,
      resolveDir: root, loader: 'jsx',
    },
    outfile: output, bundle: true, platform: 'node', format: 'cjs',
    external: ['react', 'react-dom/server'], alias: { '@': path.join(root, 'src') }, logLevel: 'silent',
    plugins: [{
      name: 'provider-test-boundaries',
      setup(builder) {
        const replacements = {
          './AuthContext': 'export const useAuth = () => ({ user: globalThis.__internetProviderTestUser });',
          'react-router-dom': "export const useLocation = () => ({ pathname: '/login' }); export const useNavigate = () => () => {};",
          '@/lib/supabaseClient': "export const supabase = { from() { throw new Error('Render must not query the database'); } };",
          '@/hooks/use-domain-realtime': 'export const useDomainRealtime = () => {};',
        };
        builder.onResolve({ filter: /^(\.\/AuthContext|react-router-dom|@\/lib\/supabaseClient|@\/hooks\/use-domain-realtime)$/ }, args => ({ path: args.path, namespace: 'test-boundary' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-boundary' }, args => ({ contents: replacements[args.path], loader: 'js' }));
      },
    }],
  });
  const { render } = createRequire(import.meta.url)(output);
  const cases = [
    ['sessão ainda não carregada', undefined],
    ['visitante sem sessão', null],
    ['perfil ainda sem identificação', {}],
    ['usuário autenticado enquanto o plano carrega', { id: 'citizen' }],
    ['saída da conta volta à tela de entrada', null],
  ];
  for (const [label, user] of cases) {
    globalThis.__internetProviderTestUser = user;
    const html = render();
    assert(html.includes('Entrar no GOVRP'), `${label}: conteúdo da página não renderizado`);
    assert(html.includes('&quot;currentService&quot;:null'), `${label}: serviço inicial deve ser nulo`);
    assert(html.includes('&quot;userPlan&quot;:&quot;Básico&quot;'), `${label}: plano padrão ausente`);
    assert(html.includes('&quot;isLoading&quot;:false'), `${label}: tela inicial não deve estar bloqueada`);
    console.log(`✓ ${label}`);
  }
  console.log(`\n${cases.length} cenários de renderização inicial do provedor aprovados.`);
} finally {
  delete globalThis.__internetProviderTestUser;
  rmSync(output, { force: true });
}
