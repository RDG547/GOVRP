import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVotingEligibilityNotice } from '../src/lib/electoralEligibility.js';

const reasons = [
  ['email_unconfirmed', 'Confirme seu e-mail', null],
  ['account_wait_24h', '24 horas', null],
  ['citizenship_incomplete', 'concluir o cadastro', '/registro-cidadania'],
  ['title_missing', 'Título de Eleitor', '/services/dic'],
  ['title_invalid', 'inválido', '/services/dic'],
  ['title_before_email', 'administração', '/support'],
  ['indirect_electorate', 'parlamentares', null],
  ['session_required', 'Entre na sua conta', '/login'],
];
for (const [code, snippet, path] of reasons) {
  const result = getVotingEligibilityNotice(code);
  assert.ok(result.message.includes(snippet), `wrong text for ${code}`);
  assert.equal(result.action?.to || null, path, `wrong action for ${code}`);
}
assert.match(getVotingEligibilityNotice('account_wait_24h', '2026-11-07T23:17:15Z').message, /Prazo:/);

const ballot = readFileSync('src/components/elections/ElectronicBallot.jsx', 'utf8');
const dic = readFileSync('src/pages/services/DIC.jsx', 'utf8');
const migration = readFileSync('supabase/migrations/20261107110000_explain_voting_eligibility.sql', 'utf8');

assert.match(ballot, /get_my_election_voting_status/);
assert.match(ballot, /eligibility\.status === 'error'/);
assert.match(ballot, /document\.addEventListener\('visibilitychange'/);
assert.match(ballot, /window\.addEventListener\('focus'/);
assert.match(ballot, /Verificar novamente/);
assert.match(ballot, /void checkEligibility\(\)/);
assert.match(ballot, /supabase\.rpc\('cast_ballot'/);
assert.match(dic, /govrp:electoral-document-updated/);

assert.match(migration, /public\.can_vote_in_election\(p_election_id\)/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_my_election_voting_status\(uuid\) FROM PUBLIC, anon/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_my_election_voting_status\(uuid\) TO authenticated/);
assert.doesNotMatch(migration, /UPDATE public\.(votes|profiles|documents|elections)/);
assert.doesNotMatch(migration, /INSERT INTO public\.votes/);
console.log('PASS: eligibility explanations, session/network recovery, citizen document refresh, and unchanged ballot authorization');
