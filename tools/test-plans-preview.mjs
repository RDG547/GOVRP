import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const page = read('src/pages/Plans.jsx');
assert.equal((page.match(/id: '(plus|patrono)'/g) || []).length, 2);
assert.match(page, /name: 'GOVRP\+'/);
assert.match(page, /name: 'GOVRP Patrono'/);
assert.match(page, /price: '9,90'/);
assert.match(page, /price: '19,90'/);
assert.match(page, /<Button type="button" disabled/);
assert.match(page, /<title>Assinaturas \| GOV\.RP<\/title>/);
assert.match(page, /Escolha a assinatura ideal para você!/);
assert.doesNotMatch(page, /fair-play-title|Apoio sem vantagens competitivas|Planos de apoio/i);
assert.doesNotMatch(page, /onClick=|<form|supabase|stripe|fetch\(|axios|Fundador/i);
assert.match(read('src/App.jsx'), /<Route path="\/planos" element=\{<Plans \/>\} \/>/);
for (const path of ['src/components/layout/Navbar.jsx','src/components/layout/Footer.jsx','src/pages/SupportUs.jsx']) {
 assert.ok(read(path).includes('/planos'), path);
}
console.log('Plans preview: two disabled plans, public route and navigation verified.');
