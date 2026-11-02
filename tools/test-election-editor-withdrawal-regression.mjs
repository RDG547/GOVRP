import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server/elections/http.js', 'utf8');
const handler = server.split('const raw_cancelCandidacyHandler =')[1]?.split('const raw_resignPresidencyHandler')[0];
assert.ok(handler, 'Candidacy cancellation endpoint exists');
assert.match(handler, /user:\s*requester,\s*accessToken\s*}\s*=\s*await ensureAuthenticatedRequester/);
assert.match(handler, /getUserScopedSupabase\(accessToken\)/);
assert.doesNotMatch(handler, /requester\.accessToken/, 'Never derive access token from Supabase User');
assert.match(handler, /trackerNotification\.user_id !== requester\.id/);
assert.match(handler, /!withdrawal\?\.success/);

const admin = readFileSync('src/components/admin/ElectionManagement.jsx','utf8');
assert.doesNotMatch(admin, /calendarLocked/, 'Do not lock editing as soon as candidacies start');
assert.match(admin, /manage_electoral_calendar/);
assert.doesNotMatch(admin, /admin_set_election_seats/);
assert.match(admin, /votingLocked/);
assert.match(admin, /value={formData.name} onChange={handleChange} required \/>/);
assert.match(admin, /value={formData.description} onChange={handleChange} \/>/);

const portal = readFileSync('src/components/elections/ElectoralManagement.jsx','utf8');
assert.match(portal, /Editar eleição/);
assert.match(portal, /manage_electoral_calendar/);
assert.doesNotMatch(portal, /admin_set_election_seats/);
assert.equal((portal.match(/supabase\.rpc\('manage_electoral_calendar'/g)||[]).length,1);

const migration = readFileSync('supabase/migrations/20261102213000_admin_edit_active_election_calendar.sql','utf8');
assert.match(migration, /private\.assert_electoral_management\(\)/);
assert.match(migration, /candidates where election_id=p_election_id/);
assert.match(migration, /public\.election_settlements/);
assert.match(migration, /A votação já começou/);
assert.match(migration, /economy_private\.audit/);
assert.match(migration, /voting_start_date<=clock_timestamp/);
console.log('OK: withdrawal JWT, tracker authorization, safe admin election editing and auditing');
