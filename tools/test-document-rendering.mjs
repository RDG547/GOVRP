import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'tools', `.document-render-${process.pid}.cjs`);
try {
  await build({
    stdin: {
      contents: `import React from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { OfficialDocument } from './src/components/dic/OfficialDocument.jsx';
        import { documentCatalog, documentHasTwoSides } from './src/lib/documentCatalog.js';
        export { documentCatalog, documentHasTwoSides };
        export const render = (doc, side) => renderToStaticMarkup(React.createElement(OfficialDocument, {
          doc, side, user: { id: 'citizen-id', full_name: 'Cidadão de Teste', cpf: '12345678901', rg: '123456789', date_of_birth: '1990-01-01', username: 'citizen', avatar_url: '/icon-512x512.png' },
        }));`,
      resolveDir: root, loader: 'jsx',
    },
    outfile: output, bundle: true, platform: 'node', format: 'cjs',
    external: ['react', 'react-dom/server'], alias: { '@': path.join(root, 'src') }, logLevel: 'silent',
  });
  const { render, documentCatalog, documentHasTwoSides } = createRequire(import.meta.url)(output);
  let checks = 0;
  for (const type of Object.keys(documentCatalog)) {
    const doc = { id: 'document-id', type, document_number: type === 'CNPJ' ? '12345678000199' : 'AAC-TEST-123', issued_at: '2026-09-07', expires_at: '2026-12-07', metadata: { result: 'nothing_found' } };
    const front = render(doc, 'front');
    assert(front.includes('data-official-document'), `${type}: modelo não renderizado`);
    if (documentHasTwoSides(type)) assert(render(doc, 'back').includes('data-official-document'), `${type}: verso não renderizado`);
    console.log(`✓ ${type}: modelo renderizado para cada lado exportável`); checks++;
  }
  const positive = render({ id: 'clearance', type: 'Atestado de Antecedentes', document_number: 'AAC-123', issued_at: '2026-09-07', metadata: { result: 'positive' } }, 'front');
  assert(positive.includes('Constam registros criminais ativos'));
  assert(!positive.includes('Não constam antecedentes'));
  assert(!documentHasTwoSides('Atestado de Antecedentes'));
  console.log('✓ atestado positivo preserva seu resultado e exporta somente uma face'); checks++;
  console.log(`\n${checks} verificações de renderização de documentos aprovadas (sem inspeção visual).`);
} finally { rmSync(output, { force: true }); }
