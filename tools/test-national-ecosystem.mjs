import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const local = Object.fromEntries(execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^"|"$/g, '')];
  }));
if (!local.API_URL?.includes('127.0.0.1')) throw new Error('Este teste só pode executar no Supabase local.');

const service = createClient(local.API_URL, local.SECRET_KEY || local.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const checks = [];
const assert = (condition, label) => {
  if (!condition) throw new Error(`Falha: ${label}`);
  checks.push(label);
};

const createActor = async (label, role) => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `ecosystem-${label}-${suffix}@govrp.local`;
  const password = `Govrp!${crypto.randomUUID()}Aa1`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  const profile = await service.from('profiles').upsert({
    id,
    username: `${label}${suffix}`,
    full_name: `Teste ${label}`,
    role,
    onboarding_completed: true,
    onboarding_step: 'completed',
  }, { onConflict: 'id' });
  if (profile.error) throw profile.error;
  const client = createClient(local.API_URL, local.ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const session = await client.auth.signInWithPassword({ email, password });
  if (session.error) throw session.error;
  return { id, client };
};

const [admin, citizen] = await Promise.all([
  createActor('admin', 'Admin'),
  createActor('citizen', 'Cidadão'),
]);

const directPopulationWrite = await citizen.client.from('country_population_segments')
  .update({ welfare_index: 100 }).eq('country_code', 'BR').eq('segment_key', 'rural_workers');
assert(Boolean(directPopulationWrite.error), 'cidadão não altera segmentos populacionais diretamente');

const beforeSegment = await service.from('country_population_segments')
  .select('*').eq('country_code', 'BR').eq('segment_key', 'rural_workers').single();
const beforeTreasury = await service.from('government_finances').select('treasury_balance').eq('id', 1).single();
const beforePopularity = await service.from('government_popularity_state').select('score').eq('country_code', 'BR').single();
for (const result of [beforeSegment, beforeTreasury, beforePopularity]) if (result.error) throw result.error;

const event = await admin.client.rpc('create_national_game_event', {
  p_title: 'Seca regional de validação',
  p_description: 'Uma estiagem intensa reduziu a produção rural e exige resposta oficial dentro do prazo.',
  p_category: 'international',
  p_severity: 'important',
  p_deadline_rp_hours: 24,
  p_country_code: 'BR',
  p_options: [
    {
      label: 'Auxílio e subsídio rural',
      description: 'Liberar apoio emergencial e subsídio temporário aos produtores atingidos.',
      treasuryCost: 5000,
      authorizedRoles: ['Presidente', 'Admin'],
      effects: {
        segments: {
          '*': { socialTension: -1 },
          rural_workers: { welfare: 5, approval: 2, purchasingPower: 4 },
        },
        popularity: { player: 1, simulation: 2 },
      },
    },
    {
      label: 'Não agir',
      description: 'Aguardar a normalização climática sem utilizar recursos públicos.',
      isDefault: true,
      authorizedRoles: ['Presidente', 'Admin'],
      effects: {
        segments: {
          '*': { welfare: -1, socialTension: 2 },
          rural_workers: { welfare: -4, unemploymentPressure: 3 },
        },
        popularity: { player: -1, simulation: -2 },
      },
    },
  ],
});
if (event.error) throw event.error;
assert(Boolean(event.data?.id), 'autoridade cria evento nacional com prazo e escolhas');

const options = await service.from('national_event_decision_options')
  .select('*').eq('event_id', event.data.id).order('sort_order');
if (options.error) throw options.error;
const aidOption = options.data.find((option) => option.label === 'Auxílio e subsídio rural');
const defaultOption = options.data.find((option) => option.is_default);
assert(options.data.length === 2 && aidOption && defaultOption, 'evento persiste opções e uma consequência padrão');

const unauthorized = await citizen.client.rpc('respond_national_game_event', {
  p_event_id: event.data.id,
  p_option_id: aidOption.id,
  p_reason: 'Tentativa de decidir sem exercer autoridade nacional competente.',
});
assert(Boolean(unauthorized.error), 'cidadão comum não decide acontecimento nacional');

const response = await admin.client.rpc('respond_national_game_event', {
  p_event_id: event.data.id,
  p_option_id: aidOption.id,
  p_reason: 'A medida protege a produção e reduz os danos sociais imediatos da estiagem.',
});
if (response.error) throw response.error;
assert(!response.data.was_automatic && Number(response.data.treasury_cost) === 5000, 'resposta oficial registra escolha e custo reais');

const [afterEvent, afterSegment, afterTreasury, afterPopularity, segmentEvents, domainEvent, mediaBrief, feed, eventAudit] = await Promise.all([
  service.from('national_game_events').select('status,resolved_at,effects').eq('id', event.data.id).single(),
  service.from('country_population_segments').select('*').eq('country_code', 'BR').eq('segment_key', 'rural_workers').single(),
  service.from('government_finances').select('treasury_balance').eq('id', 1).single(),
  service.from('government_popularity_state').select('score').eq('country_code', 'BR').single(),
  service.from('population_segment_events').select('*').eq('national_event_id', event.data.id),
  service.from('domain_events').select('*').eq('idempotency_key', `national-event-response:${event.data.id}`).single(),
  service.from('national_media_briefs').select('*').eq('domain_event_id', response.data.consequence_event_id).single(),
  citizen.client.rpc('get_national_feed', { p_limit: 50, p_offset: 0 }),
  service.from('security_audit_log').select('action,actor_id').eq('target_table', 'national_game_events').eq('target_id', event.data.id),
]);
for (const result of [afterEvent,afterSegment,afterTreasury,afterPopularity,segmentEvents,domainEvent,mediaBrief,feed,eventAudit]) if (result.error) throw result.error;
assert(afterEvent.data.status === 'resolved' && afterEvent.data.resolved_at, 'evento é encerrado sem edição manual de status');
assert(Number(afterSegment.data.welfare_index) === Number(beforeSegment.data.welfare_index) + 5
  && Number(afterSegment.data.purchasing_power) === Number(beforeSegment.data.purchasing_power) + 4,
'segmento rural reage de modo específico à decisão');
assert(Number(afterTreasury.data.treasury_balance) === Number(beforeTreasury.data.treasury_balance) - 5000, 'Tesouro paga exatamente o custo da resposta');
assert(Number(afterPopularity.data.score) > Number(beforePopularity.data.score), 'popularidade reage à decisão e aos pesos atuais');
assert(segmentEvents.data.length >= 1 && segmentEvents.data.every((item) => item.reason), 'mudanças populacionais preservam motivo e estado anterior');
assert(domainEvent.data.event_type === 'national_crisis_resolved' && mediaBrief.data.status === 'published', 'consequência gera evento central e pauta pública');
assert(feed.data.some((item) => item.id === `brief:${mediaBrief.data.id}`), 'feed nacional publica a repercussão automaticamente');
assert(eventAudit.data.some((item) => item.action === 'national_event_created' && item.actor_id === admin.id)
  && eventAudit.data.some((item) => item.action === 'national_event_changed'),
'criação e resolução do evento nacional permanecem auditadas');

const responseRetry = await admin.client.rpc('respond_national_game_event', {
  p_event_id: event.data.id,
  p_option_id: aidOption.id,
  p_reason: 'Nova tentativa não deve executar os efeitos uma segunda vez.',
});
if (responseRetry.error) throw responseRetry.error;
const treasuryAfterRetry = await service.from('government_finances').select('treasury_balance').eq('id', 1).single();
assert(responseRetry.data.id === response.data.id
  && Number(treasuryAfterRetry.data.treasury_balance) === Number(afterTreasury.data.treasury_balance),
'repetição da resposta é idempotente e não duplica gastos');

const expiredEvent = await admin.client.rpc('create_national_game_event', {
  p_title: 'Pressão social de validação',
  p_description: 'Um acontecimento social temporário testa a aplicação automática da consequência padrão.',
  p_category: 'society',
  p_severity: 'attention',
  p_deadline_rp_hours: 1,
  p_country_code: 'BR',
  p_options: [
    { label: 'Dialogar', description: 'Abrir diálogo público com os grupos envolvidos.', effects: { segments: { '*': { socialTension: -1 } } } },
    { label: 'Não responder', description: 'Encerrar o prazo sem apresentar resposta oficial.', isDefault: true, effects: { segments: { '*': { socialTension: 1 } } } },
  ],
});
if (expiredEvent.error) throw expiredEvent.error;
const forceExpiry = await service.from('national_game_events').update({ ends_at: new Date(Date.now() - 1000).toISOString() }).eq('id', expiredEvent.data.id);
if (forceExpiry.error) throw forceExpiry.error;
const resolvedExpired = await service.rpc('resolve_expired_national_game_events');
if (resolvedExpired.error) throw resolvedExpired.error;
const automaticResponse = await service.from('national_event_responses').select('was_automatic,option_id').eq('event_id', expiredEvent.data.id).single();
if (automaticResponse.error) throw automaticResponse.error;
assert(Number(resolvedExpired.data) >= 1 && automaticResponse.data.was_automatic, 'prazo vencido aplica automaticamente a opção padrão');

const firstCurrencyCycle = await service.rpc('run_currency_market_cycle', { p_cycle_key: `test-a-${crypto.randomUUID()}` });
if (firstCurrencyCycle.error) throw firstCurrencyCycle.error;
const secondCycleKey = `test-b-${crypto.randomUUID()}`;
const ratesBeforeSecond = await service.from('country_rp_exchange_rates').select('currency_code,brl_per_unit').eq('country_code', 'BR');
const secondCurrencyCycle = await service.rpc('run_currency_market_cycle', { p_cycle_key: secondCycleKey });
if (secondCurrencyCycle.error) throw secondCurrencyCycle.error;
const ratesAfterSecond = await service.from('country_rp_exchange_rates').select('currency_code,brl_per_unit').eq('country_code', 'BR');
const beforeMap = Object.fromEntries(ratesBeforeSecond.data.map((item) => [item.currency_code, Number(item.brl_per_unit)]));
const afterMap = Object.fromEntries(ratesAfterSecond.data.map((item) => [item.currency_code, Number(item.brl_per_unit)]));
const usdChange = afterMap.USD / beforeMap.USD;
const eurChange = afterMap.EUR / beforeMap.EUR;
assert(Math.abs(usdChange - eurChange) > 0.000001, 'USD e EUR conseguem variar de forma independente');
const repeatCurrencyCycle = await service.rpc('run_currency_market_cycle', { p_cycle_key: secondCycleKey });
assert(!repeatCurrencyCycle.error && JSON.stringify(repeatCurrencyCycle.data) === JSON.stringify(secondCurrencyCycle.data), 'ciclo cambial repetido preserva o mesmo resultado');

const activityMix = await service.rpc('recalculate_country_activity_mix');
if (activityMix.error) throw activityMix.error;
const countryMix = await service.from('country_rp_states').select('player_share,simulated_share').eq('country_code', 'BR').single();
assert(Number(activityMix.data.player_share) !== 0.5
  && Math.abs(Number(countryMix.data.player_share) + Number(countryMix.data.simulated_share) - 1) < 0.000001,
'peso de jogadores e simulação é dinâmico, suave e soma 100%');

const simulationSetting = await service.from('system_settings').select('value').eq('key', 'election_simulation').single();
assert(simulationSetting.data.value.enabled === false, 'componente populacional eleitoral permanece desativado por padrão');

process.stdout.write(`✓ ${checks.length} testes reais de população, eventos, imprensa e câmbio concluídos.\n`);
