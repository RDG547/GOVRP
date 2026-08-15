import { publishBillResultNews, publishBillProposedNews, publishBillVotingStartedNews } from './newsPublisher.js';

export const HOUSE_PRESIDENT_ROLES = [
  'Presidente da Câmara',
  'Presidente da Câmara dos Deputados',
  'Presidente do Senado',
];

export const HOUSE_VICE_PRESIDENT_ROLES = [
  'Vice-Presidente da Câmara dos Deputados',
  'Vice-Presidente do Senado',
  'Vice-Presidente do Senado Federal',
];

export const PARLIAMENT_LEADERSHIP_ROLES = [
  ...HOUSE_PRESIDENT_ROLES,
  ...HOUSE_VICE_PRESIDENT_ROLES,
];

export const PARLIAMENT_PANEL_ROLES = [
  'Deputado',
  'Senador',
  ...PARLIAMENT_LEADERSHIP_ROLES,
  'Admin',
  'Presidente',
];

export const canManageParliamentVoting = (role) =>
  role === 'Admin' || role === 'Presidente' || HOUSE_PRESIDENT_ROLES.includes(role);

export const PARLIAMENT_MANDATE_DURATION_LABEL = '1 mês';

export const PARLIAMENT_RULE_SECTIONS = [
  {
    id: 'commissions',
    title: 'Comissões e Inquéritos',
    description:
      'Cada Casa conta com comissões permanentes e temporárias, além de instrumentos de investigação parlamentar.',
    items: [
      'Comissões temporárias dependem de aprovação por maioria simples em plenário e de oficialização pelo Presidente da respectiva Casa.',
      'CPI e CPMI são instauradas por requerimento de um terço dos membros da Casa competente.',
      'Toda comissão de inquérito deve designar um Relator responsável pelo Relatório Final.',
    ],
  },
  {
    id: 'terms',
    title: 'Mandatos e Mesa Diretora',
    description:
      'A organização interna da Câmara e do Senado segue mandatos curtos e renováveis para os cargos legislativos.',
    items: [
      `Deputados Federais e Senadores exercem mandato de ${PARLIAMENT_MANDATE_DURATION_LABEL}.`,
      `A Câmara dos Deputados deve eleger Presidente e Vice-Presidente para mandatos de ${PARLIAMENT_MANDATE_DURATION_LABEL}.`,
      `O Senado Federal deve eleger Presidente e Vice-Presidente para mandatos de ${PARLIAMENT_MANDATE_DURATION_LABEL}.`,
    ],
  },
  {
    id: 'senate',
    title: 'Competência Privativa do Senado',
    description:
      'O Senado possui atribuições próprias em matérias político-institucionais de alta relevância.',
    items: [
      'Compete privativamente ao Senado processar e julgar Ministros do STF nos crimes de responsabilidade e nos processos de impeachment.',
    ],
  },
];

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const getFutureDate = (monthsAhead = 1) => {
  const date = new Date();
  date.setMonth(date.getMonth() + monthsAhead);
  return date.toISOString().slice(0, 10);
};

/**
 * Voting sessions last 24 hours maximum.
 */
const getVotingEndDate = () => {
  const date = new Date();
  date.setHours(date.getHours() + 24);
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

/**
 * Checks if a bill type is a PEC (requires 2/3 of BOTH houses).
 */
const isPEC = (billType = '') => {
  const normalized = billType.trim().toUpperCase();
  return normalized === 'PEC';
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

/**
 * Starts a bill voting session and publishes a news article.
 */
export const startBillVotingSessionWithNews = async (
  supabase,
  { billId, houseId, title, description, bill }
) => {
  const voting = await startBillVotingSession(supabase, { billId, houseId, title, description });
  
  // Publish news about the voting start
  if (bill) {
    try {
      const { data: house } = await supabase
        .from('parliament_houses')
        .select('name')
        .eq('id', houseId)
        .single();
      await publishBillVotingStartedNews(supabase, {
        bill,
        houseName: house?.name,
      });
    } catch (e) {
      console.error('Erro ao publicar notícia de votação:', e);
    }
  }
  return voting;
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
  const { data, error } = await supabase.rpc('finalize_bill_suggestion_voting', {
    p_voting_id: voting.id,
  });

  if (error) throw error;
  return data || {
    approved,
    message: approved
      ? 'Sugestão aprovada e convertida em projeto em tramitação.'
      : 'Sugestão rejeitada pela Casa legislativa.',
  };
};

/**
 * Gets the other house ID (for PEC dual-house flow).
 */
const getOtherHouseId = async (supabase, currentHouseId) => {
  const { data: houses, error } = await supabase
    .from('parliament_houses')
    .select('id')
    .neq('id', currentHouseId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return houses?.id || null;
};

/**
 * Checks if a PEC was approved by the other house already.
 */
const checkPECOtherHouseApproval = async (supabase, billId, currentHouseId) => {
  const { data: otherVoting, error } = await supabase
    .from('parliament_votings')
    .select('id, status, house_id')
    .eq('related_id', billId)
    .eq('type', 'bill')
    .eq('status', 'closed')
    .neq('house_id', currentHouseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!otherVoting) return null;

  // Check whether that voting resulted in approval
  const { data: votes, error: votesError } = await supabase
    .from('parliament_voting_votes')
    .select('vote')
    .eq('voting_id', otherVoting.id);

  if (votesError) throw votesError;

  const totals = countVotes(votes || []);
  // For PEC: need 2/3 approval
  const totalVoted = totals.approve + totals.reject + totals.abstain;
  const threshold = Math.ceil(totalVoted * 2 / 3);
  const wasApproved = totals.approve >= threshold && totals.approve > 0;

  return { wasApproved, houseId: otherVoting.house_id };
};

/**
 * Determines if a bill vote passed based on its type.
 * - PL: Simple majority (50%+1 of votes cast, excluding abstentions)
 * - PEC: 2/3 of ALL members in the house (abstention = against)
 */
const isBillApproved = (billType, voteTotals, seatCount) => {
  if (isPEC(billType)) {
    // PEC needs 2/3 of all members (including those who didn't vote - counted as abstention)
    const threshold = Math.ceil(seatCount * 2 / 3);
    return voteTotals.approve >= threshold;
  } else {
    // PL: simple majority of votes cast (abstentions don't count against)
    const votesDecisive = voteTotals.approve + voteTotals.reject;
    if (votesDecisive === 0) return false;
    const threshold = Math.floor(votesDecisive / 2) + 1;
    return voteTotals.approve >= threshold;
  }
};

/**
 * Finalizes a voting session if conditions are met:
 * - All members voted, OR
 * - 24h has passed (non-voters count as abstention)
 * 
 * For PEC: After first house approval, creates voting in the other house.
 * Only fully approved when both houses approve with 2/3.
 */
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
  const allVoted = (votes?.length || 0) >= seatCount;

  // Only finalize if all members voted OR the 24h period expired
  if (!votingExpired && !allVoted) {
    return {
      finalized: false,
    };
  }

  // If expired but not all voted, count non-voters as abstention
  const actualVotes = votes || [];
  const nonVoterAbstentions = Math.max(seatCount - actualVotes.length, 0);
  const voteTotals = countVotes(actualVotes);
  voteTotals.abstain += nonVoterAbstentions;

  // Determine if bill or suggestion
  if (voting.type === 'commission' && voting.related_id) {
    const { data, error } = await supabase.rpc('finalize_temporary_commission_voting', {
      p_commission_id: voting.related_id,
    });

    if (error) {
      throw error;
    }

    return {
      finalized: data?.success !== false,
      approved: Boolean(data?.approved),
      message: data?.message || 'Votação de comissão encerrada.',
    };
  }

  if (voting.type === 'bill' && voting.related_id) {
    // Fetch the bill to know its type
    const { data: bill, error: billFetchError } = await supabase
      .from('bills')
      .select('id, title, summary, full_text, type, author_id, house_id, house:parliament_houses(name)')
      .eq('id', voting.related_id)
      .single();

    if (billFetchError) throw billFetchError;

    const billType = bill?.type || 'PL';
    const approved = isBillApproved(billType, voteTotals, seatCount);

    if (isPEC(billType) && approved) {
      // PEC dual-house flow
      // Check if the other house already voted on this PEC
      const otherHouseResult = await checkPECOtherHouseApproval(supabase, bill.id, voting.house_id);

      if (otherHouseResult === null) {
        // Other house hasn't voted yet - send to the other house
        const otherHouseId = await getOtherHouseId(supabase, voting.house_id);

        if (otherHouseId) {
          // Close current voting by bypassing RLS
          await supabase.rpc('close_parliament_voting', { p_voting_id: voting.id });

          // Update bill status to indicate it's moving to the other house
          await supabase.rpc('update_bill_status', {
            p_bill_id: bill.id,
            p_new_status: 'Em votação (2ª Casa)',
          });

          // Start voting in the other house  
          const { data: otherHouse } = await supabase
            .from('parliament_houses')
            .select('name')
            .eq('id', otherHouseId)
            .single();

          await startBillVotingSession(supabase, {
            billId: bill.id,
            houseId: otherHouseId,
            title: `[2ª Casa] ${bill.title}`,
            description: `Votação de PEC proveniente da ${bill.house?.name || 'outra casa'}. Necessário 2/3 para aprovação.`,
          });

          // Override status back since startBillVotingSession sets to "Em votação"
          await supabase.rpc('update_bill_status', {
            p_bill_id: bill.id,
            p_new_status: 'Em votação (2ª Casa)',
          });

          return {
            finalized: true,
            approved: true,
            message: `PEC aprovada na ${bill.house?.name || 'casa de origem'}! Enviada para votação na ${otherHouse?.name || 'outra casa legislativa'}.`,
          };
        }
      } else if (otherHouseResult.wasApproved) {
        // Both houses approved! PEC now depends on presidential promulgation
        await supabase.rpc('update_bill_status', {
          p_bill_id: bill.id,
          p_new_status: 'Aguardando promulgação presidencial',
        });

        // Publish news, but don't push to the Official Gazette until the Executive acts
        try {
          await publishBillResultNews(supabase, {
            bill,
            approved: true,
            houseName: 'ambas as Casas Legislativas',
          });
        } catch (newsError) {
          console.error('Erro ao publicar notícia da PEC:', newsError);
        }

        // Close this voting by bypassing RLS
        await supabase.rpc('close_parliament_voting', { p_voting_id: voting.id });

        return {
          finalized: true,
          approved: true,
          message: 'PEC aprovada por ambas as casas do Parlamento e encaminhada para promulgação presidencial.',
        };
      } else {
        // Other house rejected - PEC is fully rejected
        await supabase.rpc('update_bill_status', {
          p_bill_id: bill.id,
          p_new_status: 'Rejeitado',
        });

        try {
          await publishBillResultNews(supabase, {
            bill,
            approved: false,
            houseName: 'Parlamento (rejeitada em uma das casas)',
          });
        } catch (newsError) {
          console.error('Erro ao publicar notícia de rejeição da PEC:', newsError);
        }

        // Close this voting by bypassing RLS
        await supabase.rpc('close_parliament_voting', { p_voting_id: voting.id });

        return {
          finalized: true,
          approved: false,
          message: 'PEC rejeitada. A outra casa legislativa já havia rejeitado esta proposta.',
        };
      }
    } else if (isPEC(billType) && !approved) {
      // PEC rejected in this house - fully rejected
      await supabase.rpc('update_bill_status', {
        p_bill_id: bill.id,
        p_new_status: 'Rejeitado',
      });

      try {
        await publishBillResultNews(supabase, {
          bill,
          approved: false,
          houseName: bill.house?.name,
        });
      } catch (newsError) {
        console.error('Erro ao publicar notícia de rejeição da PEC:', newsError);
      }
    } else {
      // Projetos de lei aprovados seguem para sanção presidencial
      const newStatus = approved ? 'Aguardando sanção presidencial' : 'Rejeitado';
      await supabase.rpc('update_bill_status', {
        p_bill_id: bill.id,
        p_new_status: newStatus,
      });

      try {
        await publishBillResultNews(supabase, {
          bill,
          approved,
          houseName: bill.house?.name,
        });
      } catch (newsError) {
        console.error('Erro ao publicar notícia do projeto:', newsError);
      }
    }
  }

  if (voting.type === 'suggestion' && voting.related_id) {
    const votesDecisive = voteTotals.approve + voteTotals.reject;
    const threshold = votesDecisive > 0 ? Math.floor(votesDecisive / 2) + 1 : 1;
    const approved = voteTotals.approve >= threshold;
    const result = await finalizeSuggestionVoting(supabase, voting, approved);
    return {
      finalized: result?.finalized ?? true,
      approved: result?.approved ?? approved,
      message: result?.message || (approved
        ? 'Sugestão aprovada e convertida em projeto.'
        : 'Sugestão rejeitada pela Casa.'),
    };
  }

  const { error: closeVotingError } = await supabase.rpc('close_parliament_voting', { p_voting_id: voting.id });

  if (closeVotingError) {
    throw closeVotingError;
  }

  // Re-calculate for message
  const totalDecisive = voteTotals.approve + voteTotals.reject;
  const simpleApproved = totalDecisive > 0 && voteTotals.approve > totalDecisive / 2;

  return {
    finalized: true,
    approved: simpleApproved,
    message: simpleApproved
      ? 'Votação encerrada com aprovação.'
      : 'Votação encerrada com rejeição.',
  };
};

/**
 * Checks all active votings and auto-closes any that have expired (24h passed).
 * Also fixes legacy votings whose end_date was set beyond 24h from creation.
 * Should be called periodically (e.g., on page load).
 */
export const autoCloseExpiredVotings = async (supabase) => {
  try {
    // First, fix any legacy votings with end_dates beyond 24h from creation
    const { data: activeVotings, error: activeError } = await supabase
      .from('parliament_votings')
      .select('id, created_at, end_date')
      .eq('status', 'active');

    if (!activeError && activeVotings) {
      for (const voting of activeVotings) {
        const createdAt = new Date(voting.created_at);
        const endDate = new Date(voting.end_date);
        const expectedEnd = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000); // 24h after creation
        
        // If end_date is more than 25h from creation (1h tolerance), fix it
        if (endDate.getTime() - createdAt.getTime() > 25 * 60 * 60 * 1000) {
          await supabase
            .from('parliament_votings')
            .update({ end_date: expectedEnd.toISOString() })
            .eq('id', voting.id);
        }
      }
    }

    // Now close expired votings
    const { data: expiredVotings, error } = await supabase
      .from('parliament_votings')
      .select('id, house_id, end_date, type, related_id, title, description, status')
      .eq('status', 'active')
      .lte('end_date', new Date().toISOString());

    if (error || !expiredVotings || expiredVotings.length === 0) return;

    for (const voting of expiredVotings) {
      try {
        await finalizeParliamentVotingIfReady(supabase, { voting });
      } catch (e) {
        console.error(`Erro ao finalizar votação expirada ${voting.id}:`, e);
      }
    }
  } catch (e) {
    console.error('Erro ao buscar votações expiradas:', e);
  }
};
