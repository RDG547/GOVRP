import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const ranking=read('src/components/business/CompanyRankings.jsx');
const post=read('src/components/social-x/PostCard.jsx');
const phone=read('src/components/PhoneAppViewport.jsx');
const electoral=read('src/components/elections/ElectoralManagement.jsx');
const commission=read('src/lib/parliamentGovernance.js');
const parliament=read('src/pages/services/ParliamentPanel.jsx');
const parties=read('src/components/parties/PartyManagementDialog.jsx');
const guidance=read('src/components/parties/PartyVoteGuidance.jsx');
const rules=read('supabase/migrations/20261117125102_party_commissions_candidacy_rules.sql');
const market=read('supabase/migrations/20261117125327_national_market_consumption_levies.sql');

assert.ok(ranking.includes('auto-rows-auto')&&!ranking.includes('auto-rows-[100px]'),
  'Ranking cards must grow with company names on narrow phones');
assert.ok(post.includes('grid-cols-4')&&post.includes('max-h-80')&&post.includes('object-contain'),
  'X post actions and media must fit mobile width without overlap');
assert.ok(phone.includes('viewport-fit=cover')&&phone.includes('overflow-x-hidden'),
  'Phone app viewport must be constrained');
assert.ok(electoral.includes('disabled={busy} onClick={()=>decide(true)}')&&electoral.includes('reason.trim().length<20} onClick={()=>decide(false)}'),
  'Electoral approval cannot require justification, rejection must');
assert.ok(rules.includes('if not p_approved and length')&&rules.includes('review_electoral_candidacy'),
  'Server must accept approvals without a justification');
assert.ok(commission.includes("value: 'mixed'")&&parliament.includes("'approve_mixed_parliament_commission'"),
  'Mixed committees must have a two-house approval workflow');
assert.ok(rules.includes("pending_joint_approval")&&rules.includes("jsonb_array_length(v_approvals)=2"),
  'A mixed commission must not be installed before both house approvals');
assert.ok(parties.includes('PartyVoteGuidance')&&guidance.includes('set_party_vote_guidance'),
  'Party leadership must be able to publish guidance');
assert.ok(parliament.includes('PartyGuidanceNotice')&&guidance.includes('o parlamentar vota livremente'),
  'Individual parliamentary votes remain independent of party guidance');
assert.ok(!rules.includes('cast_parliament_vote(')&&!rules.includes('parliament_voting_votes')&&rules.includes('Somente a direção partidária'),
  'Guidance must never cast or override a parliamentary vote');
assert.ok(market.includes("quote_legal_levies('purchase',amount,true")&&market.includes('government_finances')&&market.includes('government_revenues'),
  'Population demand must accrue legislated taxes to the Treasury');
console.log('✓ GOVRP 17/11 election, mixed commission, nonbinding party, mobile and fiscal contracts.');
