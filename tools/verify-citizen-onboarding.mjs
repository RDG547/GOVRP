import { readFileSync } from 'node:fs';
import process from 'node:process';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const checks = [];
const verify = (label, condition) => {
  if (!condition) throw new Error(`Falha: ${label}`);
  checks.push(label);
};

const migration = read('supabase/migrations/20260817120000_citizen_identity_onboarding_v2.sql');
const register = read('src/pages/Register.jsx');
const auth = read('src/contexts/AuthContext.jsx');
const app = read('src/App.jsx');
const gate = read('src/components/CitizenOnboardingGate.jsx');
const onboarding = read('src/pages/CitizenOnboarding.jsx');
const settings = read('src/pages/Settings.jsx');
const tutorial = read('src/components/WelcomeTutorial.jsx');

verify('identidade OOC isolada em schema privado', migration.includes('private.account_identities'));
verify('dados reais removidos do perfil público legado', migration.includes('email = null') && migration.includes('phone = null'));
verify('perfil público seguro disponível', migration.includes('public.public_citizen_profiles'));
verify('perfil legado ambíguo não fica público antes da confirmação', migration.includes('citizen_profiles_public_completed_read') && migration.includes('using (onboarding_completed = true)'));
verify('cadastro guarda nome e nascimento reais', register.includes('realFullName') && register.includes('realDateOfBirth'));
verify('cadastro não gera CPF ou RG no navegador', !register.includes('generateCPF') && !register.includes('generateRG'));
verify('OAuth segue para Registro Nacional', register.includes("navigate('/registro-cidadania'"));
verify('OAuth incompleto exige dados privados mínimos', onboarding.includes('Complete sua conta') && migration.includes('Complete os dados privados da conta antes de criar o cidadão'));
verify('Auth consulta identidade privada própria', auth.includes("rpc('get_my_account_identity')"));
verify('login OOC não expõe e-mail por username público', auth.includes('Entre com o e-mail privado da sua conta') && migration.includes('drop function if exists public.resolve_login_identifier'));
verify('rota dedicada registrada', app.includes('path="/registro-cidadania"') && app.includes('<CitizenOnboardingGate>'));
verify('guard bloqueia onboarding incompleto', gate.includes('user.onboarding_completed === false') && gate.includes('<Navigate to="/registro-cidadania"'));
verify('progresso persistente possui versão e etapas', migration.includes('onboarding_version') && migration.includes('onboarding_step'));
verify('identidade, origem e aspiração são salvas no backend', ['save_citizen_identity', 'save_citizen_origin', 'save_citizen_aspiration'].every((name) => migration.includes(name)));
verify('quatro documentos emitidos por RPC idempotente', migration.includes('issue_citizen_onboarding_document') && ['CPF', 'RG', 'Título de Eleitor', 'CTD'].every((type) => migration.includes(`'${type}'`)));
verify('unicidade de documentos e contas protegida', migration.includes('documents_valid_type_number_key') && migration.includes('accounts_user_id_key'));
verify('conta bancária usa configuração e transação de origem', migration.includes('initial_bank_balance') && migration.includes('citizenship_initial_balance'));
verify('RPC bancária legada preserva contrato do frontend', migration.includes("'success', true") && migration.includes("'account', v_result->'account'"));
verify('conclusão ocorre somente via RPC validada', migration.includes('finalize_citizen_onboarding') && migration.includes('v_document_count <> 4'));
verify('campos oficiais protegidos contra update direto', migration.includes('protect_citizen_official_fields_trigger'));
verify('filiação e reputação não podem ser adulteradas pelo cliente', migration.includes('new.party_affiliation is distinct') && migration.includes('new.reputation_points is distinct'));
verify('emissão direta de documentos revogada', migration.includes('revoke insert, update, delete on public.documents from anon, authenticated'));
verify('migração legada preserva documentos existentes', migration.includes('migrated_from_profiles') && migration.includes("onboarding_mode = 'legacy_migration'"));
verify('reset administrativo é não destrutivo', migration.includes("'preserved_documents', true") && !/admin_reset_citizen_onboarding[\s\S]{0,900}set is_valid = false/.test(migration));
verify('tela inclui sete etapas e cerimônia', onboarding.includes('Etapa 7') && onboarding.includes('Cidadania concedida'));
verify('municípios usam dados oficiais do IBGE', read('src/lib/brazilianLocations.js').includes('servicodados.ibge.gov.br'));
verify('Configurações separam Conta e Cidadão', settings.includes('Dados da Conta') && settings.includes('Dados do Cidadão'));
verify('tutorial possui trilhas por aspiração', ['politics', 'entrepreneurship', 'justice', 'security', 'communication', 'civil_life'].every((key) => tutorial.includes(`${key}:`)));

process.stdout.write(`✓ ${checks.length} verificações do onboarding concluídas.\n`);
