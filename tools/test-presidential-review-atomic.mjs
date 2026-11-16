import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('src/lib/executiveGovernance.js');
const president = read('src/pages/dashboards/panels/PresidentDashboard.jsx');
const migration = read('supabase/migrations/20261116133000_atomic_presidential_bill_review.sql');

const review = source.slice(source.indexOf('export const reviewPresidentialBill = async'));
assert.ok(review.includes("supabase.rpc('review_presidential_bill'"), 'Presidential review must use the atomic server RPC');
assert.ok(!review.includes("rpc('update_bill_status'"), 'Client must not change bill status before registering the act');
assert.ok(!review.includes('saveExecutiveGovernanceSettings('), 'Client must not overwrite protected appointments');
assert.ok(!review.includes('publishOfficialGazetteEntry('), 'Official publication must not be a separate client write');
assert.ok(review.includes('p_reason: reason.trim()') && review.includes('p_partial_scope: partialScope.trim()'),
  'The entire veto explanation must be included in the server transaction');

assert.ok(source.includes("'Vetado integralmente', 'Vetado parcialmente'"),
  'Legacy incomplete vetoes must be available for recovery');
assert.ok(source.includes("entry.resulting_status === bill.status"),
  'Already completed vetoes must not appear as unfinished');
assert.ok(president.includes('Concluir registro do veto'),
  'President must be able to complete an interrupted veto');
assert.ok(president.includes('A decisão já consta no histórico'),
  'Recovery UI must explain that no second veto is being issued');
assert.ok(president.includes('reviewState.recovering'),
  'Recovery must use a dedicated confirmation flow');

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

console.log('✓ Presidential sanction/veto is atomic, constrained and recoverable.');
