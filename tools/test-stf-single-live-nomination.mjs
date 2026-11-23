import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const main = read('supabase/migrations/20261121122358_guard_single_live_stf_nomination.sql');
const scope = read('supabase/migrations/20261121122625_scope_stf_guard_only_to_supreme_court.sql');

assert.match(main, /one_live_stf_nomination_per_candidate/);
assert.match(main, /CREATE UNIQUE INDEX IF NOT EXISTS one_live_stf_nomination_per_candidate\s+ON public\.minister_invitations\(candidate_id\)/);
assert.match(main, /i\.status='pending'\s+OR \(i\.status='accepted' AND i\.institutional_stage IN \('hearing','voting'\)\)/);
assert.match(main, /term\.profile_id=i\.candidate_id/);
assert.match(main, /term\.invitation_id IS DISTINCT FROM i\.id/);
assert.match(main, /i\.senate_voting_id IS NULL/);
assert.match(main, /institutional_stage='cancelled'/);
assert.match(main, /CREATE TRIGGER guard_live_stf_nomination/);
assert.match(main, /CREATE TRIGGER close_superseded_stf_nominations/);
assert.match(main, /t\.status='active' AND t\.ended_at IS NULL/);
assert.match(main, /'institutional_nomination_superseded'/);
assert.match(main, /A vaga ou a elegibilidade|Conclua a votação antes de uma nova posse|Este cidadão possui outra indicação ao STF em votação/);
assert.match(scope, /IF new\.office_key IS NULL OR new\.office_key NOT LIKE 'supreme_court_%'/);
assert.doesNotMatch(main, /DELETE FROM public\.minister_invitations/i);
assert.doesNotMatch(main, /UPDATE public\.parliament_votings/i);
assert.doesNotMatch(main, /UPDATE public\.institutional_terms/i);
assert.doesNotMatch(main, /UPDATE public\.profiles/i);

console.log('✓ STF single-live-nomination guard, historical cleanup, protected Senate votes and ministry compatibility verified.');
