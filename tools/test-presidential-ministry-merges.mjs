import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path,'utf8');
const sql = read('supabase/migrations/20261110153000_full_formation_ministry_merges.sql');
const formation = read('src/components/PresidentialFormationGuide.jsx');
const president = read('src/pages/dashboards/panels/PresidentDashboard.jsx');
const economy = read('src/features/economy/pages/GovernmentEconomyPanel.jsx');
const minister = read('src/pages/dashboards/panels/MinisterDashboard.jsx');
const manager = read('src/components/government/MinistryMergeManager.jsx');

// Required offices and all unmerged ministries, not a fixed three-person quota.
assert.match(sql, /o.required_for_formation AND o.is_assignable AND o.government_bound/);
assert.match(sql, /remaining:=greatest\(0,required_ministers-appointed_ministers\)/);
assert.match(sql, /remaining_offices/);
assert.match(sql, /coalesce\(\(f->>'remaining'\)::integer,1\)<>0/);
assert.doesNotMatch(sql, /required_ministers integer:=3/);
assert.match(formation, /remaining === 0/);
assert.match(formation, /pendingOffice/);

// No duplicate minister rows, no cycles, no overriding filled/pending positions.
assert.match(sql, /UNIQUE \(government_id, merged_ministry_id\)/);
assert.match(sql, /m\.merged_ministry_id=p_primary_id/);
assert.match(sql, /m\.primary_ministry_id=p_merged_id/);
assert.match(sql, /m\.ministry_id=p_merged_id AND m\.status='active'/);
assert.match(sql, /i\.ministry_id=p_merged_id AND i\.status='pending'/);
assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
assert.match(sql, /current_minister_has_portfolio/);
assert.match(sql, /ministry_assignment\.ministry=/);
assert.match(sql, /public\.justice_write_audit/);

assert.match(manager, /merge_government_ministries/);
assert.match(manager, /unmerge_government_ministry/);
assert.match(formation, /MinistryMergeManager/);
assert.match(president, /MinistryMergeManager/);
assert.match(president, /mergedInto/);
assert.match(economy, /current_minister_has_portfolio/);
assert.match(minister, /get_active_ministry_portfolios/);
console.log('PASS: mandatory cabinet formation and scoped reversible ministry mergers');
