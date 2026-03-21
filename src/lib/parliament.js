const HOUSE_PRESIDENT_ROLES = [
  'Presidente da Câmara',
  'Presidente da Câmara dos Deputados',
  'Presidente do Senado',
];

export const PARLIAMENT_PANEL_ROLES = [
  'Deputado',
  'Senador',
  ...HOUSE_PRESIDENT_ROLES,
  'Admin',
];

export const canManageParliamentVoting = (role) =>
  role === 'Admin' || HOUSE_PRESIDENT_ROLES.includes(role);

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const getFutureDate = (yearsAhead = 4) => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + yearsAhead);
  return date.toISOString().slice(0, 10);
};

const getVotingEndDate = (daysAhead = 7) => {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString();
};

export const inferBillTypeFromTitle = (title = '') => {
  const normalized = title.trim().toUpperCase();

  if (normalized.startsWith('PEC:') || normalized.startsWith('PEC ')) {
    return 'PEC';
  }

  if (normalized.startsWith('PLC:') || normalized.startsWith('PLC ')) {
    return 'PLC';
  }

  if (normalized.startsWith('MP:') || normalized.startsWith('MP ')) {
    return 'MP';
  }

  return 'PL';
};

export const ensureParliamentOperatorMember = async (
  supabase,
  { userId, houseId, member }
) => {
  if (member?.id && member.house_id === houseId) {
    return member;
  }

  const { data: existingMember, error: existingMemberError } = await supabase
    .from('parliament_members')
    .select('id, user_id, house_id, party_id, term_start_date, term_end_date')
    .eq('user_id', userId)
    .eq('house_id', houseId)
    .order('term_end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingMemberError) {
    throw existingMemberError;
  }

  if (existingMember) {
    return existingMember;
  }

  const { data: createdMember, error: createMemberError } = await supabase
    .from('parliament_members')
    .insert({
      user_id: userId,
      house_id: houseId,
      term_start_date: getTodayDate(),
      term_end_date: getFutureDate(),
    })
    .select('id, user_id, house_id, party_id, term_start_date, term_end_date')
    .single();

  if (createMemberError) {
    throw createMemberError;
  }

  return createdMember;
};

export const startBillVotingSession = async (
  supabase,
  { billId, houseId, title, description }
) => {
  const { data: existingVoting, error: existingVotingError } = await supabase
    .from('parliament_votings')
    .select('id, status')
    .eq('related_id', billId)
    .eq('house_id', houseId)
    .eq('type', 'bill')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingVotingError) {
    throw existingVotingError;
  }

  if (existingVoting) {
    return existingVoting;
  }

  const { data: createdVoting, error: createVotingError } = await supabase
    .from('parliament_votings')
    .insert({
      house_id: houseId,
      title,
      description,
      type: 'bill',
      related_id: billId,
      status: 'active',
      end_date: getVotingEndDate(),
    })
    .select('id, status')
    .single();

  if (createVotingError) {
    throw createVotingError;
  }

  const { error: billStatusError } = await supabase.rpc('update_bill_status', {
    p_bill_id: billId,
    p_new_status: 'Em votação',
  });

  if (billStatusError) {
    throw billStatusError;
  }

  return createdVoting;
};

const countVotes = (votes = []) =>
  votes.reduce(
    (totals, vote) => {
      if (vote.vote === 'Aprovar') {
        totals.approve += 1;
      } else if (vote.vote === 'Rejeitar') {
        totals.reject += 1;
      } else {
        totals.abstain += 1;
      }

      return totals;
    },
    { approve: 0, reject: 0, abstain: 0 }
  );

const finalizeSuggestionVoting = async (supabase, voting, approved) => {
  const { data: suggestion, error: suggestionError } = await supabase
    .from('bill_suggestions')
    .select('*')
    .eq('id', voting.related_id)
    .single();

  if (suggestionError) {
    throw suggestionError;
  }

  if (!approved) {
    const { error: suggestionUpdateError } = await supabase
      .from('bill_suggestions')
      .update({ status: 'rejeitada' })
      .eq('id', suggestion.id);

    if (suggestionUpdateError) {
      throw suggestionUpdateError;
    }

    return {
      approved: false,
      message: 'Sugestão rejeitada pela votação da casa legislativa.',
    };
  }

  const { error: billInsertError } = await supabase.from('bills').insert({
    title: suggestion.title,
    summary: suggestion.suggestion,
    full_text: suggestion.suggestion,
    author_id: suggestion.author_id,
    house_id: voting.house_id,
    author_role: 'Cidadão',
    status: 'Em tramitação',
    type: inferBillTypeFromTitle(suggestion.title),
  });

  if (billInsertError) {
    throw billInsertError;
  }

  const { error: suggestionApprovalError } = await supabase
    .from('bill_suggestions')
    .update({ status: 'aprovada' })
    .eq('id', suggestion.id);

  if (suggestionApprovalError) {
    throw suggestionApprovalError;
  }

  return {
    approved: true,
    message: 'Sugestão aprovada e convertida em projeto em tramitação.',
  };
};

export const finalizeParliamentVotingIfReady = async (
  supabase,
  { voting }
) => {
  const [{ data: votes, error: votesError }, memberCountResponse] =
    await Promise.all([
      supabase
        .from('parliament_voting_votes')
        .select('vote')
        .eq('voting_id', voting.id),
      supabase
        .from('parliament_members')
        .select('id', { count: 'exact', head: true })
        .eq('house_id', voting.house_id),
    ]);

  if (votesError) {
    throw votesError;
  }

  if (memberCountResponse.error) {
    throw memberCountResponse.error;
  }

  const seatCount = Math.max(memberCountResponse.count || 0, 1);
  const votingExpired =
    voting.end_date && new Date(voting.end_date).getTime() <= Date.now();

  if (!votingExpired && (votes?.length || 0) < seatCount) {
    return {
      finalized: false,
    };
  }

  const voteTotals = countVotes(votes || []);
  const approved = voteTotals.approve > voteTotals.reject;

  if (voting.type === 'bill' && voting.related_id) {
    const { error: billStatusError } = await supabase.rpc('update_bill_status', {
      p_bill_id: voting.related_id,
      p_new_status: approved ? 'Aprovado' : 'Rejeitado',
    });

    if (billStatusError) {
      throw billStatusError;
    }
  }

  if (voting.type === 'suggestion' && voting.related_id) {
    await finalizeSuggestionVoting(supabase, voting, approved);
  }

  const { error: closeVotingError } = await supabase
    .from('parliament_votings')
    .update({ status: 'closed' })
    .eq('id', voting.id);

  if (closeVotingError) {
    throw closeVotingError;
  }

  return {
    finalized: true,
    approved,
    message: approved
      ? 'Votação encerrada com aprovação.'
      : 'Votação encerrada com rejeição.',
  };
};
