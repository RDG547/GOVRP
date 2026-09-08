export const PARLIAMENT_REALTIME_TABLES = ['parliament_members','parliament_houses','bills','bill_status_history','law_effects','parliament_votings','parliament_voting_votes','bill_suggestions','plebiscites','plebiscite_votes','parliament_commissions','parliament_commission_members','parliament_commission_house_links','parliament_leadership_terms','parliament_leadership_elections','parliament_leadership_candidates','parliament_leadership_votes','party_members','political_parties'];
export function parliamentSectionsForEvents(events) {
 if (!events?.length || events.some(event => event.eventType === 'SYNC' || event.eventType === 'PUBLIC_PROFILE')) return ['members','bills','plebiscites','governance'];
 const sections = new Set();
 for (const event of events) {
   if (['parliament_members','parliament_houses','party_members','political_parties'].includes(event.table)) { sections.add('members'); sections.add('governance'); }
   if (['bills','bill_status_history','law_effects','parliament_votings','parliament_voting_votes'].includes(event.table)) sections.add('bills');
   if (['plebiscites','plebiscite_votes'].includes(event.table)) sections.add('plebiscites');
   if (/parliament_(commission|leadership|voting)/.test(event.table)) sections.add('governance');
 }
 return [...sections];
}
