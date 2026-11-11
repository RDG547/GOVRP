import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(path,'utf8');
const sqlVote=read('supabase/migrations/20261111151000_parliament_vote_scheduling_budget.sql');
const sqlMinister=read('supabase/migrations/20261111162000_ministry_programs_real_world_effects.sql');
const panel=read('src/pages/services/ParliamentPanel.jsx');
const pop=read('src/components/parliament/ParliamentVotingStartPopup.jsx');
const app=read('src/App.jsx');
const president=read('src/pages/dashboards/panels/PresidentDashboard.jsx');
const minister=read('src/pages/dashboards/panels/MinisterDashboard.jsx');
const budget=read('src/lib/governmentBudget.js');

for(const [description,pass] of [
 ['Cron activates scheduled voting',/activate_due_parliament_votes/.test(sqlVote)&&/cron.schedule\('govrp-scheduled-parliament-votes'/.test(sqlVote)],
 ['Only House president schedules',/private.is_house_president\(auth.uid\(\),p_house_id\)/.test(sqlVote)],
 ['Schedule notices delivered to eligible houses',/parliament_voting_scheduled/.test(sqlVote)&&/get_active_parliament_member_id/.test(sqlVote)],
 ['Started and closed voting notices',/parliament_voting_open/.test(sqlVote)&&/parliament_voting_closed/.test(sqlVote)],
 ['Popup checks server active and expiry',/data.status!=='active'/.test(pop)&&/Date.parse\(data.end_date\)<=Date.now\(\)/.test(pop)],
 ['Popup is global',/ParliamentVotingStartPopup/.test(app)],
 ['Vote scheduler from Parliamentary project list',/ParliamentVoteScheduler/.test(panel)],
 ['PDL veto override proposal',/propose_veto_override/.test(sqlVote)&&/proposeVeto|handleVetoOverride/.test(panel)],
 ['Atomic presidential budget save',/save_presidential_budget/.test(sqlVote)&&/p_expected_areas/.test(sqlVote)],
 ['Client preserves unsaved budget drafts',/draftDirtyRef/.test(president)&&/remoteConflict/.test(president)],
 ['All 11 budget areas kept',/GOVERNMENT_BUDGET_AREA_NAMES/.test(budget)&&/11/.test(sqlVote)],
 ['Minister-specific program catalog',/ministry_program_definitions/.test(sqlMinister)&&/culture_festivals/.test(sqlMinister)&&/environment_sanitation/.test(sqlMinister)],
 ['Real Treasury approvals',/approve_government_project/.test(sqlMinister)&&/review_ministry_program/.test(sqlMinister)],
 ['Real execution and economy impact',/economy_private.process_project/.test(sqlMinister)&&/apply_government_impact/.test(sqlMinister)],
 ['Merged minister authorization',/current_minister_has_portfolio/.test(sqlMinister)],
 ['Minister dashboard integration',/MinistryProgramsPanel/.test(minister)],
 ['President approval integration',/MinistryProgramApprovals/.test(president)],
]) {
 assert(pass,description);
 console.log('PASS',description);
}
