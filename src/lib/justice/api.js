import { fetchCitizenSections, CITIZEN_JUSTICE_SECTIONS } from './citizenData';
import { justiceErrorMessage } from './errors';
import { subscribeToDomain } from '@/lib/realtime';
import { supabase } from '@/lib/supabaseClient';

const throwIfError = ({ data, error }) => {
  if (error) throw new Error(justiceErrorMessage(error));
  if (data?.success === false) throw new Error(data.message || 'Não foi possível concluir a ação.');
  return data;
};

export const fetchRpTimeSettings = async () => throwIfError(
  await supabase.from('rp_time_settings').select('*').eq('id', true).single()
);

export const fetchCitizenJusticeData = (sections = CITIZEN_JUSTICE_SECTIONS, cursor = null) => fetchCitizenSections(supabase, sections, cursor);

export const fetchAuthorityJusticeData = async () => {
  const [
    occurrencesResult,
    investigationsResult,
    casesResult,
    requestsResult,
    warrantsResult,
    custodyResult,
    finesResult,
    appealsResult,
    hearingsResult,
    citizenRequestsResult,
    campaignsResult,
    integrityCasesResult,
    serverNowResult,
    subjectsResult,
    profilesResult,
    timelineResult,
    documentsResult,
    caseHearingsResult,
    caseAppealsResult,
    sentencesResult,
    partiesResult,
    casePartiesResult,
    penalCodesResult,
  ] = await Promise.all([
    supabase
      .from('police_occurrences')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('criminal_investigations')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100),
    supabase
      .from('criminal_cases')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100),
    supabase
      .from('judicial_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('warrants')
      .select('*')
      .order('issued_at', { ascending: false })
      .limit(100),
    supabase
      .from('prison_terms')
      .select('*, inmate:profiles!prison_terms_inmate_id_fkey(id, full_name, username, avatar_url), facility:prison_facilities(name)')
      .in('custody_status', ['awaiting_intake', 'provisional', 'serving'])
      .order('admitted_at', { ascending: false })
      .limit(100),
    supabase.from('police_fines').select('*, citizen:profiles!police_fines_user_id_fkey(full_name)').order('created_at', { ascending: false }).limit(100),
    supabase.from('fine_appeals').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('fine_hearing_requests').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('citizen_justice_requests').select('*, requester:profiles!citizen_justice_requests_requester_id_fkey(full_name)').order('created_at', { ascending: false }).limit(100),
    supabase.from('public_safety_campaigns').select('*').order('starts_at', { ascending: false }).limit(100),
    supabase.from('public_integrity_cases').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.rpc('get_server_now'),
    supabase.from('investigation_subjects').select('*, profile:profiles(id, full_name, username, avatar_url)').order('created_at', { ascending: false }).limit(300),
    supabase.from('public_citizen_profiles').select('id, full_name, username, avatar_url').order('full_name').limit(500),
    supabase.from('case_timeline_events').select('*').order('created_at', { ascending: true }).limit(1000),
    supabase.from('case_documents').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('hearings').select('*').order('scheduled_at', { ascending: false }).limit(300),
    supabase.from('appeals').select('*').order('created_at', { ascending: false }).limit(300),
    supabase.from('sentences').select('*').order('issued_at', { ascending: false }).limit(300),
    supabase.from('investigation_parties').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('case_parties').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('penal_code').select('*').eq('is_active', true).order('code').limit(300),
  ]);

  const errors = [];
  const readSection = (result, section) => {
    if (result.error) { errors.push(section); console.warn(`Justiça: ${section} indisponível`, result.error.message); return null; }
    return result.data;
  };
  return {
    errors,
    occurrences: readSection(occurrencesResult, 'occurrences') || [],
    investigations: readSection(investigationsResult, 'investigations') || [],
    cases: readSection(casesResult, 'cases') || [],
    requests: readSection(requestsResult, 'requests') || [],
    warrants: readSection(warrantsResult, 'warrants') || [],
    custody: readSection(custodyResult, 'custody') || [],
    fines: readSection(finesResult, 'fines') || [],
    fineAppeals: readSection(appealsResult, 'fineAppeals') || [],
    fineHearings: readSection(hearingsResult, 'fineHearings') || [],
    citizenRequests: readSection(citizenRequestsResult, 'citizenRequests') || [],
    campaigns: readSection(campaignsResult, 'campaigns') || [],
    integrityCases: readSection(integrityCasesResult, 'integrityCases') || [],
    serverNow: readSection(serverNowResult, 'serverNow'),
    investigationSubjects: readSection(subjectsResult, 'investigationSubjects') || [],
    profiles: readSection(profilesResult, 'profiles') || [],
    timeline: readSection(timelineResult, 'timeline') || [],
    caseDocuments: readSection(documentsResult, 'caseDocuments') || [],
    caseHearings: readSection(caseHearingsResult, 'caseHearings') || [],
    caseAppeals: readSection(caseAppealsResult, 'caseAppeals') || [],
    sentences: readSection(sentencesResult, 'sentences') || [],
    investigationParties: readSection(partiesResult, 'investigationParties') || [],
    caseParties: readSection(casePartiesResult, 'caseParties') || [],
    penalCodes: readSection(penalCodesResult, 'penalCodes') || [],
  };
};

export const createOccurrence = async (payload) => throwIfError(
  await supabase.rpc('create_police_occurrence', {
    p_title: payload.title,
    p_description: payload.description,
    p_occurrence_type: payload.occurrenceType,
    p_location: payload.location || null,
    p_occurred_at: payload.occurredAt || new Date().toISOString(),
    p_anonymous: Boolean(payload.anonymous),
    p_priority: payload.priority || 'normal',
    p_involved_people: payload.involvedPeople || [],
    p_witnesses: payload.witnesses || [],
    p_evidence: payload.evidence || [],
  })
);

export const createCitizenJusticeRequest = async (payload) => throwIfError(
  await supabase.rpc('create_citizen_justice_request', {
    p_request_type: payload.requestType,
    p_subject: payload.subject,
    p_description: payload.description,
    p_related_occurrence_id: payload.relatedOccurrenceId || null,
    p_related_investigation_id: payload.relatedInvestigationId || null,
    p_evidence: payload.evidence || [],
  })
);

export const addInvestigationSubject = async ({ investigationId, profileId, subjectStatus, notifySubject, notes }) => throwIfError(
  await supabase.rpc('add_investigation_subject', {
    p_investigation_id: investigationId,
    p_profile_id: profileId,
    p_subject_status: subjectStatus,
    p_notify_subject: Boolean(notifySubject),
    p_notes: notes || null,
  })
);

export const payCitizenFine = async (fineId) => throwIfError(
  await supabase.rpc('pay_fine', { p_fine_id: fineId })
);

export const appealCitizenFine = async (fineId, reason) => throwIfError(
  await supabase.rpc('appeal_fine', { p_fine_id: fineId, p_reason: reason })
);

export const requestFineHearing = async (fineId, reason) => throwIfError(
  await supabase.rpc('request_fine_hearing', {
    p_fine_id: fineId,
    p_reason: reason,
    p_preferred_times: [],
  })
);

export const issueClearanceCertificate = async () => throwIfError(
  await supabase.rpc('issue_criminal_clearance_certificate')
);

export const triageOccurrence = async ({ occurrenceId, action, notes }) => throwIfError(
  await supabase.rpc('triage_police_occurrence', {
    p_occurrence_id: occurrenceId,
    p_action: action,
    p_notes: notes,
  })
);

export const openInvestigation = async ({ occurrenceId, summary }) => throwIfError(
  await supabase.rpc('open_criminal_investigation', {
    p_occurrence_id: occurrenceId,
    p_summary: summary,
    p_lead_officer_id: null,
  })
);

export const recordInvestigationEvidence = async ({ investigationId, title, description, seal = false }) => throwIfError(
  await supabase.rpc('record_investigation_evidence', {
    p_investigation_id: investigationId,
    p_evidence_type: 'document',
    p_title: title,
    p_description: description,
    p_file_url: null,
    p_evidence_hash: crypto.randomUUID().replaceAll('-', ''),
    p_seal: seal,
  })
);

export const resolveInvestigation = async ({ investigationId, outcome, conclusion }) => throwIfError(
  await supabase.rpc('resolve_investigation', {
    p_investigation_id: investigationId,
    p_outcome: outcome,
    p_conclusion: conclusion,
    p_recommended_action: outcome === 'indict' ? 'Oferecimento de denúncia' : null,
  })
);

export const requestInvestigationComplement = async ({ investigationId, reason }) => throwIfError(
  await supabase.rpc('request_investigation_complement', {
    p_investigation_id: investigationId,
    p_reason: reason,
  })
);

export const fileCriminalCharges = async ({ investigationId, defendantId, penalCodeId, title, facts }) => throwIfError(
  await supabase.rpc('file_criminal_charges', {
    p_investigation_id: investigationId,
    p_defendant_id: defendantId,
    p_title: title,
    p_facts: facts,
    p_charges: [{
      penal_code_id: penalCodeId,
      description: facts,
      requested_sentence: null,
      attempted: false,
    }],
  })
);

export const decideChargeAdmission = async ({ caseId, admitted, reason }) => throwIfError(
  await supabase.rpc('decide_charge_admission', {
    p_case_id: caseId,
    p_admitted: admitted,
    p_reason: reason,
  })
);

export const submitCaseDocument = async ({ caseId, documentType, title, body }) => throwIfError(
  await supabase.rpc('submit_case_document', {
    p_case_id: caseId,
    p_document_type: documentType,
    p_title: title,
    p_body: body,
    p_file_url: null,
    p_visibility: 'parties',
  })
);

export const scheduleCaseHearing = async ({ caseId, scheduledAt, location }) => throwIfError(
  await supabase.rpc('schedule_case_hearing', {
    p_case_id: caseId,
    p_hearing_type: 'instruction',
    p_rp_scheduled_at: scheduledAt,
    p_duration_minutes: 60,
    p_meeting_location: location || null,
  })
);

export const completeCaseHearing = async ({ hearingId, minutes }) => throwIfError(
  await supabase.rpc('complete_case_hearing', { p_hearing_id: hearingId, p_minutes: minutes })
);

export const issueCaseAcquittal = async ({ caseId, reason }) => throwIfError(
  await supabase.rpc('issue_case_acquittal', { p_case_id: caseId, p_legal_reasoning: reason })
);

export const issueCriminalSentence = async ({ caseId, defendantId, reason, sentenceUnits = 1, fineAmount = 0, prisonRegime = 'closed' }) => throwIfError(
  await supabase.rpc('issue_criminal_sentence', {
    p_case_id: caseId,
    p_defendant_id: defendantId,
    p_result: 'conviction',
    p_legal_reasoning: reason,
    p_final_sentence_units: Number(sentenceUnits),
    p_fine_amount: Number(fineAmount),
    p_prison_regime: prisonRegime,
    p_special_justification: null,
  })
);

export const fileCaseAppeal = async ({ caseId, argumentsText }) => throwIfError(
  await supabase.rpc('file_case_appeal', {
    p_case_id: caseId,
    p_appeal_type: 'ordinary',
    p_arguments: argumentsText,
  })
);

export const decideCaseAppeal = async ({ appealId, outcome, decision }) => throwIfError(
  await supabase.rpc('decide_case_appeal', {
    p_appeal_id: appealId,
    p_outcome: outcome,
    p_decision: decision,
  })
);

export const releasePrisonTerm = async ({ prisonTermId, reason }) => throwIfError(
  await supabase.rpc('release_prison_term', {
    p_prison_term_id: prisonTermId,
    p_reason: reason,
  })
);

export const decideJudicialRequest = async ({
  requestId,
  approved,
  reason,
}) => throwIfError(
  await supabase.rpc('decide_judicial_request', {
    p_request_id: requestId,
    p_approved: approved,
    p_decision_reason: reason,
    p_warrant_duration_rp_days: 7,
  })
);

export const decideFineAppeal = async ({ appealId, approved, reason }) => throwIfError(
  await supabase.rpc('decide_fine_appeal', {
    p_appeal_id: appealId,
    p_approved: approved,
    p_reason: reason,
  })
);

export const decideFineHearing = async ({ hearingId, status, scheduledAt, notes }) => throwIfError(
  await supabase.rpc('decide_fine_hearing', {
    p_hearing_id: hearingId,
    p_status: status,
    p_scheduled_at: scheduledAt || null,
    p_notes: notes,
  })
);

export const decideCitizenJusticeRequest = async ({ requestId, status, notes }) => throwIfError(
  await supabase.rpc('decide_citizen_justice_request', {
    p_request_id: requestId,
    p_status: status,
    p_notes: notes,
    p_assigned_to: null,
  })
);

export const savePublicSafetyCampaign = async (campaign) => throwIfError(
  await supabase.rpc('manage_public_safety_campaign', {
    p_campaign_id: campaign.id || null,
    p_title: campaign.title,
    p_summary: campaign.summary,
    p_content: campaign.content,
    p_category: campaign.category,
    p_starts_at: campaign.startsAt || null,
    p_ends_at: campaign.endsAt || null,
    p_is_published: Boolean(campaign.isPublished),
  })
);

export const transitionIntegrityCase = async ({ caseId, status, summary }) => throwIfError(
  await supabase.rpc('transition_integrity_case', {
    p_case_id: caseId,
    p_new_status: status,
    p_summary: summary,
    p_investigation_id: null,
    p_commission_id: null,
  })
);

export const fetchPrisonExperience = async (userId) => {
  const serverNowResult = await supabase.rpc('get_server_now');
  const termResult = await supabase
    .from('prison_terms')
    .select('*, facility:prison_facilities(*), cell:prison_cells(*, wing:prison_wings(*))')
    .eq('inmate_id', userId)
    .in('custody_status', ['awaiting_intake', 'provisional', 'serving'])
    .order('admitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const term = throwIfError(termResult);
  const activitiesResult = await supabase
    .from('prison_activities')
    .select('*')
    .eq('is_active', true)
    .order('name');

  if (!term) {
    return {
      term: null,
      activities: throwIfError(activitiesResult) || [],
      runs: [],
      events: [],
      inmates: [],
      serverNow: throwIfError(serverNowResult),
    };
  }

  const [runsResult, eventsResult, inmatesResult] = await Promise.all([
    supabase
      .from('prison_activity_runs')
      .select('*, activity:prison_activities(*)')
      .eq('prison_term_id', term.id)
      .order('started_at', { ascending: false })
      .limit(30),
    supabase
      .from('prison_events')
      .select('*')
      .eq('prison_term_id', term.id)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('prison_terms')
      .select('id, inmate_id, cell_id, custody_status, inmate:profiles!prison_terms_inmate_id_fkey(id, full_name, username, avatar_url)')
      .eq('facility_id', term.facility_id)
      .in('custody_status', ['provisional', 'serving'])
      .limit(50),
  ]);

  return {
    term,
    activities: throwIfError(activitiesResult) || [],
    runs: throwIfError(runsResult) || [],
    events: throwIfError(eventsResult) || [],
    inmates: throwIfError(inmatesResult) || [],
    serverNow: throwIfError(serverNowResult),
  };
};

export const startPrisonActivity = async (activityId) => throwIfError(
  await supabase.rpc('start_prison_activity', { p_activity_id: activityId })
);

export const completePrisonActivity = async (runId) => throwIfError(
  await supabase.rpc('complete_prison_activity', { p_run_id: runId })
);

export const subscribeToJusticeChanges = (userId, onChange) => subscribeToDomain('justice', userId, [
  'criminal_cases', 'criminal_investigations', 'judicial_requests', 'justice_deadlines', 'prison_terms',
  'prison_activity_runs', 'police_occurrences', 'police_fines', 'fine_appeals',
  'fine_hearing_requests', 'citizen_justice_requests', 'public_safety_campaigns',
  'public_integrity_cases', 'investigation_subjects', 'investigation_parties',
  'case_parties', 'case_timeline_events', 'case_documents', 'hearings', 'appeals',
  'sentences', 'warrants', { table: 'notifications', filter: `user_id=eq.${userId}` },
], onChange);

export const revokeJudicialWarrant = async ({ warrantId, reason }) => throwIfError(
  await supabase.rpc('revoke_judicial_warrant', { p_warrant_id: warrantId, p_reason: reason })
);
export const issueJusticeFine = async ({ userId, reason, amount, dueDate }) => throwIfError(
  await supabase.rpc('issue_fine', { p_user_id: userId, p_reason: reason, p_amount: Number(amount), p_due_date: dueDate })
);
