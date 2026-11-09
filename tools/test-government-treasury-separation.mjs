import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync('src/components/admin/SystemSettings.jsx','utf8');
const president = readFileSync('src/pages/dashboards/panels/PresidentDashboard.jsx','utf8');
const migration = readFileSync('supabase/migrations/20261109081500_separate_fiscal_debt_from_government_loans.sql','utf8');

assert.match(ui,/reason\.trim\(\)/);
assert.match(ui,/justification\.length < 20/);
assert.match(ui,/p_reason: justification/);
assert.match(ui,/Justificativa muito curta/);
assert.match(ui,/A operação é auditada|Toda alteração é auditada/);
assert.match(ui,/flex flex-col gap-2 sm:flex-row sm:flex-wrap/);
assert.match(ui,/Dívida pública \(economia RP\)/);
assert.match(ui,/Empréstimos bancários contratados/);
assert.match(ui,/select\('public_debt'\)/);
assert.match(president,/Margem para empréstimo bancário/);
assert.match(president,/estimatedTotalDebt > availableLoanAmount/);
assert.match(migration,/Quarter-close update did not match exactly once/);
assert.match(migration,/government_loan_balance_reclassified/);
assert.match(migration,/fiscal_debt_preserved/);
assert.match(migration,/abs\(previous_balance-macro_debt\)>=0\.01/);
assert.match(migration,/get_authority_role\(v_actor\)/);
assert.match(migration,/government_loan_contracted/);
assert.match(migration,/v_total>v_available/);
assert.match(migration,/REVOKE ALL ON FUNCTION public\.government_take_loan\(numeric,integer\) FROM PUBLIC,anon/);
assert.doesNotMatch(migration,/UPDATE public\.economic_state\s+SET\s+public_debt\s*=/i);
assert.doesNotMatch(migration,/UPDATE public\.government_finances\s+SET\s+treasury_balance\s*=\s*0/i);
console.log('PASS: treasury reasons and mobile actions; fiscal/debt split; government loans authorized/audited');
