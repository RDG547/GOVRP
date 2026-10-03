import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { actor, local, service, request, rpc, cleanup } from './lib/world-test.mjs';

const sql = query => execFileSync('docker', ['exec', '-i', 'supabase_db_GOVRP', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' }).trim();
const anonymous = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let conversation;

try {
  const admin = await actor('advisor-admin', 'Admin');
  const citizen = await actor('advisor-citizen');
  const outsider = await actor('advisor-outsider');

  for (const name of ['get_public_dashboard_stats', 'get_public_economic_dashboard', 'get_citizen_rankings', 'get_server_now']) {
    assert.notEqual(await rpc(anonymous, name), undefined);
  }
  assert.equal((await anonymous.rpc('admin_pay_invoice', { p_invoice_id: crypto.randomUUID() })).error?.code, '42501');
  assert.equal((await anonymous.rpc('get_users_with_pending_invoices')).error?.code, '42501');
  console.log('✓ Consultas públicas funcionam; acesso administrativo anônimo é negado.');

  for (const client of [anonymous, citizen.client, admin.client]) {
    const award = await client.rpc('award_political_points', {
      p_user_id: citizen.id, p_event_type: 'election_win', p_related_id: crypto.randomUUID(), p_points: 999999,
    });
    assert.equal(award.error?.code, '42501', 'Nem Admin pode forjar concessão interna pela API');
    for (const name of ['process_citizen_income', 'process_weekly_service_bills', 'sync_political_point_awards', 'get_inmates']) {
      assert.equal((await client.rpc(name)).error?.code, '42501', name);
    }
  }
  assert.equal((await request(service.from('profiles').select('political_points').eq('id', citizen.id).single())).political_points || 0, 0);
  console.log('✓ Rotinas internas não podem conceder pontos, processar pagamentos ou alterar prisões via API.');

  conversation = await request(service.from('x_conversations').insert({}).select('id').single());
  await request(service.from('x_conversation_participants').insert({ conversation_id: conversation.id, user_id: citizen.id }));
  assert((await rpc(citizen.client, 'get_user_conversation_ids', { p_user: citizen.id })).includes(conversation.id));
  assert.deepEqual(await rpc(outsider.client, 'get_user_conversation_ids', { p_user: citizen.id }), []);
  assert.equal((await outsider.client.rpc('get_total_invested_by_user', { p_user_id: citizen.id })).error?.code, '42501');
  assert.equal(await rpc(citizen.client, 'get_total_invested_by_user', { p_user_id: citizen.id }), 0);
  assert.equal(await rpc(admin.client, 'get_total_invested_by_user', { p_user_id: citizen.id }), 0);
  console.log('✓ Conversas e investimentos respeitam titularidade; a consulta legítima do Admin foi preservada.');

  const result = sql(`begin;
    create function public.advisor_default_privilege_probe() returns integer language sql as 'select 1';
    do $test$ begin
      if has_function_privilege('anon','public.advisor_default_privilege_probe()','EXECUTE')
        or has_function_privilege('authenticated','public.advisor_default_privilege_probe()','EXECUTE') then
        raise exception 'Nova função foi exposta sem GRANT explícito';
      end if;
      if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname<>'advisor_default_privilege_probe' and p.prokind in('f','p')
        and not exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
        raise exception 'Função ainda herda search_path da sessão';
      end if;
    end $test$;
    create temp table profiles(id uuid,role text);
    insert into pg_temp.profiles values('${citizen.id}','Admin');
    insert into public.political_parties(id,name,acronym,founder_id,owner_id,president_id,registration_number)
      values('11111111-2222-4333-8444-555555555555','Partido de segurança '||gen_random_uuid(),'SEG',
        '${citizen.id}','${citizen.id}',null,'security-'||gen_random_uuid());
    set local role authenticated;
    set local search_path=pg_temp,public;
    select set_config('request.jwt.claim.sub','${citizen.id}',true);
    do $test$ declare denied boolean:=false;begin
      begin perform public.get_dashboard_growth_stats(); exception when others then denied:=true;end;
      if not denied then raise exception 'Tabela temporária conseguiu forjar autoridade';end if;
      perform set_config('request.jwt.claim.sub','',true);
      if (public.admin_pay_invoice(gen_random_uuid())->>'success')::boolean then raise exception 'Identidade nula passou pela autorização';end if;
      denied:=false;
      begin perform public.admin_get_all_users(); exception when others then denied:=true;end;
      if not denied then raise exception 'Identidade nula consultou dados administrativos';end if;
      denied:=false;
      begin perform public.get_admin_dashboard_stats(); exception when others then denied:=true;end;
      if not denied then raise exception 'Identidade nula consultou estatísticas administrativas';end if;
      denied:=false;
      begin perform public.admin_change_user_password('${citizen.id}',''); exception when others then denied:=true;end;
      if not denied then raise exception 'Identidade nula chegou à troca administrativa de senha';end if;
      if (public.delete_party('11111111-2222-4333-8444-555555555555')->>'success')::boolean then
        raise exception 'Identidade nula encerrou partido';end if;
      perform set_config('request.jwt.claim.sub','${outsider.id}',true);
      if (public.toggle_party_affiliation_mode('11111111-2222-4333-8444-555555555555','manual')->>'success')::boolean then
        raise exception 'Presidência vaga liberou alteração partidária a terceiro';end if;
      perform set_config('request.jwt.claim.sub','${admin.id}',true);
      perform public.configure_executive_transition_rules('{}');
    end $test$;
    rollback;`);
  assert(result.includes('ROLLBACK'));
  console.log('✓ Search path resistente a shadowing, identidade nula bloqueada e privilégios futuros fechados.');
} finally {
  if (conversation) await service.from('x_conversations').delete().eq('id', conversation.id);
  await cleanup();
}
