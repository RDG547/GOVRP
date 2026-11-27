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
assert.doesNotMatch(page, /Encontros com o desenvolvedor|caso sejam implementados|Estatísticas pessoais e histórico ampliado/);
assert.match(page, /'Experiência sem anúncios'/);
assert.match(page, /<PlansParticles \/>/);
const particles = read('src/components/PlansParticles.jsx');
for (const marker of ['pointermove','pointerdown','pointer-events-none','prefers-reduced-motion','visibilitychange','cancelAnimationFrame','disconnect()']) {
 assert.ok(particles.includes(marker), marker);
}
assert.match(page, /<title>Assinaturas \| GOV\.RP<\/title>/);
assert.match(page, /Escolha a assinatura ideal para você!/);
assert.doesNotMatch(page, /fair-play-title|Apoio sem vantagens competitivas|Planos de apoio/i);
assert.doesNotMatch(page, /onClick=|<form|supabase|stripe|fetch\(|axios|Fundador/i);
assert.match(read('src/App.jsx'), /<Route path="\/planos" element=\{<Plans \/>\} \/>/);
for (const path of ['src/components/layout/Navbar.jsx','src/components/layout/Footer.jsx','src/pages/SupportUs.jsx']) {
 assert.ok(read(path).includes('/planos'), path);
}
console.log('Plans preview: two disabled plans, public route and navigation verified.');
