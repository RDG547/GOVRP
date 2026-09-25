import assert from 'node:assert/strict';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { actor, local, service, request, rpc, subscribe, waitFor, cleanup, ensureParliamentHouses } from './lib/world-test.mjs';

process.env.VITE_SUPABASE_URL = local.API_URL;
process.env.VITE_SUPABASE_ANON_KEY = local.ANON_KEY;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = local.ANON_KEY;
process.env.SUPABASE_SECRET_KEY = local.SECRET_KEY || local.SERVICE_ROLE_KEY;
const { adminUpdateUserHandler } = await import('../server/admin/http.js');
const { syncElectionOfficesState } = await import('../server/elections/http.js');
const sql = query => execFileSync('docker', ['exec', '-i', 'supabase_db_GOVRP', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8' });
const profile = id => request(service.from('profiles').select('id,role,full_name,username,titles,manual_role_override,role_assigned_at,role_assigned_by').eq('id', id).single());

async function update(admin, target, role, extra = {}) {
  const current = await profile(target.id);
  const session = (await admin.client.auth.getSession()).data.session;
  let body;
  const response = { statusCode: 200, setHeader() {}, end(value) { body = JSON.parse(value); } };
  await adminUpdateUserHandler({ method: 'POST', headers: { authorization: `Bearer ${session.access_token}` }, body: {
    userId: target.id, fullName: current.full_name, username: current.username, titles: current.titles, role, ...extra,
  } }, response);
  return { status: response.statusCode, body };
}

try {
  await ensureParliamentHouses();
  const admin = await actor('role-persistence-admin', 'Admin');
  const citizen = await actor('role-persistence-target');
  await request(service.from('election_types').upsert({ name: 'Presidente', description: 'Regressão local de cargo administrativo', voting_system: 'majoritarian', requires_vice_candidate: true }, { onConflict: 'name', ignoreDuplicates: true }));
  const type = await request(service.from('election_types').select('id').eq('name', 'Presidente').single());
  const time = days => new Date(Date.now() + days * 86400000).toISOString();
  const election = await request(service.from('elections').insert({ name: 'Persistência administrativa local', election_type_id: type.id, candidacy_start_date: time(-4), candidacy_end_date: time(-3), voting_start_date: time(-2), voting_end_date: time(-1) }).select('id').single());
  await request(service.from('election_settlements').insert({ election_id: election.id, status: 'settled', office_role: 'Presidente', result: [] }));
  const assignment = await request(service.from('election_office_assignments').insert({ election_id: election.id, profile_id: citizen.id, office_role: 'Vice-Presidente', term_starts_at: time(-1), term_ends_at: time(29) }).select('id').single());
  await request(service.from('profiles').update({ role: 'Vice-Presidente', manual_role_override: false, role_assigned_at: time(-1) }).eq('id', citizen.id));
  const events = [];
  await subscribe(citizen.client.channel(`admin-role-${citizen.id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${citizen.id}` }, payload => events.push(payload.new.role)));
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal((await update(admin, citizen, 'Deputado')).status, 200);
  const assigned = await profile(citizen.id);
  assert.equal(assigned.role, 'Deputado');
  await waitFor(() => events.includes('Deputado'), 'cargo no segundo cliente via Realtime');
  const token = (await admin.client.auth.getSession()).data.session.access_token;
  await syncElectionOfficesState({ accessToken: token });
  assert.equal((await profile(citizen.id)).role, 'Deputado', 'sincronização não pode restaurar a Vice-Presidência antiga');
  assert.equal((await request(service.from('election_office_assignments').select('status').eq('id', assignment.id).single())).status, 'revoked');
  assert.equal(assigned.manual_role_override, true);
  assert.equal(assigned.role_assigned_by, admin.id);
  console.log('OK Vice-Presidente → Deputado persiste após sincronização real, encerra vínculo antigo e propaga por Realtime.');

  assert.equal((await update(admin, citizen, 'Deputado', { fullName: 'Nome administrativo atualizado' })).status, 200);
  assert.equal((await profile(citizen.id)).role_assigned_at, assigned.role_assigned_at, 'editar nome não deve reiniciar a posse');
  assert.equal((await update(citizen, citizen, 'Admin')).status, 403);
  const denied = await citizen.client.rpc('admin_update_user', { p_user_id: citizen.id, p_full_name: 'Inválido', p_username: citizen.handle, p_role: 'Admin', p_titles: [] });
  assert(denied.error || denied.data?.success === false);
  assert.equal((await profile(citizen.id)).role, 'Deputado');
  const notices = await request(service.from('notifications').select('sender_id,metadata').eq('user_id', citizen.id).eq('type', 'role_changed').contains('metadata', { new_role: 'Deputado' }));
  assert.equal(notices.length, 1, 'reconciliação não deve duplicar a mudança de cargo');
  assert.equal(notices[0].sender_id, admin.id);
  console.log('OK edição sem troca preserva a posse; usuário comum é bloqueado; notificação única identifica o Admin.');

  assert.equal((await update(admin, citizen, 'Cidadão')).status, 200);
  const demoted = await profile(citizen.id);
  assert.equal(demoted.role, 'Cidadão');
  assert.equal(demoted.manual_role_override, true, 'exoneração administrativa também deve persistir');
  await syncElectionOfficesState({ accessToken: token });
  sql('select private.process_electoral_calendar(); select public.notify_election_results(); select public.refresh_parliament_leadership_terms();');
  assert.equal((await profile(citizen.id)).role, 'Cidadão');
  console.log('OK Cidadão persiste após nova sincronização e execução das tarefas automáticas do banco.');

  // Same RPC is used by both the HTTP endpoint and legacy administrative clients.
  const direct = await rpc(admin.client, 'admin_update_user', { p_user_id: citizen.id, p_full_name: demoted.full_name, p_username: demoted.username, p_role: 'Senador', p_titles: [] });
  assert.equal(direct.success, true);
  assert.equal((await profile(citizen.id)).role_assigned_by, admin.id);
  assert(await rpc(citizen.client, 'get_active_parliament_member_id', { p_user_id: citizen.id, p_house_id: 'fedcba09-8765-4321-0987-654321fedcba' }));
  console.log('OK RPC administrativa compartilha a mesma persistência e cria o mandato parlamentar.');

  const transactional = sql(`begin;
    select set_config('request.jwt.claim.sub','${admin.id}',true);
    do $checks$
    declare a uuid; f uuid; e uuid; c uuid; et uuid; result jsonb; stamp timestamptz; denied boolean;
    begin
      perform public.admin_update_user('${citizen.id}','Teste persistência','${citizen.handle}','Presidente','{}');
      select id into f from public.presidential_formation where user_id='${citizen.id}' and ended_at is null;
      perform public.admin_update_user('${citizen.id}','Nome corrigido','${citizen.handle}','Presidente','{}');
      if not exists(select 1 from public.presidential_formation where id=f and ended_at is null) then raise exception 'Edição reiniciou a formação'; end if;
      perform public.admin_update_user('${citizen.id}','Teste persistência','${citizen.handle}','Deputado','{}');
      insert into public.election_office_assignments(election_id,profile_id,office_role,term_starts_at,term_ends_at)
      values('${election.id}','${citizen.id}','Deputado',now()-interval '1 day',now()+interval '20 days') returning id into a;
      perform public.admin_update_user('${citizen.id}','Teste persistência','${citizen.handle}','Presidente da Câmara dos Deputados','{}');
      if not exists(select 1 from public.election_office_assignments where id=a and status='active') then raise exception 'Mesa perdeu mandato base'; end if;
      perform public.refresh_parliament_leadership_terms();
      if (select role from public.profiles where id='${citizen.id}')<>'Presidente da Câmara dos Deputados' then raise exception 'Mesa revertida'; end if;
      perform public.admin_update_user('${citizen.id}','Teste persistência','${citizen.handle}','Deputado','{}');
      perform public.refresh_parliament_leadership_terms();
      if (select role from public.profiles where id='${citizen.id}')<>'Deputado' then raise exception 'Mesa antiga restaurada'; end if;
      denied:=false;
      begin
        perform public.admin_update_user('${citizen.id}','Inválido','${admin.handle}','Juiz','{}');
      exception when unique_violation then denied:=true; end;
      if not denied or not exists(select 1 from public.election_office_assignments where id=a and status='active')
        or (select role from public.profiles where id='${citizen.id}')<>'Deputado' then raise exception 'Falha não foi atômica'; end if;
      -- Emulate a request already in flight from the old production code.
      update public.profiles set role='Vice-Presidente',manual_role_override=false,role_assigned_at=null,role_assigned_by=null where id='${citizen.id}';
      if (select role from public.profiles where id='${citizen.id}')<>'Deputado' then raise exception 'Código antigo reverteu Admin'; end if;
      -- A future legitimate election still takes office; this is not a permanent lock.
      select id into et from public.election_types where name='Deputado' limit 1;
      perform public.admin_update_user('${citizen.id}','Teste persistência','${citizen.handle}','Cidadão','{}');
      update public.profiles set role_assigned_at=now()-interval '2 days' where id='${citizen.id}';
      insert into public.elections(name,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date)
      values('Nova eleição legítima',et,now()-interval '4 hours',now()-interval '3 hours',now()-interval '2 hours',now()+interval '1 hour') returning id into e;
      insert into public.candidates(election_id,user_id,political_name,status) values(e,'${citizen.id}','Candidato','Approved') returning id into c;
      insert into public.votes(election_id,candidate_id,voter_id) values(e,c,'${citizen.id}');
      update public.elections set voting_end_date=now()-interval '1 second' where id=e;
      result:=public.settle_election_offices(e);
      if result->>'status'<>'settled' or (select role from public.profiles where id='${citizen.id}')<>'Deputado'
        or (select manual_role_override from public.profiles where id='${citizen.id}') then raise exception 'Nova eleição não assumiu'; end if;
      select role_assigned_at into stamp from public.profiles where id='${citizen.id}';
      perform public.settle_election_offices(e);
      if (select role_assigned_at from public.profiles where id='${citizen.id}') is distinct from stamp then raise exception 'Apuração repetida reiniciou posse'; end if;
    end $checks$;
    rollback;`);
  assert(transactional.includes('ROLLBACK'));
  console.log('OK formação preservada; Mesa mantém mandato; saída da Mesa persiste; rollback atômico; código antigo bloqueado; nova eleição assume uma única vez.');
} finally {
  await cleanup();
}
