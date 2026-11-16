import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('src/lib/executiveGovernance.js');
const president = read('src/pages/dashboards/panels/PresidentDashboard.jsx');
const migration = read('supabase/migrations/20261116133000_atomic_presidential_bill_review.sql');
const constitutionalRite = read('supabase/migrations/20261116162000_pec_constitutional_rite.sql');
const explicitDecision = read('supabase/migrations/20261116220000_presidential_veto_confirmation_and_reset.sql');

const review = source.slice(source.indexOf('export const reviewPresidentialBill = async'));
assert.ok(review.includes("supabase.rpc('review_presidential_bill'"), 'Presidential review must use the atomic server RPC');
assert.ok(!review.includes("rpc('update_bill_status'"), 'Client must not change bill status before registering the act');
assert.ok(!review.includes('saveExecutiveGovernanceSettings('), 'Client must not overwrite protected appointments');
assert.ok(!review.includes('publishOfficialGazetteEntry('), 'Official publication must not be a separate client write');
assert.ok(review.includes('p_reason: reason.trim()') && review.includes('p_partial_scope: partialScope.trim()'),
  'The entire veto explanation must be included in the server transaction');

assert.ok(!source.includes(".in('status', [...PRESIDENTIAL_PENDING_BILL_STATUSES, 'Vetado integralmente'"), 'Vetoed bills must not be offered for silent recovery');
assert.ok(president.includes('confirmedDecision'), 'Presidential action requires explicit confirmation');
assert.ok(president.includes('disabled={isSaving || !confirmedDecision}'), 'Action button remains disabled until confirmation');
assert.ok(explicitDecision.includes('CREATE TRIGGER require_explicit_presidential_bill_decision'), 'Direct status changes are guarded');
assert.ok(explicitDecision.includes("PERFORM set_config('govrp.presidential_bill_decision'"), 'Authorized decisions use a transaction-local guard');
assert.ok(explicitDecision.includes('IF v_count<>2'), 'Both incomplete vetoes must be reopened');
assert.ok(migration.includes('PERFORM public.update_bill_status'),
  'The server must reuse existing legal review/permission validation');
assert.ok(migration.includes("WHERE h.bill_id=p_bill_id AND h.status=v_result_status"),
  'Recovery must verify the original status-change audit');
assert.ok(migration.includes('AND h.actor_id=v_actor'),
  'Only the original issuing president can finish an incomplete veto');
assert.ok(migration.includes("'{billActions}'"),
  'The server must append the action without overwriting other government settings');
assert.ok(migration.includes("coalesce(v_settings,'{}'::jsonb)"),
  'The server must preserve protected appointments');
assert.ok(migration.includes('public.dou_entries'),
  'The server must publish vetoes in the Diário Oficial');
assert.ok(migration.includes('GRANT EXECUTE ON FUNCTION public.review_presidential_bill'),
  'The authenticated access grant must be explicit');

assert.ok(constitutionalRite.includes("'numerator',3,'denominator',5"), 'PEC quorum must follow Art. 66, 3/5 per house');
assert.ok(constitutionalRite.includes("THEN 'Promulgado'"), 'PEC approval in both houses promulgates without presidential act');
assert.ok(constitutionalRite.includes("PECs são deliberadas pelo Congresso"), 'Server must reject presidential PEC actions');
assert.ok(source.includes("if (isConstitutionalAmendment)"), 'Client must block all presidential actions on PECs');
assert.ok(!source.includes("'Aguardando promulgação presidencial',"), 'PECs must not be queued for the President');
assert.ok(!president.includes("isPromulgationOnly"), 'President dashboard must not show a PEC promulgation button');
console.log('✓ Explicit presidential decisions, constitutional PEC rules and veto reset verified.');
