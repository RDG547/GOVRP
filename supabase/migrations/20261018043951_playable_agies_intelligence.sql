begin;
-- The existing missions table remains the source of intelligence operations.
create table public.agies_clearances(user_id uuid primary key references public.profiles(id) on delete cascade,rank text not null check(rank in ('coordinator','analyst','agent')),granted_by uuid references public.profiles(id),created_at timestamptz not null default now());
create function public.has_agies_access() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (public.has_full_admin_access() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.deleted_at is null and p.role in ('Agente Secreto','Comandante da Agência de Inteligência')));
$$;
create function private.agies_manager() returns boolean language sql stable security definer set search_path='' as $$
 select public.has_full_admin_access() or (public.has_agies_access() and (public.get_user_role(auth.uid())='Comandante da Agência de Inteligência' or exists(select 1 from public.agies_clearances where user_id=auth.uid() and rank='coordinator')));
$$;
revoke all on function public.has_agies_access() from public,anon;grant execute on function public.has_agies_access() to authenticated;
revoke all on function private.agies_manager() from public,anon;grant execute on function private.agies_manager() to authenticated;
alter table public.agies_missions add column target_kind text check(target_kind in ('citizen','party','company','event','institution')),add column target_id uuid,add column operation_type text check(operation_type in ('political','economic','counterintelligence','financial')),add column justification text,add column classification text not null default 'confidential' check(classification in ('restricted','confidential','secret')),add column strategy text not null default 'balanced' check(strategy in ('discreet','balanced','intensive')),add column budget numeric not null default 0,add column risk integer not null default 10 check(risk between 0 and 100),add column quality integer not null default 0 check(quality between 0 and 100),add column approved_by uuid references public.profiles(id),add column judicial_request_id uuid references public.judicial_requests(id),add column result jsonb not null default '{}',add column collected_at timestamptz,add column idempotency_key uuid unique;
alter table public.agies_missions add constraint agies_operation_target check(target_kind is null or target_id is not null or target_kind in ('event','institution'));
create table public.agies_dossiers(id uuid primary key default gen_random_uuid(),mission_id uuid unique not null references public.agies_missions(id) on delete cascade,responsible_id uuid references public.profiles(id),classification text not null,target_kind text not null,target_id uuid,confirmed jsonb not null default '{}',unconfirmed jsonb not null default '[]',reliability integer not null check(reliability between 0 and 100),status text not null default 'open',history jsonb not null default '[]',created_at timestamptz not null default now());
create table public.agies_reports(id uuid primary key default gen_random_uuid(),number bigint generated always as identity unique,mission_id uuid unique not null references public.agies_missions(id) on delete cascade,author_id uuid references public.profiles(id),classification text not null,summary text not null,conclusion text not null,created_at timestamptz not null default now());
create table public.agies_report_recipients(report_id uuid references public.agies_reports(id) on delete cascade,user_id uuid references public.profiles(id) on delete cascade,shared_by uuid references public.profiles(id),created_at timestamptz not null default now(),primary key(report_id,user_id));
create table public.agies_tasks(id uuid primary key default gen_random_uuid(),mission_id uuid not null references public.agies_missions(id) on delete cascade,agent_id uuid not null references public.profiles(id),kind text not null check(kind in ('documents','decode','patterns','planning','counterintelligence')),challenge jsonb not null,started_at timestamptz not null default clock_timestamp(),ready_at timestamptz not null,completed_at timestamptz,score integer check(score between 0 and 100),unique(mission_id,kind));
create table private.agies_task_answers(task_id uuid primary key references public.agies_tasks(id) on delete cascade,answer jsonb not null);
revoke all on private.agies_task_answers from public,anon,authenticated;
insert into public.system_settings(key,value,description) values('agies_rules','{"simple_hours":2,"complex_hours":6,"daily_operations":3,"concurrent_operations":2,"base_cost":100,"daily_budget":50000,"task_seconds":30,"maximum_tasks":5,"financial_access_hours":24}','Operações ficcionais: duração real, limites por agente, custos pagos pelo Tesouro e acesso condicionado à Justiça.') on conflict do nothing;

-- RLS controls all deliveries, including Realtime. Mutations go through validated RPCs.
do $$ declare p record;t text;begin
 for p in select policyname from pg_policies where schemaname='public' and tablename='agies_missions' loop execute format('drop policy %I on public.agies_missions',p.policyname);end loop;
 foreach t in array array['agies_missions','agies_clearances','agies_dossiers','agies_reports','agies_report_recipients','agies_tasks'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy agies_authorized_read on public.agies_missions for select to authenticated using((select public.has_agies_access()));
create policy agies_clearances_read on public.agies_clearances for select to authenticated using((select public.has_agies_access()));
create policy agies_dossiers_read on public.agies_dossiers for select to authenticated using((select public.has_agies_access()));
create policy agies_reports_read on public.agies_reports for select to authenticated using((select public.has_agies_access()) or exists(select 1 from public.agies_report_recipients r where r.report_id=id and r.user_id=(select auth.uid()) and public.get_user_role(auth.uid()) in ('Policial','Delegado','Promotor','Juiz','Presidente')));
create policy agies_recipients_read on public.agies_report_recipients for select to authenticated using((select public.has_agies_access()) or user_id=(select auth.uid()));
create policy agies_tasks_read on public.agies_tasks for select to authenticated using((select public.has_agies_access()));
create index agies_operations_agent_time on public.agies_missions(agent_id,created_at desc);
create index agies_tasks_operation on public.agies_tasks(mission_id);
create index agies_recipients_user on public.agies_report_recipients(user_id,report_id);

create function private.assert_agies() returns void language plpgsql security definer set search_path='' as $$
begin if not coalesce(public.has_agies_access(),false) then raise exception 'Acesso restrito a pessoal autorizado da AGIES.' using errcode='42501';end if;end $$;
revoke all on function private.assert_agies() from public,anon,authenticated;
create function private.agies_audit(p_action text,p_mission_id uuid,p_reason text,p_payload jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
begin perform public.justice_write_audit('agies.'||p_action,'agies_mission',p_mission_id,null,p_payload,coalesce(nullif(btrim(p_reason),''),'Operação institucional da AGIES.'));end $$;
revoke all on function private.agies_audit(text,uuid,text,jsonb) from public,anon,authenticated;

create function public.create_agies_operation(p_data jsonb,p_idempotency_key uuid) returns public.agies_missions language plpgsql security definer set search_path='' as $$
declare op public.agies_missions%rowtype;cfg jsonb;k text;target uuid;kind text;duration integer;today timestamptz;
begin
 perform private.assert_agies();
 if p_idempotency_key is null then raise exception 'Identifique a operação antes de enviar.';end if;
 perform pg_advisory_xact_lock(hashtextextended('agies-agent:'||auth.uid()::text,0));
 select * into op from public.agies_missions where idempotency_key=p_idempotency_key;
 if found then if op.agent_id<>auth.uid() then raise exception 'Identificador de outra operação.' using errcode='42501';end if;return op;end if;
 select value into cfg from public.system_settings where key='agies_rules';
 today:=date_trunc('day',clock_timestamp() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
 if (select count(*) from public.agies_missions where agent_id=auth.uid() and created_at>=today)>=(cfg->>'daily_operations')::int then raise exception 'Seu limite diário de operações foi atingido.';end if;
 if (select count(*) from public.agies_missions where agent_id=auth.uid() and status in ('awaiting_authorization','active'))>=(cfg->>'concurrent_operations')::int then raise exception 'Conclua uma operação antes de iniciar outra.';end if;
 kind:=p_data->>'type';k:=p_data->>'target_kind';target:=nullif(p_data->>'target_id','')::uuid;
 if length(btrim(coalesce(p_data->>'name','')))<5 or length(p_data->>'name')>120 or length(btrim(coalesce(p_data->>'justification','')))<30 or length(p_data->>'justification')>4000 or kind not in ('political','economic','counterintelligence','financial') or k not in ('citizen','party','company','event','institution') then raise exception 'Informe nome, tipo, alvo e uma justificativa de ao menos 30 caracteres.';end if;
 if (k='citizen' and not exists(select 1 from public.profiles where id=target and deleted_at is null and onboarding_completed)) or (k='party' and not exists(select 1 from public.political_parties where id=target and is_active)) or (k='company' and not exists(select 1 from public.businesses where id=target and status='active')) or (kind='financial' and k<>'citizen') then raise exception 'Escolha um alvo válido para o tipo de operação.';end if;
 duration:=case when kind='financial' or p_data->>'strategy'='intensive' then (cfg->>'complex_hours')::int else (cfg->>'simple_hours')::int end;
 insert into public.agies_missions(name,description,status,agent_id,target_kind,target_id,operation_type,justification,classification,strategy,budget,risk,idempotency_key)
 values(btrim(p_data->>'name'),left(coalesce(p_data->>'objective',''),2000),'awaiting_authorization',auth.uid(),k,target,kind,btrim(p_data->>'justification'),coalesce(p_data->>'classification','confidential'),coalesce(p_data->>'strategy','balanced'),(cfg->>'base_cost')::numeric*duration,case when kind='financial' then 35 when kind='counterintelligence' then 5 else 10 end+case p_data->>'strategy' when 'intensive' then 20 when 'discreet' then -5 else 0 end,p_idempotency_key) returning * into op;
 perform private.agies_audit('operation_created',op.id,op.justification,jsonb_build_object('target_kind',k,'target',target,'budget',op.budget));
 return op;
end $$;

create function public.authorize_agies_operation(p_mission_id uuid,p_approve boolean) returns public.agies_missions language plpgsql security definer set search_path='' as $$
declare op public.agies_missions%rowtype;cfg jsonb;hours integer;balance numeric;
begin
 perform private.assert_agies();if not private.agies_manager() then raise exception 'A autorização exige a direção ou coordenação da AGIES.' using errcode='42501';end if;
 select * into op from public.agies_missions where id=p_mission_id for update;
 if op.id is null then raise exception 'Operação não encontrada.';end if;
 if op.status<>'awaiting_authorization' then return op;end if;
 if not p_approve then update public.agies_missions set status='cancelled' where id=op.id returning * into op;return op;end if;
 select value into cfg from public.system_settings where key='agies_rules';
 perform pg_advisory_xact_lock(hashtext('agies-budget'));
 if coalesce((select sum(budget) from public.agies_missions where approved_by is not null and start_date>=date_trunc('day',clock_timestamp() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),0)+op.budget>(cfg->>'daily_budget')::numeric then raise exception 'O limite diário de recursos da AGIES foi atingido.';end if;
 select treasury_balance into balance from public.government_finances where id=1 for update;
 if balance is null or balance<op.budget then raise exception 'O Tesouro não possui saldo para custear esta operação.';end if;
 update public.government_finances set treasury_balance=treasury_balance-op.budget,updated_at=clock_timestamp() where id=1;
 hours:=case when op.operation_type='financial' or op.strategy='intensive' then (cfg->>'complex_hours')::int else (cfg->>'simple_hours')::int end;
 update public.agies_missions set status='active',approved_by=auth.uid(),start_date=clock_timestamp(),end_date=clock_timestamp()+make_interval(hours=>hours) where id=op.id returning * into op;
 perform private.agies_audit('operation_authorized',op.id,op.justification,jsonb_build_object('budget',op.budget,'ready_at',op.end_date));
 perform public.justice_notify(op.agent_id,'agies_operation_authorized','Sua operação foi autorizada. As atividades já estão disponíveis.','/services/agies',jsonb_build_object('mission_id',op.id));
 return op;
end $$;

create function public.start_agies_task(p_mission_id uuid,p_kind text) returns public.agies_tasks language plpgsql security definer set search_path='' as $$
declare op public.agies_missions%rowtype;t public.agies_tasks%rowtype;options jsonb:='[]';correct jsonb:='[]';v integer;i integer;n integer;oid text;mode text;question text;cfg jsonb;
begin
 perform private.assert_agies();select * into op from public.agies_missions where id=p_mission_id for update;
 if op.id is null or (op.agent_id<>auth.uid() and not private.agies_manager()) then raise exception 'Você não está designado para esta operação.' using errcode='42501';end if;
 if op.status<>'active' then raise exception 'A operação precisa estar autorizada e em andamento.';end if;
 select * into t from public.agies_tasks where mission_id=op.id and kind=p_kind;if found then return t;end if;
 if p_kind not in ('documents','decode','patterns','planning','counterintelligence') then raise exception 'Atividade de inteligência inválida.';end if;
 select value into cfg from public.system_settings where key='agies_rules';
 if exists(select 1 from public.agies_tasks where mission_id=op.id and completed_at is null) then raise exception 'Conclua sua atividade atual antes de iniciar outra.';end if;
 if p_kind in ('decode','patterns') then
  mode:='single';n:=2+floor(random()*8)::int;question:='Qual número completa a sequência fictícia: '||n||', '||n*2||', '||n*3||', …?';
  for i in 1..4 loop oid:=gen_random_uuid()::text;v:=n*(i+2);options:=options||jsonb_build_array(jsonb_build_object('id',oid,'label',v::text));if i=2 then correct:=jsonb_build_array(oid);end if;end loop;
 elsif p_kind='planning' then
  mode:='single';question:='Selecione o plano de menor exposição: some risco de rota e de comunicação.';n:=999;
  for i in 1..4 loop oid:=gen_random_uuid()::text;v:=i*7+floor(random()*5)::int;options:=options||jsonb_build_array(jsonb_build_object('id',oid,'label','Plano '||i||': rota '||v||' + comunicação '||i*3));if v+i*3<n then n:=v+i*3;correct:=jsonb_build_array(oid);end if;end loop;
 else
  mode:='multiple';question:=case when p_kind='documents' then 'Selecione somente registros confirmados por duas fontes independentes (fontes ≥ 2).' else 'Selecione apenas sinais fictícios inconsistentes (divergência acima de 50).' end;
  for i in 1..5 loop oid:=gen_random_uuid()::text;v:=case when p_kind='documents' then floor(random()*4)::int else floor(random()*100)::int end;options:=options||jsonb_build_array(jsonb_build_object('id',oid,'label','Registro '||i||': '||v));if (p_kind='documents' and v>=2) or (p_kind='counterintelligence' and v>50) then correct:=correct||jsonb_build_array(oid);end if;end loop;
 end if;
 select jsonb_agg(item order by random()) into options from jsonb_array_elements(options) item;
 insert into public.agies_tasks(mission_id,agent_id,kind,challenge,ready_at) values(op.id,auth.uid(),p_kind,jsonb_build_object('mode',mode,'question',question,'options',options),clock_timestamp()+make_interval(secs=>(cfg->>'task_seconds')::int)) returning * into t;
 insert into private.agies_task_answers(task_id,answer) values(t.id,correct);
 perform private.agies_audit('task_started',op.id,op.justification,jsonb_build_object('task',t.id,'kind',p_kind));return t;
end $$;

create function public.finish_agies_task(p_task_id uuid,p_answer jsonb) returns public.agies_tasks language plpgsql security definer set search_path='' as $$
declare t public.agies_tasks%rowtype;expected jsonb;correct integer;wrong integer;result_score integer;
begin
 perform private.assert_agies();select * into t from public.agies_tasks where id=p_task_id for update;
 if t.id is null or t.agent_id<>auth.uid() then raise exception 'Esta atividade não pertence à sua conta.' using errcode='42501';end if;
 if t.completed_at is not null then return t;end if;
 if t.ready_at>clock_timestamp() then raise exception 'A análise ainda está em execução. Aguarde o tempo indicado.';end if;
 if not exists(select 1 from public.agies_missions where id=t.mission_id and status='active') then raise exception 'A operação já foi encerrada.';end if;
 if jsonb_typeof(p_answer) is distinct from 'array' or jsonb_array_length(p_answer)>10 or exists(select 1 from jsonb_array_elements(p_answer) a where jsonb_typeof(a)<>'string') or (select count(*) from jsonb_array_elements_text(p_answer))<>(select count(distinct value) from jsonb_array_elements_text(p_answer)) or exists(select 1 from jsonb_array_elements_text(p_answer) a where not exists(select 1 from jsonb_array_elements(t.challenge->'options') o where o->>'id'=a)) then raise exception 'Envie somente as opções disponíveis, sem repetir respostas.';end if;
 select answer into expected from private.agies_task_answers where task_id=t.id;
 select count(*) filter(where expected ? a),count(*) filter(where not expected ? a) into correct,wrong from jsonb_array_elements_text(p_answer) a;
 result_score:=case when jsonb_array_length(expected)=0 and jsonb_array_length(p_answer)=0 then 100 else greatest(0,least(100,floor((correct-wrong)*100.0/greatest(jsonb_array_length(expected),1)))) end;
 update public.agies_tasks set completed_at=clock_timestamp(),score=result_score where id=t.id returning * into t;
 update public.agies_missions set quality=least(95,20+coalesce((select floor(avg(score)*.75) from public.agies_tasks where mission_id=t.mission_id and completed_at is not null),0)) where id=t.mission_id;
 perform private.agies_audit('task_completed',t.mission_id,'Análise de inteligência validada no servidor.',jsonb_build_object('task',t.id,'score',result_score));return t;
end $$;

create function public.request_agies_financial_authorization(p_mission_id uuid,p_investigation_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare op public.agies_missions%rowtype;request_id uuid;
begin
 perform private.assert_agies();if not private.agies_manager() then raise exception 'O pedido exige a direção da AGIES.' using errcode='42501';end if;
 select * into op from public.agies_missions where id=p_mission_id for update;
 if op.id is null or op.operation_type<>'financial' or op.status<>'active' then raise exception 'Selecione uma operação financeira ativa.';end if;
 if op.judicial_request_id is not null then return op.judicial_request_id;end if;
 if not exists(select 1 from public.criminal_investigations where id=p_investigation_id and status not in ('closed','archived')) or not exists(select 1 from public.investigation_subjects where investigation_id=p_investigation_id and profile_id=op.target_id) then raise exception 'Vincule uma investigação policial aberta na qual o alvo esteja formalmente cadastrado.';end if;
 insert into public.judicial_requests(request_type,requested_by,investigation_id,target_profile_id,justification,expires_at,metadata)
 values('rp_confidentiality_break',auth.uid(),p_investigation_id,op.target_id,op.justification,clock_timestamp()+interval '24 hours',jsonb_build_object('agies_mission_id',op.id,'scope','rp_bank_transactions','limit',100)) returning id into request_id;
 update public.agies_missions set judicial_request_id=request_id where id=op.id;
 perform private.agies_audit('judicial_authorization_requested',op.id,op.justification,jsonb_build_object('request',request_id,'investigation',p_investigation_id));
 perform public.justice_notify(p.id,'agies_judicial_request','Pedido de acesso financeiro fictício aguarda decisão judicial.','/services/justice?view=authority',jsonb_build_object('request_id',request_id)) from public.profiles p where p.role='Juiz' and p.deleted_at is null;
 return request_id;
end $$;

create function private.agies_financial_authorized(p_mission_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_agies_access() and exists(select 1 from public.agies_missions m join public.judicial_requests r on r.id=m.judicial_request_id where m.id=p_mission_id and (m.agent_id=auth.uid() or private.agies_manager()) and m.operation_type='financial' and r.request_type='rp_confidentiality_break' and r.status='approved' and r.target_profile_id=m.target_id and r.metadata->>'agies_mission_id'=m.id::text and r.expires_at>clock_timestamp() and r.decided_by is not null and r.decided_by<>r.requested_by and r.decided_by<>r.target_profile_id and m.status in ('active','completed','exposed'));
$$;
revoke all on function private.agies_financial_authorized(uuid) from public,anon,authenticated;

create function public.collect_agies_operation(p_mission_id uuid) returns public.agies_dossiers language plpgsql security definer set search_path='' as $$
declare op public.agies_missions%rowtype;d public.agies_dossiers%rowtype;evidence jsonb:='{}';exposed boolean;
begin
 perform private.assert_agies();select * into op from public.agies_missions where id=p_mission_id for update;
 if op.id is null or (op.agent_id<>auth.uid() and not private.agies_manager()) then raise exception 'Você não está designado para esta operação.' using errcode='42501';end if;
 select * into d from public.agies_dossiers where mission_id=op.id;if found then return d;end if;
 if op.status<>'active' or op.end_date>clock_timestamp() then raise exception 'A operação ainda está em andamento. Aguarde o prazo do servidor.';end if;
 if not exists(select 1 from public.agies_tasks where mission_id=op.id and completed_at is not null) then raise exception 'Conclua ao menos uma análise antes de coletar o resultado.';end if;
 if op.operation_type='financial' and not private.agies_financial_authorized(op.id) then raise exception 'O acesso financeiro exige autorização judicial vigente para este alvo e esta operação.' using errcode='42501';end if;
 if op.target_kind='citizen' then
  select jsonb_build_object('name',p.full_name,'role',p.role,'public_companies',(select coalesce(jsonb_agg(jsonb_build_object('name',b.name,'sector',b.business_type_id)),'[]') from public.businesses b where b.owner_id=p.id and b.status='active'),'public_party',(select jsonb_build_object('name',pp.name,'acronym',pp.acronym) from public.political_parties pp where pp.id=p.party_affiliation)) into evidence from public.profiles p where p.id=op.target_id;
 elsif op.target_kind='party' then select jsonb_build_object('name',name,'acronym',acronym,'ideology',ideology,'status',is_active) into evidence from public.political_parties where id=op.target_id;
 elsif op.target_kind='company' then select jsonb_build_object('name',name,'sector',business_type_id,'region',region_code,'status',status) into evidence from public.businesses where id=op.target_id;
 else evidence:=jsonb_build_object('objective',op.description,'scope','Análise de sinais e acontecimentos fictícios informados pelo agente.');end if;
 exposed:=random()*100<greatest(1,op.risk-op.quality*.15);
 insert into public.agies_dossiers(mission_id,responsible_id,classification,target_kind,target_id,confirmed,unconfirmed,reliability,history)
 values(op.id,op.agent_id,op.classification,op.target_kind,op.target_id,coalesce(evidence,'{}'),jsonb_build_array('Os dados apurados são indícios do RP; não comprovam crimes ou responsabilidade.'),op.quality,jsonb_build_array(jsonb_build_object('event','collected','at',clock_timestamp(),'agent',auth.uid()))) returning * into d;
 update public.agies_missions set status=case when exposed then 'exposed' else 'completed' end,collected_at=clock_timestamp(),result=jsonb_build_object('dossier_id',d.id,'exposed',exposed,'quality',op.quality) where id=op.id;
 perform private.agies_audit('operation_collected',op.id,op.justification,jsonb_build_object('dossier',d.id,'public_fields',array(select jsonb_object_keys(coalesce(evidence,'{}'))),'exposed',exposed));
 if exposed then perform public.justice_notify(op.agent_id,'agies_exposure','Uma operação fictícia apresentou sinais de exposição. Revise a estratégia.','/services/agies',jsonb_build_object('mission_id',op.id));end if;
 return d;
end $$;

create function public.get_agies_financial_evidence(p_mission_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.agies_missions%rowtype;result jsonb;
begin
 perform private.assert_agies();
 if length(btrim(coalesce(p_reason,'')))<20 or not private.agies_financial_authorized(p_mission_id) then raise exception 'A consulta exige fundamento e autorização judicial vigente.' using errcode='42501';end if;
 select * into op from public.agies_missions where id=p_mission_id;
 if op.end_date>clock_timestamp() then raise exception 'A coleta ainda não está disponível.';end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (select t.id,t.amount,t.type,t.created_at from public.transactions t join public.accounts a on a.id=t.from_account_id or a.id=t.to_account_id where a.user_id=op.target_id and t.created_at>=op.start_date-interval '7 days' and t.created_at<=op.end_date order by t.created_at desc limit 100)t;
 perform private.agies_audit('financial_data_accessed',op.id,p_reason,jsonb_build_object('target',op.target_id,'authorization',op.judicial_request_id,'fields',array['id','amount','type','created_at'],'count',jsonb_array_length(result)));
 return result;
end $$;

create function public.publish_agies_report(p_mission_id uuid,p_summary text,p_conclusion text) returns public.agies_reports language plpgsql security definer set search_path='' as $$
declare op public.agies_missions%rowtype;r public.agies_reports%rowtype;
begin
 perform private.assert_agies();select * into op from public.agies_missions where id=p_mission_id for update;
 if op.id is null or (op.agent_id<>auth.uid() and not private.agies_manager()) then raise exception 'Operação não autorizada para este agente.' using errcode='42501';end if;
 select * into r from public.agies_reports where mission_id=op.id;if found then return r;end if;
 if not exists(select 1 from public.agies_dossiers where mission_id=op.id) then raise exception 'Colete o dossiê antes de produzir o relatório.';end if;
 if length(btrim(coalesce(p_summary,'')))<20 or length(btrim(coalesce(p_conclusion,'')))<30 or length(p_summary)>4000 or length(p_conclusion)>8000 then raise exception 'Descreva o resumo e a conclusão, distinguindo fatos, indícios e hipóteses.';end if;
 insert into public.agies_reports(mission_id,author_id,classification,summary,conclusion) values(op.id,auth.uid(),op.classification,btrim(p_summary),btrim(p_conclusion)) returning * into r;
 perform private.agies_audit('report_published',op.id,p_summary,jsonb_build_object('report',r.id,'number',r.number));return r;
end $$;

create function public.share_agies_report(p_report_id uuid,p_recipient_id uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.agies_reports%rowtype;op public.agies_missions%rowtype;recipient public.profiles%rowtype;occ public.police_occurrences%rowtype;
begin
 perform private.assert_agies();if not private.agies_manager() then raise exception 'O compartilhamento exige a direção da AGIES.' using errcode='42501';end if;
 select * into r from public.agies_reports where id=p_report_id for update;
 select * into op from public.agies_missions where id=r.mission_id;
 select * into recipient from public.profiles where id=p_recipient_id and deleted_at is null and role in ('Policial','Delegado','Promotor','Juiz','Presidente');
 if recipient.id is null or r.id is null or length(btrim(coalesce(p_reason,'')))<20 then raise exception 'Selecione autoridade competente e fundamente o encaminhamento.';end if;
 if exists(select 1 from public.agies_report_recipients where report_id=r.id and user_id=recipient.id) then return r.id;end if;
 insert into public.agies_report_recipients(report_id,user_id,shared_by) values(r.id,recipient.id,auth.uid());
 if recipient.role in ('Policial','Delegado') then
  occ:=public.create_police_occurrence('Relatório AGIES nº '||r.number,r.summary||E'\n'||r.conclusion,'intelligence_referral','Encaminhamento institucional',clock_timestamp(),false,'normal',jsonb_build_array(jsonb_build_object('profile_id',op.target_id)), '[]','[]');
 end if;
 perform public.justice_notify(recipient.id,'agies_report_received','Relatório de Inteligência nº '||r.number||' disponível para análise institucional.','/services/agies/reports/'||r.id,jsonb_build_object('report_id',r.id,'occurrence_id',occ.id));
 perform private.agies_audit('report_shared',op.id,p_reason,jsonb_build_object('recipient',recipient.id,'report',r.id,'occurrence',occ.id));return r.id;
end $$;

create function public.get_agies_state() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_agies();
 return jsonb_build_object('server_now',clock_timestamp(),'manager',private.agies_manager(),'director',(public.has_full_admin_access() or public.get_user_role(auth.uid())='Comandante da Agência de Inteligência'),'missions',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from (select * from public.agies_missions order by created_at desc limit 100)m),'[]'),'dossiers',coalesce((select jsonb_agg(to_jsonb(d)) from (select * from public.agies_dossiers order by created_at desc limit 100)d),'[]'),'reports',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from public.agies_reports order by created_at desc limit 100)r),'[]'),'tasks',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from public.agies_tasks order by started_at desc limit 500)t),'[]'),'staff',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'rank',coalesce(c.rank,case when p.role='Comandante da Agência de Inteligência' then 'director' else 'agent' end))) from public.profiles p left join public.agies_clearances c on c.user_id=p.id where p.deleted_at is null and p.role in ('Agente Secreto','Comandante da Agência de Inteligência')),'[]'),'rules',(select value from public.system_settings where key='agies_rules'));
end $$;

create function public.manage_agies_clearance(p_user_id uuid,p_rank text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_agies();if not private.agies_manager() or (public.get_user_role(auth.uid())<>'Comandante da Agência de Inteligência' and not public.has_full_admin_access()) then raise exception 'Somente a direção pode definir permissões internas.' using errcode='42501';end if;
 if not exists(select 1 from public.profiles where id=p_user_id and role='Agente Secreto' and deleted_at is null) or p_rank not in ('coordinator','analyst','agent') then raise exception 'Selecione um agente e uma permissão interna válida.';end if;
 insert into public.agies_clearances(user_id,rank,granted_by) values(p_user_id,p_rank,auth.uid()) on conflict(user_id) do update set rank=excluded.rank,granted_by=excluded.granted_by;
 perform private.agies_audit('clearance_changed',null,'Atualização de permissão institucional.',jsonb_build_object('user',p_user_id,'rank',p_rank));
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_agies_operation','authorize_agies_operation','start_agies_task','finish_agies_task','request_agies_financial_authorization','collect_agies_operation','get_agies_financial_evidence','publish_agies_report','share_agies_report','get_agies_state','manage_agies_clearance') loop
 execute format('revoke all on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;
end $$;
-- Legacy transaction monitor is technical Admin only. Agency reads use scoped warrants above.

CREATE OR REPLACE FUNCTION public.get_user_transactions_for_admin(p_user_id uuid)
 RETURNS TABLE(id uuid, amount numeric, description text, created_at timestamp with time zone, type text, direction text, other_party_name text, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    user_account_id UUID;
    caller_role TEXT;
BEGIN
    IF NOT coalesce(public.has_full_admin_access(),false) THEN RAISE EXCEPTION 'Consulta técnica restrita ao Admin com acesso total.' USING errcode='42501';END IF;

    SELECT a.id INTO user_account_id FROM public.accounts a WHERE a.user_id = p_user_id;

    RETURN QUERY
    SELECT
        t.id,
        t.amount,
        t.description,
        t.created_at,
        t.type,
        CASE
            WHEN t.from_account_id = user_account_id THEN 'sent'
            WHEN t.to_account_id = user_account_id THEN 'received'
            WHEN t.metadata->>'card_id' IN (SELECT c.id::text FROM public.cards c WHERE c.user_id = p_user_id) THEN 'sent'
            ELSE 'other'
        END as direction,
        CASE
            WHEN t.type = 'transfer' THEN
              CASE
                WHEN t.from_account_id = user_account_id THEN (SELECT p.full_name FROM public.profiles p JOIN public.accounts a ON p.id = a.user_id WHERE a.id = t.to_account_id)
                ELSE (SELECT p.full_name FROM public.profiles p JOIN public.accounts a ON p.id = a.user_id WHERE a.id = t.from_account_id)
              END
            WHEN t.type LIKE '%purchase%' OR t.type LIKE '%subscription%' THEN
                (SELECT p.full_name FROM public.profiles p JOIN public.accounts a ON p.id = a.user_id WHERE a.id = t.to_account_id)
            WHEN t.type = 'admin_credit' THEN 'Administração'
            WHEN t.type = 'admin_debit' THEN 'Administração'
            ELSE NULL
        END as other_party_name,
        t.metadata
    FROM public.transactions t
    WHERE (user_account_id IS NOT NULL AND (t.from_account_id = user_account_id OR t.to_account_id = user_account_id))
       OR (t.metadata->>'card_id' IN (SELECT c.id::text FROM public.cards c WHERE c.user_id = p_user_id))
    ORDER BY t.created_at DESC
    LIMIT 100;
END;
$function$
;
revoke all on function public.get_user_transactions_for_admin(uuid) from public,anon;
grant execute on function public.get_user_transactions_for_admin(uuid) to authenticated;
alter publication supabase_realtime add table public.agies_clearances,public.agies_dossiers,public.agies_reports,public.agies_report_recipients,public.agies_tasks;
commit;
