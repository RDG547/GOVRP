import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const local = Object.fromEntries(
  execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^"|"$/g, '')];
    })
);

if (!local.API_URL?.includes('127.0.0.1')) {
  throw new Error('Este teste só pode executar no Supabase local.');
}

const admin = createClient(local.API_URL, local.SECRET_KEY || local.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const checks = [];
const assert = (condition, label) => {
  if (!condition) throw new Error(`Falha: ${label}`);
  checks.push(label);
};
const rpc = async (client, name, args) => {
  const result = await client.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
};

// Execuções interrompidas podem deixar juízes de teste sem processos e alterar
// a distribuição seguinte. Desativa somente fixtures reconhecíveis deste teste.
const staleJudges = await admin.from('profiles')
  .select('id,titles')
  .eq('role', 'Juiz')
  .or('username.ilike.juiza%,username.ilike.juizb%');
if (staleJudges.error) throw staleJudges.error;
for (const staleJudge of staleJudges.data || []) {
  const titles = (staleJudge.titles || []).filter((title) => title.toLocaleLowerCase('pt-BR') !== 'juiz');
  const disabled = await admin.from('profiles').update({ role: 'Cidadão', titles }).eq('id', staleJudge.id);
  if (disabled.error) throw disabled.error;
}

const createActor = async (label, role) => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `justice-${label}-${suffix}@govrp.local`;
  const password = `Govrp!${crypto.randomUUID()}Aa1`;
  // Deterministic ordering of this isolated roster, without changing other users' roles.
  const fixtureId = role === 'Juiz' ? `00000000-0000-4000-8000-${crypto.randomUUID().replaceAll('-', '').slice(0,12)}` : undefined;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, ...(fixtureId ? { id: fixtureId } : {}) });
  if (fixtureId && created.data.user?.id !== fixtureId) throw new Error('O Auth local não aceitou o ID da fixture judicial.');
  if (created.error || !created.data.user) throw created.error || new Error('Conta de teste não criada.');
  const id = created.data.user.id;
  const profile = await admin.from('profiles').upsert({
    id,
    username: `${label}${suffix}`.slice(0, 20),
    full_name: `Teste ${label}`,
    role,
    onboarding_completed: true,
    onboarding_step: 'completed',
  }, { onConflict: 'id' });
  if (profile.error) throw profile.error;
  const client = createClient(local.API_URL, local.ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { id, client, role };
};

const [citizen, police, delegate, prosecutor, judgeA, judgeB] = await Promise.all([
  createActor('cidadao', 'Cidadão'),
  createActor('policial', 'Policial'),
  createActor('delegado', 'Delegado'),
  createActor('promotor', 'Promotor'),
  createActor('juiza', 'Juiz'),
  createActor('juizb', 'Juiz'),
]);

const actorsById = new Map([judgeA, judgeB].map((actor) => [actor.id, actor]));

const penalCode = await admin.from('penal_code').insert({
  code: `TEST-${crypto.randomUUID().slice(0, 8)}`,
  name: 'Delito funcional de teste',
  description: 'Tipo penal criado exclusivamente para validar o fluxo integrado de Justiça.',
  category: 'Teste',
  severity: 'medium',
  minimum_sentence_units: 1,
  maximum_sentence_units: 5,
  base_fine: 100,
  bail_allowed: true,
  suggested_regime: 'closed',
  security_level: 'high',
}).select('id').single();
if (penalCode.error) throw penalCode.error;

const facility = await admin.from('prison_facilities').insert({
  name: `Unidade funcional ${crypto.randomUUID().slice(0, 6)}`,
  description: 'Unidade temporária do teste de execução penal.',
  security_level: 'high',
  capacity: 20,
}).select('id').single();
if (facility.error) throw facility.error;
const wing = await admin.from('prison_wings').insert({
  facility_id: facility.data.id,
  name: 'Ala funcional',
  security_level: 'high',
  capacity: 10,
}).select('id').single();
if (wing.error) throw wing.error;
const cell = await admin.from('prison_cells').insert({
  wing_id: wing.data.id,
  code: `T-${crypto.randomUUID().slice(0, 5)}`,
  capacity: 2,
}).select('id').single();
if (cell.error) throw cell.error;

const occurrence = await rpc(citizen.client, 'create_police_occurrence', {
  p_title: 'Denúncia funcional integrada',
  p_description: 'Relato detalhado de um fato que deve percorrer toda a cadeia de polícia e Justiça.',
  p_occurrence_type: 'Crime contra o patrimônio',
  p_location: 'Distrito Federal',
  p_occurred_at: new Date().toISOString(),
  p_anonymous: false,
  p_priority: 'high',
  p_involved_people: [],
  p_witnesses: [],
  p_evidence: [],
});
assert(Boolean(occurrence?.id), 'cidadão registra ocorrência real');

await rpc(police.client, 'triage_police_occurrence', {
  p_occurrence_id: occurrence.id,
  p_action: 'accept',
  p_notes: 'Ocorrência aceita após conferência dos elementos iniciais apresentados.',
});
const investigation = await rpc(police.client, 'open_criminal_investigation', {
  p_occurrence_id: occurrence.id,
  p_summary: 'Investigação aberta para apurar autoria, materialidade e circunstâncias do fato narrado.',
  p_lead_officer_id: null,
});
assert(Boolean(investigation?.id), 'Polícia abre investigação vinculada');

await rpc(delegate.client, 'add_investigation_subject', {
  p_investigation_id: investigation.id,
  p_profile_id: citizen.id,
  p_subject_status: 'investigated',
  p_notify_subject: true,
  p_notes: 'Pessoa apontada pelos elementos preliminares, sem presunção automática de culpa.',
});
const evidence = await rpc(delegate.client, 'record_investigation_evidence', {
  p_investigation_id: investigation.id,
  p_evidence_type: 'document',
  p_title: 'Documento pericial lacrado',
  p_description: 'Documento verificado, registrado e lacrado pelo delegado responsável pela investigação.',
  p_file_url: null,
  p_evidence_hash: crypto.randomUUID().replaceAll('-', ''),
  p_seal: true,
});
assert(evidence?.status === 'sealed', 'prova é lacrada e preservada');
assert(/^[0-9a-f]{64}$/.test(evidence.evidence_hash), 'servidor calcula hash SHA-256 da prova');
const custody = await admin.from('evidence_custody_events').select('id').eq('evidence_id', evidence.id);
assert(!custody.error && custody.data.length === 1, 'coleta lacrada registra cadeia de custódia');
const unsealed = await rpc(delegate.client, 'record_investigation_evidence', {p_investigation_id:investigation.id,p_evidence_type:'document',p_title:'Prova para lacre posterior',p_description:'Documento registrado para validar lacre posterior e idempotência.',p_seal:false});
const deniedSeal = await citizen.client.rpc('seal_case_evidence',{p_evidence_id:unsealed.id,p_justification:'Tentativa sem autoridade institucional.'});
assert(Boolean(deniedSeal.error), 'cidadão não lacra prova de uma investigação');
await rpc(delegate.client,'seal_case_evidence',{p_evidence_id:unsealed.id,p_justification:'Lacre pela autoridade responsável pela investigação.'});
await rpc(delegate.client,'seal_case_evidence',{p_evidence_id:unsealed.id,p_justification:'Repetição da confirmação sem duplicar custódia.'});
const sealedEvents=await admin.from('evidence_custody_events').select('id').eq('evidence_id',unsealed.id).eq('event_type','sealed');
assert(sealedEvents.data?.length===1, 'lacre idempotente preserva uma única transição');

const resolvedInvestigation = await rpc(delegate.client, 'resolve_investigation', {
  p_investigation_id: investigation.id,
  p_outcome: 'indict',
  p_conclusion: 'O conjunto de provas lacradas indica materialidade e indícios suficientes de autoria para remessa ao Ministério Público.',
  p_recommended_action: 'Oferecimento de denúncia criminal conforme o tipo penal indicado.',
});
assert(resolvedInvestigation?.status === 'sent_to_prosecutor', 'delegado indicia e remete ao Ministério Público');

const criminalCase = await rpc(prosecutor.client, 'file_criminal_charges', {
  p_investigation_id: investigation.id,
  p_defendant_id: citizen.id,
  p_title: 'Ação penal funcional de teste',
  p_facts: 'O Ministério Público descreve os fatos, individualiza a conduta e apresenta a acusação com base na prova preservada durante a investigação.',
  p_charges: [{
    penal_code_id: penalCode.data.id,
    description: 'Imputação funcional baseada no conjunto probatório lacrado.',
    requested_sentence: 2,
    attempted: false,
  }],
});
assert(Boolean(criminalCase?.id && criminalCase?.judge_id), 'MP oferece denúncia e processo recebe juiz imparcial');
const forwardedProof=await prosecutor.client.from('case_evidence').select('id,investigation_id,evidence_hash').eq('id',evidence.id).single();
assert(!forwardedProof.error && forwardedProof.data.investigation_id===criminalCase.investigation_id && forwardedProof.data.evidence_hash===evidence.evidence_hash, 'MP e processo consultam a mesma prova sem cópia ou perda de hash');

const assignedJudge = actorsById.get(criminalCase.judge_id);
assert(Boolean(assignedJudge), 'juiz distribuído pertence ao quadro elegível');
const appellateJudge = assignedJudge.id === judgeA.id ? judgeB : judgeA;

const admittedCase = await rpc(assignedJudge.client, 'decide_charge_admission', {
  p_case_id: criminalCase.id,
  p_admitted: true,
  p_reason: 'A denúncia descreve fato típico, individualiza a conduta e está apoiada por justa causa suficiente para abertura da fase de defesa.',
});
assert(admittedCase?.status === 'initial_defense', 'juiz recebe denúncia e abre defesa');

const defense = await rpc(citizen.client, 'submit_case_document', {
  p_case_id: criminalCase.id,
  p_document_type: 'defense',
  p_title: 'Defesa inicial do acusado',
  p_body: 'A defesa contesta os fatos e requer a produção das provas necessárias ao esclarecimento integral do caso.',
  p_file_url: null,
  p_visibility: 'parties',
});
assert(defense?.document_type === 'defense', 'acusado apresenta defesa no processo');

const hearing = await rpc(assignedJudge.client, 'schedule_case_hearing', {
  p_case_id: criminalCase.id,
  p_hearing_type: 'instruction',
  p_rp_scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
  p_duration_minutes: 60,
  p_meeting_location: 'Sala de audiências virtual',
});
assert(hearing?.status === 'scheduled', 'juiz agenda audiência com participantes');
await rpc(assignedJudge.client, 'complete_case_hearing', {
  p_hearing_id: hearing.id,
  p_minutes: 'Audiência realizada com presença das partes, produção da prova requerida e encerramento regular da instrução processual.',
});

const sentence = await rpc(assignedJudge.client, 'issue_criminal_sentence', {
  p_case_id: criminalCase.id,
  p_defendant_id: citizen.id,
  p_result: 'conviction',
  p_legal_reasoning: 'A prova submetida ao contraditório confirma de maneira suficiente a materialidade e a autoria, com fundamentação individualizada e respeito à defesa.',
  p_final_sentence_units: 2,
  p_fine_amount: 100,
  p_prison_regime: 'closed',
  p_special_justification: null,
});
assert(sentence?.status === 'appealable', 'sentença abre prazo de recurso');

const appeal = await rpc(citizen.client, 'file_case_appeal', {
  p_case_id: criminalCase.id,
  p_appeal_type: 'ordinary',
  p_arguments: 'A defesa recorre da valoração da prova e pede revisão integral da decisão condenatória proferida em primeiro grau.',
});
assert(appeal?.status === 'filed', 'defesa protocola recurso no prazo');

const decidedAppeal = await rpc(appellateJudge.client, 'decide_case_appeal', {
  p_appeal_id: appeal.id,
  p_outcome: 'denied',
  p_decision: 'O órgão revisor examina os argumentos, preserva o contraditório e mantém a condenação por considerar suficiente e coerente o conjunto probatório.',
});
assert(decidedAppeal?.status === 'denied', 'recurso é julgado por juiz diferente');

const sentenceWarrant = await admin.from('warrants').select('*').eq('sentence_id', sentence.id).single();
if (sentenceWarrant.error) throw sentenceWarrant.error;
assert(sentenceWarrant.data.status === 'issued', 'sentença definitiva expede mandado antes da custódia');
await rpc(police.client, 'execute_arrest_warrant', { p_warrant_id: sentenceWarrant.data.id, p_location: 'Praça da República', p_description: 'Mandado cumprido com identificação do alvo, registro da diligência e condução regular.' });
await rpc(police.client, 'execute_arrest_warrant', { p_warrant_id: sentenceWarrant.data.id, p_location: 'Praça da República', p_description: 'Mandado cumprido com identificação do alvo, registro da diligência e condução regular.' });
assert((await admin.from('arrests').select('id').eq('warrant_id',sentenceWarrant.data.id)).data.length===1,'repetir cumprimento não duplica prisão');
const activeTerm = await admin.from('prison_terms')
  .select('id, custody_status')
  .eq('sentence_id', sentence.id)
  .single();
if (activeTerm.error) throw activeTerm.error;
assert(['awaiting_intake', 'serving'].includes(activeTerm.data.custody_status), 'sentença definitiva entra em execução penal');

// Advance only this fixture's deadline; the real cron must perform the release without an RPC from the prisoner.
const shortened = await admin.from('prison_terms').update({expected_release_at:new Date(Date.now()+2000).toISOString()}).eq('id',activeTerm.data.id);
if(shortened.error) throw shortened.error;
let released;
for(let attempt=0;attempt<100;attempt++) {
  const state=await admin.from('prison_terms').select('custody_status').eq('id',activeTerm.data.id).single();
  if(state.error) throw state.error;
  released=state.data;
  if(released.custody_status==='released') break;
  await new Promise(resolve=>setTimeout(resolve,200));
}
assert(released?.custody_status === 'released', 'cron encerra custódia pelo prazo mesmo com preso offline');

const [timelineResult, directMutation] = await Promise.all([
  citizen.client.from('case_timeline_events').select('event_type,status_from,status_to').eq('case_id', criminalCase.id).order('created_at'),
  citizen.client.from('criminal_cases').update({ status: 'acquitted' }).eq('id', criminalCase.id).select('id'),
]);
const caseResult = await admin.from('criminal_cases').select('status').eq('id', criminalCase.id).single();
/*
 * O PostgREST representa um UPDATE filtrado por RLS como sucesso sem linhas,
 * por isso a garantia é conferida tanto pela resposta vazia quanto pelo estado final.
 */
/* c8 ignore next */
if (caseResult.error || timelineResult.error) throw caseResult.error || timelineResult.error;
assert(caseResult.data.status === 'served', 'processo encerra como pena cumprida');
assert(timelineResult.data.length >= 10, 'timeline factual reúne toda a cadeia processual');
assert(Boolean(directMutation.error) || directMutation.data?.length === 0, 'cidadão não altera status judicial diretamente');

process.stdout.write(`✓ ${checks.length} testes reais do fluxo completo de Justiça concluídos.\n`);
