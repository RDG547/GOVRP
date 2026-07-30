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
  ]);

  return {
    occurrences: throwIfError(occurrencesResult) || [],
    cases: throwIfError(casesResult) || [],
    deadlines: throwIfError(deadlinesResult) || [],
    requests: throwIfError(requestsResult) || [],
    custody: throwIfError(custodyResult) || null,
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
  ]);

  return {
    occurrences: throwIfError(occurrencesResult) || [],
    investigations: throwIfError(investigationsResult) || [],
    cases: throwIfError(casesResult) || [],
    requests: throwIfError(requestsResult) || [],
    warrants: throwIfError(warrantsResult) || [],
    custody: throwIfError(custodyResult) || [],
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
  })
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

export const fetchPrisonExperience = async (userId) => {
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
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};

