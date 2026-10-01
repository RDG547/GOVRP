import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const parseLocalEnvironment = () => Object.fromEntries(
  execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [
        line.slice(0, separator),
        line.slice(separator + 1).trim().replace(/^"|"$/g, ''),
      ];
    })
);

const local = parseLocalEnvironment();
const url = local.API_URL;
const anonKey = local.ANON_KEY;
const serverKey = local.SECRET_KEY || local.SERVICE_ROLE_KEY;

if (!url || !anonKey || !serverKey) {
  throw new Error('Supabase local não está disponível.');
}

process.env.VITE_SUPABASE_URL = url;
process.env.VITE_SUPABASE_ANON_KEY = anonKey;
process.env.SUPABASE_SECRET_KEY = serverKey;

const adminClient = createClient(url, serverKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdElectionIds = [];
const createdElectionTypeIds = [];
const createdHouseIds = [];
const createdBillIds = [];
const createdOccurrenceIds = [];
const createdPartyIds = [];
const checks = [];

const assert = (condition, label) => {
  if (!condition) throw new Error(`Falha: ${label}`);
  checks.push(label);
};

const createTestUser = async (label, role = 'Cidadão') => {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `election-${label}-${suffix}@govrp.local`;
  const password = `Govrp!${crypto.randomUUID()}Aa1`;
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Teste ${label}`, username: `${label}${suffix}`.slice(0, 20) },
  });

  if (error || !data.user?.id) throw error || new Error(`Usuário ${label} não criado.`);
  createdUserIds.push(data.user.id);

  const { error: profileError } = await adminClient.from('profiles').upsert({
    id: data.user.id,
    full_name: `Teste ${label}`,
    username: `${label}${suffix.replaceAll('-', '')}`.slice(0, 20),
    role,
    onboarding_completed: true,
    onboarding_step: 'completed',
    titulo_eleitor: `TE-${suffix}`,
  }, { onConflict: 'id' });
  if (profileError) throw profileError;

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sessionData, error: sessionError } = await client.auth.signInWithPassword({ email, password });
  if (sessionError || !sessionData.session) throw sessionError || new Error('Sessão não criada.');

  return { id: data.user.id, client, accessToken: sessionData.session.access_token };
};

const invokeSyncEndpoint = async (authorization) => {
  const { syncElectionOfficesHandler } = await import('../server/elections/http.js');
  const request = {
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body: {},
  };
  let responseBody = '';
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value = '') { responseBody = value; },
  };

  await syncElectionOfficesHandler(request, response);
  return {
    status: response.statusCode,
    body: responseBody ? JSON.parse(responseBody) : {},
  };
};

try {
  const [candidate, voter, admin] = await Promise.all([
    createTestUser('candidate'),
    createTestUser('voter'),
    createTestUser('admin', 'Admin'),
  ]);

  const partyResult = await candidate.client.rpc('create_political_party', {
    p_name: `Partido Funcional ${Date.now()}`,
    p_acronym: `PF${String(Date.now()).slice(-3)}`,
    p_ideology: 'Desenvolvimento institucional',
    p_logo_url: '',
    p_statute: 'Estatuto funcional para validar a filiação e a candidatura partidária.',
    p_description: 'Partido temporário do cenário político completo.',
    p_orientation: 'Centro',
  });
  if (partyResult.error || !partyResult.data?.success) throw partyResult.error || new Error(partyResult.data?.message);
  const partyId = partyResult.data.party_id;
  createdPartyIds.push(partyId);
  const { count: membershipCount } = await adminClient.from('party_members')
    .select('party_id', { count: 'exact', head: true }).eq('party_id', partyId).eq('user_id', candidate.id);
  assert(membershipCount === 1, 'cidadão político cria partido e fica legitimamente filiado');

  let { data: electionType, error: typeError } = await adminClient
    .from('election_types')
    .select('id')
    .eq('name', 'Deputado')
    .maybeSingle();
  if (typeError) throw typeError;
  if (!electionType) {
    const createTypeResult = await adminClient.from('election_types').insert({
      name: 'Deputado',
      description: 'Tipo funcional de teste',
      voting_system: 'proportional',
      requires_vice_candidate: false,
      is_public_vote: true,
    }).select('id').single();
    if (createTypeResult.error) throw createTypeResult.error;
    electionType = createTypeResult.data;
    createdElectionTypeIds.push(electionType.id);
  }

  const { data: house, error: houseError } = await adminClient.from('parliament_houses').insert({
    name: 'Câmara dos Deputados - Teste',
    description: 'Casa criada pelo teste funcional',
  }).select('id').single();
  if (houseError) throw houseError;
  createdHouseIds.push(house.id);

  const now = Date.now();
  const { data: activeElection, error: electionError } = await adminClient.from('elections').insert({
    name: 'Eleicao funcional segura',
    description: 'Teste real de segurança eleitoral',
    election_type_id: electionType.id,
    candidacy_start_date: new Date(now - 3_600_000).toISOString(),
    candidacy_end_date: new Date(now + 3_600_000).toISOString(),
    voting_start_date: new Date(now + 7_200_000).toISOString(),
    voting_end_date: new Date(now + 10_800_000).toISOString(),
    status: 'Candidacy',
  }).select('id').single();
  if (electionError) throw electionError;
  createdElectionIds.push(activeElection.id);

  const {data: partyNumber}=await adminClient.from('political_parties').select('electoral_number').eq('id',partyId).single();
  const candidacy = await candidate.client.rpc('submit_candidacy', {
    p_election_id: activeElection.id,
    p_party_id: partyId,
    p_vice_candidate_id: null,
    p_political_name: 'Candidato Seguro',
    p_bio: 'Cidadão comprometido com o desenvolvimento do país.',
    p_proposals: 'Integração dos sistemas públicos e responsabilidade institucional.',
    p_campaign_photo_url: null,
    p_electoral_number: `${partyNumber.electoral_number}12`,
  });
  if (candidacy.error || !candidacy.data?.success) throw candidacy.error || new Error('Candidatura legítima não criada.');
  const approval = await admin.client.rpc('approve_candidacy', {
    p_candidate_id: candidacy.data.candidate_id,
    p_feedback: 'Candidatura validada no cenário funcional.',
  });
  if (approval.error || !approval.data?.success) throw approval.error || new Error('Candidatura legítima não aprovada.');
  const approvedCandidate = { id: candidacy.data.candidate_id };
  assert(true, 'candidatura partidária passa por solicitação e aprovação autoritativas');

  const { error: openVotingError } = await adminClient.from('elections').update({
    candidacy_end_date: new Date(now - 1_000).toISOString(),
    voting_start_date: new Date(now - 500).toISOString(),
    voting_end_date: new Date(now + 3_600_000).toISOString(),
    status: 'Voting',
  }).eq('id', activeElection.id);
  if (openVotingError) throw openVotingError;

  const directCandidateAttempt = await voter.client.from('candidates').insert({
    election_id: activeElection.id,
    user_id: voter.id,
    political_name: 'Fraude',
    status: 'Approved',
  });
  assert(Boolean(directCandidateAttempt.error), 'candidatura Approved direta é negada');

  const directVoteAttempt = await voter.client.from('votes').insert({
    election_id: activeElection.id,
    voter_id: voter.id,
    candidate_id: approvedCandidate.id,
  });
  assert(Boolean(directVoteAttempt.error), 'voto direto na tabela é negado');

  const firstVote = await voter.client.rpc('cast_vote', {
    p_election_id: activeElection.id,
    p_candidate_id: approvedCandidate.id,
  });
  assert(!firstVote.error && firstVote.data?.success === true, 'voto válido passa pela RPC');

  const duplicateVote = await voter.client.rpc('cast_vote', {
    p_election_id: activeElection.id,
    p_candidate_id: approvedCandidate.id,
  });
  assert(Boolean(duplicateVote.error), 'segundo voto do mesmo eleitor é negado');

  const { data: finishedElection, error: finishedError } = await adminClient.from('elections').insert({
    name: 'Eleicao encerrada funcional',
    description: 'Não aceita voto',
    election_type_id: electionType.id,
    candidacy_start_date: new Date(now - 14_400_000).toISOString(),
    candidacy_end_date: new Date(now - 10_800_000).toISOString(),
    voting_start_date: new Date(now - 7_200_000).toISOString(),
    voting_end_date: new Date(now - 3_600_000).toISOString(),
    status: 'Finished',
  }).select('id').single();
  if (finishedError) throw finishedError;
  createdElectionIds.push(finishedElection.id);

  const { data: finishedCandidate, error: finishedCandidateError } = await adminClient.from('candidates').insert({
    election_id: finishedElection.id,
    user_id: candidate.id,
    political_name: 'Candidato Encerrado',
    status: 'Approved',
  }).select('id').single();
  if (finishedCandidateError) throw finishedCandidateError;

  const finishedVote = await voter.client.rpc('cast_vote', {
    p_election_id: finishedElection.id,
    p_candidate_id: finishedCandidate.id,
  });
  assert(Boolean(finishedVote.error), 'eleição finalizada rejeita voto');

  const anonymousSync = await invokeSyncEndpoint();
  assert(anonymousSync.status === 401, 'sync-offices anônimo retorna 401');
  const citizenSync = await invokeSyncEndpoint(`Bearer ${voter.accessToken}`);
  assert(citizenSync.status === 403, 'sync-offices de cidadão retorna 403');

  const { error: finishActiveError } = await adminClient.from('elections').update({
    status: 'Finished',
    voting_end_date: new Date(Date.now() - 1_000).toISOString(),
  }).eq('id', activeElection.id);
  if (finishActiveError) throw finishActiveError;

  const adminSync = await invokeSyncEndpoint(`Bearer ${admin.accessToken}`);
  assert(adminSync.status === 200 && adminSync.body?.ok, 'Admin conclui a apuração pelo endpoint protegido');

  const [{ data: winnerProfile }, { data: untouchedVoter }, { data: settlement }] = await Promise.all([
    adminClient.from('profiles').select('role').eq('id', candidate.id).single(),
    adminClient.from('profiles').select('role').eq('id', voter.id).single(),
    adminClient.from('election_settlements').select('status, total_valid_votes, result').eq('election_id', activeElection.id).single(),
  ]);
  assert(winnerProfile?.role === 'Deputado', 'cargo é atribuído ao vencedor legítimo');
  assert(untouchedVoter?.role === 'Cidadão', 'tentativas de fraude não alteram o cargo do cidadão');
  assert(settlement?.status === 'settled' && Number(settlement.total_valid_votes) === 1, 'resultado oficial preserva somente voto válido');

  const { data: electedMember, error: electedMemberError } = await adminClient.from('parliament_members')
    .select('id,house_id').eq('user_id', candidate.id).gte('term_end_date', new Date().toISOString().slice(0, 10)).single();
  if (electedMemberError) throw electedMemberError;
  // Keep the law scenario independent of mandates left by other local test suites.
  const moved = await adminClient.from('parliament_members').update({ house_id: house.id }).eq('id', electedMember.id);
  if (moved.error) throw moved.error;
  electedMember.house_id = house.id;
  const officeNotices = await adminClient.from('notifications').select('id,type,metadata').eq('user_id', candidate.id).eq('metadata->>election_id', activeElection.id);
  if (officeNotices.error) throw officeNotices.error;
  assert(officeNotices.data.filter(notice => notice.type === 'role_changed').length === 1 && !officeNotices.data.some(notice => notice.type === 'office_awarded'), 'posse eleitoral gera um único aviso persistente de mudança de cargo');
  const proposedBill = await candidate.client.rpc('propose_parliament_bill_with_effect', {
    p_title: 'Lei funcional de integração nacional',
    p_summary: 'Projeto eleito que altera uma regra econômica real e auditável.',
    p_full_text: 'A regra de consumo do país passa a observar o valor estruturado aprovado pelo Parlamento.',
    p_type: 'PL',
    p_house_id: electedMember.house_id,
    p_effect_key: 'consumption_tax_rate',
    p_effect_operation: 'set',
    p_effect_value: 0.031,
    p_effect_explanation: 'A lei define uma alíquota de consumo mensurável para os sistemas econômicos.',
  });
  if (proposedBill.error) throw proposedBill.error;
  createdBillIds.push(proposedBill.data.id);
  const parliamentaryVoting = await admin.client.rpc('start_parliament_bill_voting', {
    p_bill_id: proposedBill.data.id,
    p_house_id: electedMember.house_id,
    p_title: proposedBill.data.title,
    p_description: 'Votação do projeto apresentado pelo parlamentar eleito.',
  });
  if (parliamentaryVoting.error) throw parliamentaryVoting.error;
  const parliamentaryVote = await candidate.client.rpc('cast_parliament_vote', {
    p_voting_id: parliamentaryVoting.data.id,
    p_member_id: electedMember.id,
    p_vote: 'Aprovar',
  });
  if (parliamentaryVote.error || !parliamentaryVote.data?.success) throw parliamentaryVote.error || new Error('Voto legislativo falhou.');
  const forwarded = await candidate.client.rpc('update_bill_status', {
    p_bill_id: proposedBill.data.id,
    p_new_status: 'Aguardando sanção presidencial',
  });
  if (forwarded.error) throw forwarded.error;
  const sanctioned = await admin.client.rpc('update_bill_status', {
    p_bill_id: proposedBill.data.id,
    p_new_status: 'Sancionado',
  });
  if (sanctioned.error) throw sanctioned.error;
  const [gazette, legalRule, politicalIndicator, popularityImpact] = await Promise.all([
    adminClient.from('dou_entries').select('id').eq('source_id', proposedBill.data.id).maybeSingle(),
    adminClient.from('government_rules').select('numeric_value,source_id').eq('rule_key', 'consumption_tax_rate').single(),
    adminClient.from('national_indicator_points').select('id').eq('source_table', 'bills').eq('source_id', proposedBill.data.id).limit(1),
    adminClient.from('government_popularity_events').select('id').eq('source_table', 'bills').eq('source_id', proposedBill.data.id).limit(1),
  ]);
  for (const result of [gazette, legalRule, politicalIndicator, popularityImpact]) if (result.error) throw result.error;
  assert(Boolean(gazette.data?.id), 'lei sancionada é publicada no Diário Oficial pelo backend');
  assert(Number(legalRule.data.numeric_value) === 0.031 && legalRule.data.source_id === proposedBill.data.id, 'lei sancionada altera uma regra real do país');
  assert(politicalIndicator.data.length > 0 && popularityImpact.data.length > 0, 'lei gera indicador e reação política mensuráveis');

  const { data: bill, error: billError } = await adminClient.from('bills').insert({
    title: 'Projeto funcional P0',
    summary: 'Valida o gatilho de indicador legislativo.',
    full_text: 'Texto integral do projeto funcional de validação.',
    author_id: admin.id,
    house_id: house.id,
    status: 'Em discussão',
  }).select('id').single();
  if (billError) throw billError;
  createdBillIds.push(bill.id);
  const billUpdate = await adminClient.from('bills').update({ status: 'Aprovado' }).eq('id', bill.id);
  if (billUpdate.error) throw billUpdate.error;
  assert(!billUpdate.error, 'mudança de projeto executa gatilho P0 sem erro');

  const { data: occurrence, error: occurrenceError } = await adminClient.from('police_occurrences').insert({
    type: 'Denúncia',
    title: 'Ocorrência funcional P0',
    details: 'Valida indicadores de segurança.',
    priority: 'high',
    status: 'Pendente',
  }).select('id').single();
  if (occurrenceError) throw occurrenceError;
  createdOccurrenceIds.push(occurrence.id);
  const { count: safetyPointCount, error: safetyPointError } = await adminClient
    .from('national_indicator_points')
    .select('id', { count: 'exact', head: true })
    .eq('source_table', 'police_occurrences')
    .like('source_id', `${occurrence.id}%`);
  assert(!safetyPointError && Number(safetyPointCount) >= 2, 'ocorrência grava indicadores nacionais reais');

  process.stdout.write(`✓ ${checks.length} testes eleitorais/P0 reais concluídos.\n`);
} finally {
  if (createdBillIds.length) {
    await adminClient.from('bills').delete().in('id', createdBillIds);
  }
  if (createdOccurrenceIds.length) {
    await adminClient.from('police_occurrences').delete().in('id', createdOccurrenceIds);
  }
  if (createdElectionIds.length) {
    await adminClient.from('election_office_assignments').delete().in('election_id', createdElectionIds);
    await adminClient.from('election_settlements').delete().in('election_id', createdElectionIds);
    await adminClient.from('votes').delete().in('election_id', createdElectionIds);
    await adminClient.from('candidates').delete().in('election_id', createdElectionIds);
    await adminClient.from('elections').delete().in('id', createdElectionIds);
  }
  if (createdElectionTypeIds.length) {
    await adminClient.from('election_types').delete().in('id', createdElectionTypeIds);
  }
  if (createdPartyIds.length) {
    await adminClient.from('political_parties').delete().in('id', createdPartyIds);
  }
  if (createdHouseIds.length) {
    await adminClient.from('parliament_houses').delete().in('id', createdHouseIds);
  }
  for (const userId of createdUserIds) {
    await adminClient.auth.admin.deleteUser(userId);
  }
}
