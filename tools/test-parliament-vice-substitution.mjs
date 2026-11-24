import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

const rules = read('supabase/migrations/20261124113000_parliament_vice_four_day_absence_succession.sql');
const status = read('supabase/migrations/20261124114000_parliament_house_presidency_status_for_ui.sql');
const parliament = read('src/pages/services/ParliamentPanel.jsx');

// The absence is computed from REAL user activity and also fresh logins;
// never rely exclusively on a stale 'last_sign_in_at'.
assert.match(rules, /CREATE OR REPLACE FUNCTION private\.is_acting_house_president/);
assert.match(rules, /user_activity_sessions s/);
assert.match(rules, /last_sign_in_at/);
assert.match(rules, /interval '4 days'/);
assert.match(rules, /greatest\(/);

// Both houses, active seat, active mandate and correct VP role are mandatory.
assert.match(rules, /vice\.position='vice_president'/);
assert.match(rules, /vice\.house_id=p_house_id/);
assert.match(rules, /president\.house_id=p_house_id/);
assert.match(rules, /get_active_parliament_member_id\(p_user_id,p_house_id\)/);
assert.match(rules, /get_parliament_leadership_role_label\(p_house_id,'vice_president'\)/);
assert.match(rules, /private\.is_house_president/);
assert.match(rules, /public\.is_house_presiding_authority/);

// No automatic VP presidency without 96h absence; remove the unconditional
// authority from the new Senate vice bill voting feature.
assert.match(rules, /private\.is_senate_vice_bill_voting_authority/);
assert.match(rules, /private\.is_acting_house_president\(p_actor,p_house_id\)/);
assert.match(rules, /not \(private\.is_house_president\(v_actor,p_house_id\) or public\.has_full_admin_access\(\)\)/);
assert.match(rules, /private\.promote_house_vice_after_vacancy/);
assert.match(rules, /DEFERRABLE INITIALLY DEFERRED/);

// UI requests server permissions; role strings are no longer sufficient.
assert.match(parliament, /rpc\('get_house_presidency_authority'/);
assert.match(parliament, /housePresidencyAuthority\?\.can_manage_votings/);
assert.match(parliament, /is_temporary_substitute/);
assert.match(parliament, /30000/);
assert.doesNotMatch(parliament, /canManageSenateViceBillVote/);
assert.doesNotMatch(parliament, /canViceManageThisBill/);
assert.match(status, /is_house_vice_president/);
assert.match(status, /v_can_manage:=v_is_president OR v_is_acting OR public\.has_full_admin_access/);
console.log('✓ Regras da substituição legislativa: 4 dias reais, duas Casas, volta do titular, vacância, API e interface.');
