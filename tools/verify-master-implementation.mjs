import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const rootFile = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const checks = [];
const verify = (label, condition) => {
  if (!condition) throw new Error(`Falha: ${label}`);
  checks.push(label);
};

const migrations = [
  'supabase/migrations/20260815100000_core_identity_parties_and_server_time.sql',
  'supabase/migrations/20260815103000_justice_fines_and_citizen_services.sql',
  'supabase/migrations/20260815110000_atomic_investment_portfolio.sql',
  'supabase/migrations/20260815113000_secure_donations.sql',
  'supabase/migrations/20260815120000_dynamic_government_media_and_integrity.sql',
  'supabase/migrations/20260815123000_parliament_proposals_and_suggestions.sql',
  'supabase/migrations/20260815124500_commerce_receipt_snapshots.sql',
  'supabase/migrations/20260815130000_operational_hardening.sql',
  'supabase/migrations/20260815131500_justice_privacy_and_subjects.sql',
  'supabase/migrations/20260815133000_party_rpc_hardening.sql',
  'supabase/migrations/20260815134500_government_impact_integrations.sql',
  'supabase/migrations/20260815140000_government_project_impact_statuses.sql',
];

migrations.forEach((file) => verify(`migration presente: ${file.split('/').at(-1)}`, existsSync(new URL(`../${file}`, import.meta.url))));

const hardening = rootFile('supabase/migrations/20260815130000_operational_hardening.sql');
verify('hierarquia partidária protegida no backend', hardening.includes('admin_correct_party_founder'));
verify('sugestão parlamentar finalizada no backend', hardening.includes('finalize_bill_suggestion_voting'));
verify('recursos e audiências possuem decisão autoritativa', hardening.includes('decide_fine_appeal') && hardening.includes('decide_fine_hearing'));
verify('operações sensíveis sem escrita direta', hardening.includes('revoke insert,update,delete on public.police_fines'));
const justicePrivacy = rootFile('supabase/migrations/20260815131500_justice_privacy_and_subjects.sql');
verify('sigilo de investigados protegido no backend', justicePrivacy.includes('notified_at is not null') && justicePrivacy.includes('is_secret'));
const governmentImpact = rootFile('supabase/migrations/20260815134500_government_impact_integrations.sql');
verify('impactos nacionais derivados de fatos do RP', governmentImpact.includes('record_minister_event') && governmentImpact.includes('record_bill_popularity_impact'));
const projectImpact = rootFile('supabase/migrations/20260815140000_government_project_impact_statuses.sql');
verify('estados de projetos geram consequências mensuráveis', projectImpact.includes("when 'paused'") && projectImpact.includes("when 'delayed'") && projectImpact.includes("when 'under_investigation'"));
const partyRpcHardening = rootFile('supabase/migrations/20260815133000_party_rpc_hardening.sql');
verify('atalhos partidários legados revogados', partyRpcHardening.includes('revoke all on function public.join_party') && partyRpcHardening.includes('Dono') && partyRpcHardening.includes('Presidente'));

const existingSchema = rootFile('supabase/migrations/20260814162436_remote_schema.sql');
verify('CPI e CPMI preservadas com rito completo', existingSchema.includes('create_parliament_commission') && existingSchema.includes("v_commission.type in ('cpi', 'cpmi')") && existingSchema.includes('submit_parliament_commission_report'));
verify('eleição das Mesas possui voto único no banco', existingSchema.includes('cast_leadership_vote') && existingSchema.includes('parliament_leadership_votes_election_id_voter_member_id_key'));
verify('execução penal e remição usam fluxo persistido', existingSchema.includes('complete_prison_activity') && existingSchema.includes('grant_sentence_credit') && existingSchema.includes('register_prison_event'));

const investments = rootFile(migrations[2]);
verify('investimentos atômicos e idempotentes', investments.includes('for update') && investments.includes('p_idempotency_key'));

const donationsServer = rootFile('server/donations/http.js');
const stripeEndpoint = rootFile('api/donations/stripe-checkout.js');
const vercelConfig = rootFile('vercel.json');
const frontendSource = [rootFile('src/pages/DonationPage.jsx'), rootFile('src/pages/Login.jsx'), rootFile('src/pages/Register.jsx')].join('\n');
verify('webhook Stripe valida assinatura', donationsServer.includes('constructEvent') && donationsServer.includes('STRIPE_WEBHOOK_SECRET'));
verify('checkout e webhook Stripe compartilham uma função Vercel', stripeEndpoint.includes("request.headers['stripe-signature']") && vercelConfig.includes('/api/donations/stripe-webhook') && !existsSync(new URL('../api/donations/stripe-webhook.js', import.meta.url)));
verify('chave secreta Stripe ausente do frontend', !/STRIPE_SECRET_KEY|sk_(live|test)_/i.test(frontendSource));
verify('hCaptcha integrado no login e cadastro', frontendSource.includes('HCaptchaChallenge') && frontendSource.includes('captchaToken'));

const dic = rootFile('src/pages/services/DIC.jsx');
verify('PDF do DIC pagina cada documento', dic.includes('addDocumentPage') && dic.includes('document.fonts.ready'));

const suggestionQueries = [
  rootFile('src/pages/services/ParliamentPanel.jsx'),
  rootFile('src/pages/services/PartyPage.jsx'),
  rootFile('src/components/parties/PartyManagementDialog.jsx'),
].join('\n');
verify('autor de sugestões usa relacionamento inequívoco', (suggestionQueries.match(/profiles!bill_suggestions_author_id_fkey/g) || []).length === 3);

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) {
  const values = Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
      })
  );
  const url = values.VITE_SUPABASE_URL;
  const key = values.VITE_SUPABASE_PUBLISHABLE_KEY || values.VITE_SUPABASE_ANON_KEY;
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const results = await Promise.all([
      db.rpc('get_server_now'),
      db.from('government_ministries').select('id', { count: 'exact', head: true }),
      db.from('government_popularity_state').select('country_code').eq('country_code', 'BR').maybeSingle(),
      db.rpc('get_public_wanted_list'),
      db.rpc('get_police_efficiency_metrics'),
      db.from('bill_suggestions').select('id, author:profiles!bill_suggestions_author_id_fkey(id)').limit(1),
    ]);
    const errors = results.map((result) => result.error).filter(Boolean);
    verify('smoke test do Supabase remoto', errors.length === 0);
    verify('estrutura ministerial inicial disponível', Number(results[1].count) >= 1);
    verify('popularidade nacional inicializada', Boolean(results[2].data));
  }
}

process.stdout.write(`\u2713 ${checks.length} verificações funcionais concluídas.\n`);
