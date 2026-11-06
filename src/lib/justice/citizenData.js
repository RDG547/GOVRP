import { fetchCitizenDirectory } from '../publicProfileQueries.js';
import { querySections } from '../sectionLoader.js';

export const CITIZEN_JUSTICE_SECTIONS = ['occurrences', 'cases', 'deadlines', 'requests', 'custody', 'fines', 'fineAppeals', 'fineHearings', 'citizenRequests', 'campaigns', 'security', 'wanted', 'serverNow', 'investigationSubjects', 'profiles', 'timeline', 'caseDocuments', 'caseEvidence', 'caseHearings', 'caseAppeals', 'sentences'];
const sectionsByTable = {
  police_occurrences: ['occurrences'], criminal_cases: ['cases'],
  justice_deadlines: ['deadlines'], judicial_requests: ['requests'], prison_terms: ['custody'],
  police_fines: ['fines'], fine_appeals: ['fineAppeals'], fine_hearing_requests: ['fineHearings'],
  citizen_justice_requests: ['citizenRequests'], public_safety_campaigns: ['campaigns'],
  criminal_investigations: ['security'], investigation_subjects: ['investigationSubjects', 'security'],
  warrants: ['security', 'wanted'], case_timeline_events: ['timeline'], case_documents: ['caseDocuments'], case_evidence: ['caseEvidence'],
  hearings: ['caseHearings'], appeals: ['caseAppeals'], sentences: ['sentences'],
  case_parties: ['cases', 'timeline', 'caseDocuments', 'caseEvidence', 'caseHearings', 'caseAppeals', 'sentences'],
};
export function citizenJusticeSectionsForEvents(events) {
  if (events.some(event => event.eventType === 'SYNC')) return CITIZEN_JUSTICE_SECTIONS;
  return [...new Set(events.flatMap(event => {
    if (event.table !== 'notifications') return sectionsByTable[event.table] || [];
    const type = event.new?.type || '';
    if (type.startsWith('justice_occurrence_')) return ['occurrences'];
    if (type.startsWith('justice_warrant_')) return ['security', 'wanted'];
    if (type.startsWith('justice_request_')) return ['requests'];
    if (['justice_prison_admission', 'justice_arrest_executed', 'justice_flare_arrest', 'justice_release_order'].includes(type)) return ['custody', 'security'];
    if (['justice_sentence_issued', 'justice_acquittal', 'justice_charges_filed', 'justice_case_assigned'].includes(type)) return ['cases', 'timeline', 'sentences', 'deadlines'];
    if (type === 'justice_investigation_party') return ['security', 'investigationSubjects'];
    return [];
  }))];
}

export async function fetchCitizenSections(client, sections = CITIZEN_JUSTICE_SECTIONS, cursor = null) {
  const rows = (table, column = 'created_at', limit) => {
    let query = client.from(table).select('*').order(column, { ascending: false });
    return limit ? query.limit(limit) : query;
  };
  const result = await querySections({
    occurrences: async () => {
      const result = await client.rpc('get_my_police_occurrences_page', {
        p_limit: 20, p_before_created_at: cursor?.created_at || null, p_before_id: cursor?.id || null,
      });
      // Preserve existing installations during the frontend/database rollout.
      // Never fall back to selecting the internal police table.
      if (!cursor && ['PGRST202', '42883'].includes(result.error?.code)) {
        const legacy = await client.rpc('get_my_police_occurrences');
        return { ...legacy, data: {
          items: legacy.data || [], next_cursor: null,
          active_count: (legacy.data || []).filter(item => !['Arquivada', 'Duplicada'].includes(item.status)).length,
        } };
      }
      return result;
    },
    cases: () => rows('criminal_cases', 'updated_at', 50),
    deadlines: () => client.from('justice_deadlines').select('*').eq('status', 'open').order('real_due_at', { ascending: true }).limit(50),
    requests: () => rows('judicial_requests', 'created_at', 50),
    custody: () => client.from('prison_terms').select('*, facility:prison_facilities(name), cell:prison_cells(code)').in('custody_status', ['awaiting_intake', 'provisional', 'serving']).order('admitted_at', { ascending: false }).limit(1).maybeSingle(),
    fines: () => rows('police_fines'), fineAppeals: () => rows('fine_appeals'),
    fineHearings: () => rows('fine_hearing_requests'), citizenRequests: () => rows('citizen_justice_requests'),
    campaigns: () => rows('public_safety_campaigns', 'starts_at', 20),
    security: () => client.rpc('get_my_security_status'), wanted: () => client.rpc('get_public_wanted_list'),
    serverNow: () => client.rpc('get_server_now'),
    investigationSubjects: () => client.from('investigation_subjects').select('*, profile:profiles(id, full_name)').order('created_at', { ascending: false }).limit(200),
    profiles: () => fetchCitizenDirectory(client),
    timeline: () => client.from('case_timeline_events').select('*').order('created_at', { ascending: true }).limit(500),
    caseDocuments: () => rows('case_documents', 'created_at', 200),
    caseEvidence: () => rows('case_evidence', 'created_at', 1000),
    caseHearings: () => rows('hearings', 'scheduled_at', 100), caseAppeals: () => rows('appeals', 'created_at', 100),
    sentences: () => rows('sentences', 'issued_at', 100),
  }, sections);
  if ('occurrences' in result.values) {
    const page = result.values.occurrences;
    result.values.occurrences = page?.items || [];
    result.values.nextOccurrenceCursor = page?.next_cursor || null;
    result.values.activeOccurrenceCount = Number(page?.active_count || 0);
  }
  return result;
}
