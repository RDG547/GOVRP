import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync('src/pages/services/elections/RegisterCandidacy.jsx','utf8');
const server = readFileSync('server/elections/http.js','utf8');
const errors = readFileSync('src/lib/userErrors.js','utf8');
const migration = readFileSync('supabase/migrations/20261102235500_candidate_reapplication_and_inactive_party_guard.sql','utf8');

// The party must remain visible when inactive, so a name is always shown.
assert.match(ui, /select\('id, name, electoral_number, is_active, status'\)/);
assert.doesNotMatch(ui, /'Carregando\.\.\.'/);
assert.match(ui, /inactiveAffiliation/);
assert.match(ui, /no mínimo 5 membros/);
assert.match(ui, /primeiro sair do partido/);
assert.match(ui, /if \(inactiveAffiliation\)/);
assert.match(ui, /const currentPartyId = partyMemberResponse\.data\?\.party_id \|\| null/);
assert.match(ui, /setValue\('party_id', currentPartyId/);

// Both presidential invitation and vice acceptance must honor the rules.
assert.match(server, /requesterPartyId && \(!party \|\| !party\.is_active/);
assert.match(server, /Seu partido está inativo/);
assert.match(server, /Você já está filiado/);
assert.match(errors, /CANDIDACY_ALREADY_EXISTS/);

// Historical rows survive; one non-withdrawn row per election/user.
// A server-side insert, including service-role calls, cannot bypass eligibility.
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS candidates_one_active_per_election_user/);
assert.match(migration, /DROP CONSTRAINT IF EXISTS candidates_election_id_user_id_key/);
assert.match(migration, /CREATE TRIGGER enforce_candidate_party_eligibility/);
assert.match(migration, /WHERE pm\.user_id = NEW\.user_id/);
assert.match(migration, /v_member_count < 5/);
assert.match(migration, /NEW\.party_id IS DISTINCT FROM v_member_party_id/);
assert.match(migration, /BEFORE INSERT ON public\.candidates/);
console.log('OK: candidature resubmission and inactive-party guards');
