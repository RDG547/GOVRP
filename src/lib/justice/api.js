import { supabase } from '@/lib/supabaseClient';

const throwIfError = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export const fetchRpTimeSettings = async () => throwIfError(
  await supabase.from('rp_time_settings').select('*').eq('id', true).single()
);

export const fetchCitizenJusticeData = async () => {
  const [
    occurrencesResult,
    casesResult,
    deadlinesResult,
    requestsResult,
    custodyResult,
    finesResult,
    appealsResult,
    hearingsResult,
    citizenRequestsResult,
    campaignsResult,
    securityResult,
    wantedResult,
    metricsResult,
    serverNowResult,
    subjectsResult,
    profilesResult,
    timelineResult,
    documentsResult,
    hearingsCaseResult,
    caseAppealsResult,
    sentencesResult,
  ] = await Promise.all([
    supabase
      .from('police_occurrences')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('criminal_cases')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(50),
    supabase
      .from('justice_deadlines')
      .select('*')
      .eq('status', 'open')
      .order('real_due_at', { ascending: true })
      .limit(50),
    supabase
      .from('judicial_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('prison_terms')
      .select('*, facility:prison_facilities(name), cell:prison_cells(code)')
      .in('custody_status', ['awaiting_intake', 'provisional', 'serving'])
      .order('admitted_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('police_fines').select('*').order('created_at', { ascending: false }),
    supabase.from('fine_appeals').select('*').order('created_at', { ascending: false }),
    supabase.from('fine_hearing_requests').select('*').order('created_at', { ascending: false }),
    supabase.from('citizen_justice_requests').select('*').order('created_at', { ascending: false }),
    supabase.from('public_safety_campaigns').select('*').order('starts_at', { ascending: false }).limit(20),
    supabase.rpc('get_my_security_status'),
    supabase.rpc('get_public_wanted_list'),
    supabase.rpc('get_police_efficiency_metrics'),
    supabase.rpc('get_server_now'),
    supabase.from('investigation_subjects').select('*, profile:profiles(id, full_name)').order('created_at', { ascending: false }).limit(200),
    supabase.from('profiles').select('id, full_name, username, avatar_url').order('full_name').limit(300),
    supabase.from('case_timeline_events').select('*').order('created_at', { ascending: true }).limit(500),
    supabase.from('case_documents').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('hearings').select('*').order('scheduled_at', { ascending: false }).limit(100),
    supabase.from('appeals').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('sentences').select('*').order('issued_at', { ascending: false }).limit(100),
  ]);

  return {
    occurrences: throwIfError(occurrencesResult) || [],
    cases: throwIfError(casesResult) || [],
    deadlines: throwIfError(deadlinesResult) || [],
    requests: throwIfError(requestsResult) || [],
    custody: throwIfError(custodyResult) || null,
    fines: throwIfError(finesResult) || [],
    fineAppeals: throwIfError(appealsResult) || [],
    fineHearings: throwIfError(hearingsResult) || [],
    citizenRequests: throwIfError(citizenRequestsResult) || [],
    campaigns: throwIfError(campaignsResult) || [],
    security: throwIfError(securityResult) || { warrants: [], investigations: [] },
    wanted: throwIfError(wantedResult) || [],
    policeMetrics: throwIfError(metricsResult) || {},
    serverNow: throwIfError(serverNowResult),
    investigationSubjects: throwIfError(subjectsResult) || [],
    profiles: throwIfError(profilesResult) || [],
    timeline: throwIfError(timelineResult) || [],
    caseDocuments: throwIfError(documentsResult) || [],
    caseHearings: throwIfError(hearingsCaseResult) || [],
    caseAppeals: throwIfError(caseAppealsResult) || [],
    sentences: throwIfError(sentencesResult) || [],
  };
};

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
    supabase.from('profiles').select('id, full_name, username, avatar_url').order('full_name').limit(500),
    supabase.from('case_timeline_events').select('*').order('created_at', { ascending: true }).limit(1000),
    supabase.from('case_documents').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('hearings').select('*').order('scheduled_at', { ascending: false }).limit(300),
    supabase.from('appeals').select('*').order('created_at', { ascending: false }).limit(300),
    supabase.from('sentences').select('*').order('issued_at', { ascending: false }).limit(300),
    supabase.from('investigation_parties').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('case_parties').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('penal_code').select('*').eq('is_active', true).order('code').limit(300),
  ]);

  return {
    occurrences: throwIfError(occurrencesResult) || [],
    investigations: throwIfError(investigationsResult) || [],
    cases: throwIfError(casesResult) || [],
    requests: throwIfError(requestsResult) || [],
    warrants: throwIfError(warrantsResult) || [],
    custody: throwIfError(custodyResult) || [],
    fines: throwIfError(finesResult) || [],
    fineAppeals: throwIfError(appealsResult) || [],
    fineHearings: throwIfError(hearingsResult) || [],
    citizenRequests: throwIfError(citizenRequestsResult) || [],
    campaigns: throwIfError(campaignsResult) || [],
    integrityCases: throwIfError(integrityCasesResult) || [],
    serverNow: throwIfError(serverNowResult),
    investigationSubjects: throwIfError(subjectsResult) || [],
    profiles: throwIfError(profilesResult) || [],
    timeline: throwIfError(timelineResult) || [],
    caseDocuments: throwIfError(documentsResult) || [],
    caseHearings: throwIfError(caseHearingsResult) || [],
    caseAppeals: throwIfError(caseAppealsResult) || [],
    sentences: throwIfError(sentencesResult) || [],
    investigationParties: throwIfError(partiesResult) || [],
    caseParties: throwIfError(casePartiesResult) || [],
    penalCodes: throwIfError(penalCodesResult) || [],
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

export const subscribeToJusticeChanges = (userId, onChange) => {
  const channel = supabase
    .channel(`justice:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'criminal_cases' },
      onChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'judicial_requests' },
      onChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'prison_terms' },
      onChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'prison_activity_runs' },
      onChange
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'police_occurrences' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'police_fines' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fine_appeals' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fine_hearing_requests' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'citizen_justice_requests' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'public_safety_campaigns' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'public_integrity_cases' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'investigation_subjects' }, onChange)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};
