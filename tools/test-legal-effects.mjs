import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const local = Object.fromEntries(execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^"|"$/g, '')]; }));
if (!local.API_URL?.includes('127.0.0.1')) throw new Error('Este teste só pode executar no Supabase local.');

const service = createClient(local.API_URL, local.SECRET_KEY || local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const checks = [];
const assert = (condition, label) => { if (!condition) throw new Error(`Falha: ${label}`); checks.push(label); };
const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
const email = `law-${suffix}@govrp.local`;
const password = `Govrp!${crypto.randomUUID()}Aa1`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) throw created.error;
const authorId = created.data.user.id;
const profile = await service.from('profiles').upsert({
  id: authorId, username: `law${suffix}`, full_name: 'Legislador funcional', role: 'Deputado',
  onboarding_completed: true, onboarding_step: 'completed',
}, { onConflict: 'id' });
if (profile.error) throw profile.error;
const citizen = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
const session = await citizen.auth.signInWithPassword({ email, password });
if (session.error) throw session.error;

const house = await service.from('parliament_houses').insert({
  name: `Casa de validação ${suffix}`, description: 'Casa temporária para testar efeitos legais.',
}).select('id').single();
if (house.error) throw house.error;
const bill = await service.from('bills').insert({
  title: `Lei de responsabilidade econômica ${suffix}`,
  summary: 'Norma funcional que altera uma regra sistêmica mensurável.',
  full_text: 'A alíquota corporativa passa a obedecer ao efeito configurado e publicado junto da norma.',
  author_id: authorId, house_id: house.data.id, status: 'Em discussão',
}).select('id').single();
if (bill.error) throw bill.error;

const configured = await citizen.rpc('configure_law_effect', {
  p_source_kind: 'bill', p_source_id: bill.data.id, p_effect_key: 'corporate_tax_rate',
  p_operation: 'set', p_effect_value: 0.17,
  p_explanation: 'A norma define de forma expressa a nova alíquota corporativa aplicável às empresas.',
});
if (configured.error) throw configured.error;
assert(configured.data?.status === 'draft', 'autor configura efeito antes da entrada em vigor');

const enacted = await service.from('bills').update({ status: 'Sancionado' }).eq('id', bill.data.id);
if (enacted.error) throw enacted.error;
const [rule, effect, events] = await Promise.all([
  service.from('government_rules').select('numeric_value,version,source_id').eq('rule_key', 'corporate_tax_rate').single(),
  service.from('law_effects').select('status,activated_at').eq('id', configured.data.id).single(),
  service.from('domain_events').select('*').eq('source_id', bill.data.id).order('created_at'),
]);
if (rule.error || effect.error || events.error) throw rule.error || effect.error || events.error;
assert(Number(rule.data.numeric_value) === 0.17 && rule.data.source_id === bill.data.id, 'lei sancionada altera a regra oficial');
assert(effect.data.status === 'active' && Boolean(effect.data.activated_at), 'efeito entra em vigor uma única vez');
assert(events.data.some((event) => event.event_type === 'legal_effect_activated'), 'efeito publica evento de domínio rastreável');
assert(events.data.some((event) => event.event_type === 'law_enacted'), 'sanção publica evento legal consolidado');

await service.from('bills').update({ status: 'Promulgado' }).eq('id', bill.data.id);
const afterSecondStatus = await service.from('government_rules').select('numeric_value,version').eq('rule_key', 'corporate_tax_rate').single();
assert(Number(afterSecondStatus.data.numeric_value) === 0.17 && afterSecondStatus.data.version === rule.data.version, 'mudança posterior não reaplica o mesmo efeito');

const directRuleMutation = await citizen.from('government_rules').update({ numeric_value: 0.99 }).eq('rule_key', 'corporate_tax_rate').select('rule_key');
const preservedRule = await service.from('government_rules').select('numeric_value').eq('rule_key', 'corporate_tax_rate').single();
assert((directRuleMutation.error || directRuleMutation.data.length === 0) && Number(preservedRule.data.numeric_value) === 0.17, 'cliente não adultera regra governamental');

const immutableEvent = await service.from('domain_events').update({ event_type: 'tampered' }).eq('id', events.data[0].id);
assert(Boolean(immutableEvent.error), 'evento de domínio permanece imutável');

process.stdout.write(`✓ ${checks.length} testes reais de efeitos legais concluídos.\n`);
