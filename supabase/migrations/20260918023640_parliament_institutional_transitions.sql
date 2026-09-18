begin;
alter table public.bills add column author_party_snapshot jsonb;
alter table public.bills add column institutional_data jsonb not null default '{}'::jsonb;
create function private.snapshot_bill_party() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select jsonb_build_object('id',p.id,'name',p.name,'acronym',p.acronym,'logo_url',p.logo_url,'recorded_at',clock_timestamp()) into new.author_party_snapshot
 from public.party_members m join public.political_parties p on p.id=m.party_id where m.user_id=new.author_id and p.status<>'Encerrado' order by m.joined_at desc limit 1;
 new.author_party_snapshot:=coalesce(new.author_party_snapshot,jsonb_build_object('unaffiliated',true,'recorded_at',clock_timestamp()));
 return new;
end $$;
revoke all on function private.snapshot_bill_party() from public,anon,authenticated;
create trigger snapshot_bill_party before insert on public.bills for each row execute function private.snapshot_bill_party();
insert into public.system_settings(key,value,description) values('parliament_institutional_rules',
 '{"impeachment_approval_numerator":2,"impeachment_approval_denominator":3,"impeachment_duration_hours":24,"succession_roles":["Vice-Presidente","Presidente da Câmara dos Deputados","Presidente do Senado","Presidente do STF"]}',
 'Regra própria do RP: impeachment na Câmara, maioria qualificada de membros ativos na abertura; sucessão preserva gabinete e histórico.') on conflict(key) do nothing;
create function private.guard_institutional_rules() returns trigger language plpgsql set search_path='' as $$
begin
 if (case when tg_op='DELETE' then old.key else new.key end) <> 'parliament_institutional_rules' and (tg_op<>'UPDATE' or old.key<>'parliament_institutional_rules') then return coalesce(new,old); end if;
 if tg_op='UPDATE' and new.key is distinct from old.key then raise exception 'A chave da regra institucional não pode ser alterada.'; end if;
 if auth.uid() is not null and not coalesce(public.get_user_role(auth.uid())='Admin',false) then raise exception 'Somente Admin pode configurar as regras institucionais do RP.' using errcode='42501'; end if;
 if tg_op='DELETE' then raise exception 'A configuração institucional não pode ser apagada.'; end if;
 if jsonb_typeof(new.value->'impeachment_approval_numerator')<>'number' or jsonb_typeof(new.value->'impeachment_approval_denominator')<>'number'
 or not coalesce((new.value->>'impeachment_approval_numerator')::integer between 1 and 100 and (new.value->>'impeachment_approval_denominator')::integer between 1 and 100
 and (new.value->>'impeachment_approval_numerator')::numeric/(new.value->>'impeachment_approval_denominator')::numeric>0.5
 and (new.value->>'impeachment_approval_numerator')::integer<=(new.value->>'impeachment_approval_denominator')::integer
 and (new.value->>'impeachment_duration_hours')::numeric between 1 and 168,false) then raise exception 'Configure maioria qualificada válida e prazo entre 1 e 168 horas.'; end if;
 if new.value->'succession_roles' is distinct from '["Vice-Presidente","Presidente da Câmara dos Deputados","Presidente do Senado","Presidente do STF"]'::jsonb then raise exception 'A sucessão segue Vice, Câmara, Senado e STF.'; end if;
 return new;
end $$;
revoke all on function private.guard_institutional_rules() from public,anon,authenticated;
create trigger guard_institutional_rules before insert or update or delete on public.system_settings for each row execute function private.guard_institutional_rules();

create or replace function public.sync_parliament_membership(p_user_id uuid,p_new_role text,p_old_role text)
returns void language plpgsql security definer set search_path='' as $$
declare house uuid; assignment public.election_office_assignments%rowtype;
begin
 select id into house from public.parliament_houses where
 (name ilike '%câmara%' and p_new_role in ('Deputado','Presidente da Câmara','Presidente da Câmara dos Deputados','Vice-Presidente da Câmara dos Deputados'))
 or (name ilike '%senado%' and p_new_role in ('Senador','Presidente do Senado','Presidente do Senado Federal','Vice-Presidente do Senado','Vice-Presidente do Senado Federal'))
 order by case when id in ('a1b2c3d4-e5f6-7890-1234-567890abcdef','fedcba09-8765-4321-0987-654321fedcba') then 0 else 1 end,id limit 1;
 if house is not null then
  select * into assignment from public.election_office_assignments where profile_id=p_user_id and status='active' and office_role=public.get_parliament_base_role_label(house) and term_ends_at>now() order by assigned_at desc limit 1;
  update public.parliament_members set term_end_date=current_date-1 where user_id=p_user_id and house_id<>house and term_end_date>=current_date;
  insert into public.parliament_members(user_id,house_id,party_id,term_start_date,term_end_date)
  values(p_user_id,house,(select party_id from public.party_members where user_id=p_user_id order by joined_at desc limit 1),coalesce(assignment.term_starts_at::date,current_date),coalesce(assignment.term_ends_at::date,(current_date+interval '1 month')::date))
  on conflict(user_id,house_id) do update set party_id=excluded.party_id,
   term_start_date=case when public.parliament_members.term_end_date>=current_date then public.parliament_members.term_start_date else excluded.term_start_date end,
   term_end_date=coalesce(assignment.term_ends_at::date,case when public.parliament_members.term_end_date>=current_date then public.parliament_members.term_end_date else excluded.term_end_date end);
 else update public.parliament_members set term_end_date=current_date-1 where user_id=p_user_id and term_end_date>=current_date;
 end if;
end $$;
revoke all on function public.sync_parliament_membership(uuid,text,text) from public,anon,authenticated;

create function private.refresh_office_assignment_snapshot() returns void language sql security definer set search_path='' as $$
 insert into public.system_settings(key,value) values('election_office_sync',jsonb_build_object('active_assignments',coalesce((select jsonb_agg(jsonb_build_object('user_id',profile_id,'office_role',office_role,'election_id',election_id,'term_start_at',term_starts_at,'term_end_at',term_ends_at)) from public.election_office_assignments where status='active' and term_starts_at<=now() and term_ends_at>now()),'[]'::jsonb),'updated_at',clock_timestamp()))
 on conflict(key) do update set value=coalesce(public.system_settings.value,'{}'::jsonb)||excluded.value,updated_at=clock_timestamp();
$$;
revoke all on function private.refresh_office_assignment_snapshot() from public,anon,authenticated;

create function private.end_parliament_leadership(p_member_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare membership public.parliament_members%rowtype; term public.parliament_leadership_terms%rowtype; vice public.parliament_leadership_terms%rowtype; successor uuid;
begin
 select * into membership from public.parliament_members where id=p_member_id for update;
 select * into term from public.parliament_leadership_terms where member_id=p_member_id and status='active' order by created_at desc limit 1 for update;
 if not found then return jsonb_build_object('changed',false); end if;
 update public.parliament_leadership_terms set status='completed',concluded_at=clock_timestamp() where id=term.id;
 if term.position='president' then
  select t.* into vice from public.parliament_leadership_terms t join public.parliament_members m on m.id=t.member_id where t.house_id=term.house_id and t.position='vice_president' and t.status='active' and t.term_end_date>=current_date and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id) order by t.created_at desc limit 1 for update of t;
  if found then
   update public.parliament_leadership_terms set status='completed',concluded_at=clock_timestamp() where id=vice.id;
   insert into public.parliament_leadership_terms(house_id,position,member_id,status,term_start_date,term_end_date)
   values(term.house_id,'president',vice.member_id,'active',current_date,term.term_end_date);
   select user_id into successor from public.parliament_members where id=vice.member_id;
   update public.profiles set role=public.get_parliament_leadership_role_label(term.house_id,'president'),role_assigned_at=clock_timestamp(),updated_at=clock_timestamp() where id=successor;
  end if;
 end if;
 perform public.justice_write_audit('parliament.leadership_ended','parliament_leadership_term',term.id,to_jsonb(term),jsonb_build_object('successor_id',successor),p_reason);
 return jsonb_build_object('changed',true,'successor_id',successor,'previous_position',term.position);
end $$;
revoke all on function private.end_parliament_leadership(uuid,text) from public,anon,authenticated;

create function public.resign_parliament_position(p_house_id uuid,p_scope text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member_id uuid; m public.parliament_members%rowtype; leadership jsonb; commissions jsonb; previous_role text;
begin
 if auth.uid() is null or p_scope not in ('mandate','leadership') or length(trim(coalesce(p_reason,'')))<20 then raise exception 'Informe a função e um motivo com pelo menos 20 caracteres.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('house-transition:'||p_house_id::text,0));
 member_id:=public.get_active_parliament_member_id(auth.uid(),p_house_id);
 if member_id is null then raise exception 'Você não possui mandato ativo nesta Casa.' using errcode='42501'; end if;
 select * into m from public.parliament_members where id=member_id for update;
 select role into previous_role from public.profiles where id=auth.uid() for update;
 perform set_config('govrp.role_change_reason','Renúncia: '||trim(p_reason),true);
 leadership:=private.end_parliament_leadership(member_id,p_reason);
 if p_scope='leadership' then
  if not (leadership->>'changed')::boolean then raise exception 'Você não ocupa uma função ativa na Mesa Diretora.'; end if;
  update public.profiles set role=public.get_parliament_base_role_label(p_house_id),role_assigned_at=clock_timestamp(),updated_at=clock_timestamp() where id=auth.uid();
 else
  select coalesce(jsonb_agg(to_jsonb(c)),'[]') into commissions from public.parliament_commission_members c where c.member_id=m.id;
  delete from public.parliament_commission_members c where c.member_id=m.id;
  update public.parliament_members set term_end_date=current_date-1 where id=m.id;
  update public.election_office_assignments set status='revoked',ended_at=clock_timestamp(),metadata=metadata||jsonb_build_object('reason',p_reason,'transition','resignation') where profile_id=auth.uid() and office_role=public.get_parliament_base_role_label(p_house_id) and status='active';
  update public.profiles set role='Cidadão',manual_role_override=false,role_assigned_at=clock_timestamp(),updated_at=clock_timestamp() where id=auth.uid();
  perform private.refresh_office_assignment_snapshot();
 end if;
 perform public.justice_write_audit('parliament.resignation','parliament_member',m.id,to_jsonb(m),jsonb_build_object('scope',p_scope,'reason',p_reason,'leadership',leadership,'commissions_ended',commissions),p_reason);
 insert into public.notifications(user_id,type,content,link,metadata)
 select p.user_id,'parliament_resignation','Renúncia registrada na Casa Legislativa. A composição foi atualizada.','/services/parliament',jsonb_build_object('member_id',m.id,'scope',p_scope,'leadership',leadership)
 from public.parliament_members p where p.house_id=p_house_id and p.id=public.get_active_parliament_member_id(p.user_id,p.house_id);
 return jsonb_build_object('success',true,'scope',p_scope,'leadership',leadership);
end $$;
revoke all on function public.resign_parliament_position(uuid,text,text) from public,anon;
grant execute on function public.resign_parliament_position(uuid,text,text) to authenticated;

-- Reuse the existing vacancy trigger, keeping the cabinet and recording the successor's mandate.
create or replace function public.promote_vice_president_when_presidency_empty()
returns trigger language plpgsql security definer set search_path='' as $$
declare successor public.profiles%rowtype; former_assignment public.election_office_assignments%rowtype;
 next_assignment public.election_office_assignments%rowtype; member_record record; cfg jsonb; reason text;
begin
 if tg_op<>'UPDATE' or old.role<>'Presidente' or new.role='Presidente' then return new; end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 if exists(select 1 from public.profiles where role='Presidente' and id<>old.id and deleted_at is null) then return new; end if;
 select value into cfg from public.system_settings where key='parliament_institutional_rules';
 select p.* into successor from public.profiles p
 join jsonb_array_elements_text(cfg->'succession_roles') with ordinality chain(role_label,priority) on p.role=public.canonical_official_role(chain.role_label)
 where p.deleted_at is null and p.id<>old.id
 and (chain.priority not in (2,3) or exists(select 1 from public.parliament_members m where m.user_id=p.id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id) and private.is_house_president(p.id,m.house_id)))
 order by chain.priority,p.role_assigned_at desc nulls last,p.id limit 1 for update of p;
 reason:=coalesce(nullif(current_setting('govrp.role_change_reason',true),''),'Vacância presidencial');
 select * into former_assignment from public.election_office_assignments where profile_id=old.id and office_role='Presidente' order by assigned_at desc limit 1;
 update public.election_office_assignments set status='revoked',ended_at=clock_timestamp(),metadata=metadata||jsonb_build_object('reason',reason) where profile_id=old.id and office_role='Presidente' and status='active';
 if successor.id is not null then
  select * into next_assignment from public.election_office_assignments where profile_id=successor.id and status='active' order by assigned_at desc limit 1;
  for member_record in select id from public.parliament_members where user_id=successor.id and term_end_date>=current_date loop
   perform private.end_parliament_leadership(member_record.id,'Sucessão presidencial');
   delete from public.parliament_commission_members where member_id=member_record.id;
  end loop;
  update public.election_office_assignments set status='revoked',ended_at=clock_timestamp(),metadata=metadata||jsonb_build_object('reason','Sucessão presidencial') where profile_id=successor.id and status='active';
  if former_assignment.id is not null and former_assignment.term_ends_at>clock_timestamp() then
   insert into public.election_office_assignments(election_id,candidate_id,profile_id,office_role,votes_received,term_starts_at,term_ends_at,assigned_by,metadata)
   values(former_assignment.election_id,next_assignment.candidate_id,successor.id,'Presidente',coalesce(next_assignment.votes_received,0),clock_timestamp(),former_assignment.term_ends_at,auth.uid(),jsonb_build_object('succession',true,'former_president_id',old.id,'reason',reason))
   on conflict(election_id,profile_id,office_role) do update set status='active',ended_at=null,metadata=public.election_office_assignments.metadata||excluded.metadata;
  end if;
  update public.profiles set role='Presidente',manual_role_override=(former_assignment.id is null),role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),updated_at=clock_timestamp() where id=successor.id;
 end if;
 insert into public.system_settings(key,value,description) values('executive_governance',jsonb_build_object(
 'officeVacancy',jsonb_build_object('vacant',successor.id is null,'since',case when successor.id is null then clock_timestamp() end,'reason',reason,'triggered_by',auth.uid()),
 'presidentialSuccession',case when successor.id is null then null else jsonb_build_object('promoted_president_id',successor.id,'previous_vice_id',case when successor.role='Vice-Presidente' then successor.id end,'former_president_id',old.id,'term_election_id',former_assignment.election_id,'promoted_at',clock_timestamp(),'reason',reason,'triggered_by',auth.uid()) end),
 'Governança constitucional do Poder Executivo.') on conflict(key) do update set value=coalesce(public.system_settings.value,'{}')||excluded.value,updated_at=clock_timestamp();
 perform private.refresh_office_assignment_snapshot();
 perform public.justice_write_audit('executive.succession','profile',old.id,to_jsonb(old),jsonb_build_object('successor_id',successor.id,'previous_role',successor.role,'vacant',successor.id is null),reason);
 return new;
end $$;

create function private.is_house_president(p_user_id uuid,p_house_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.parliament_leadership_terms t join public.parliament_members m on m.id=t.member_id
 where m.user_id=p_user_id and m.house_id=p_house_id and t.house_id=p_house_id and t.position='president' and t.status='active' and t.term_end_date>=current_date and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id));
$$;
revoke all on function private.is_house_president(uuid,uuid) from public,anon,authenticated;

create function public.propose_presidential_impeachment(p_house_id uuid,p_president_id uuid,p_title text,p_reason text,p_facts text,p_evidence_links jsonb default '[]')
returns public.bills language plpgsql security definer set search_path='' as $$
declare result public.bills%rowtype; target public.profiles%rowtype; cfg jsonb;
begin
 if auth.uid() is null or public.get_active_parliament_member_id(auth.uid(),p_house_id) is null
 or not exists(select 1 from public.parliament_houses where id=p_house_id and name ilike '%câmara%') then raise exception 'Somente Deputado com mandato ativo na Câmara pode protocolar impeachment.' using errcode='42501'; end if;
 if length(trim(coalesce(p_title,'')))<10 or length(trim(coalesce(p_reason,'')))<40 or length(trim(coalesce(p_facts,'')))<40 then raise exception 'Preencha o título (10 caracteres), a justificativa e os fatos (40 caracteres cada).'; end if;
 if jsonb_typeof(p_evidence_links)<>'array' or jsonb_array_length(p_evidence_links)>20 or exists(select 1 from jsonb_array_elements_text(p_evidence_links) x where x !~ '^https://[^[:space:]]+$' or length(x)>2000) then raise exception 'As provas devem ser até 20 links HTTPS válidos.'; end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 select * into target from public.profiles where id=p_president_id and role='Presidente' and deleted_at is null for update;
 if not found then raise exception 'O cidadão indicado não exerce a Presidência atualmente.'; end if;
 if exists(select 1 from public.bills where type='IMPEACHMENT' and institutional_data->>'president_id'=p_president_id::text and status in ('Protocolado','Em votação')) then raise exception 'Já existe um pedido em andamento contra este Presidente.'; end if;
 select value into cfg from public.system_settings where key='parliament_institutional_rules';
 insert into public.bills(title,summary,full_text,type,author_id,author_role,house_id,status,institutional_data)
 values(trim(p_title),trim(p_reason),trim(p_facts),'IMPEACHMENT',auth.uid(),public.get_user_role(auth.uid()),p_house_id,'Protocolado',jsonb_build_object('president_id',target.id,'president_snapshot',jsonb_build_object('id',target.id,'full_name',target.full_name,'avatar_url',target.avatar_url),'evidence_links',p_evidence_links,'rule_snapshot',cfg,'rp_procedure',true)) returning * into result;
 insert into public.notifications(user_id,type,content,link,metadata)
 select distinct m.user_id,'impeachment_filed','Novo pedido de impeachment aguarda pauta ou arquivamento: '||result.title,'/services/parliament/panel',jsonb_build_object('bill_id',result.id)
 from public.parliament_members m where m.house_id=p_house_id and private.is_house_president(m.user_id,p_house_id);
 perform public.justice_write_audit('impeachment.filed','bill',result.id,null,to_jsonb(result),p_reason);
 return result;
end $$;
revoke all on function public.propose_presidential_impeachment(uuid,uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.propose_presidential_impeachment(uuid,uuid,text,text,text,jsonb) to authenticated;

create function public.archive_presidential_impeachment(p_bill_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare b public.bills%rowtype;
begin
 select * into b from public.bills where id=p_bill_id and type='IMPEACHMENT' for update;
 if not found or b.status<>'Protocolado' then raise exception 'Somente pedidos protocolados podem ser arquivados antes da votação.'; end if;
 if not private.is_house_president(auth.uid(),b.house_id) then raise exception 'Somente o Presidente da Câmara pode arquivar o pedido.' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,'')))<40 then raise exception 'Justifique o arquivamento em pelo menos 40 caracteres.'; end if;
 update public.bills set status='Arquivado',updated_at=clock_timestamp(),institutional_data=institutional_data||jsonb_build_object('archived_by',auth.uid(),'archived_at',clock_timestamp(),'archive_reason',trim(p_reason)) where id=b.id;
 insert into public.notifications(user_id,type,content,link,metadata) values(b.author_id,'impeachment_archived','Pedido de impeachment arquivado. Motivo: '||trim(p_reason),'/services/parliament',jsonb_build_object('bill_id',b.id));
 perform public.justice_write_audit('impeachment.archived','bill',b.id,to_jsonb(b),jsonb_build_object('reason',p_reason),p_reason);
end $$;
revoke all on function public.archive_presidential_impeachment(uuid,text) from public,anon;
grant execute on function public.archive_presidential_impeachment(uuid,text) to authenticated;

create function private.finalize_impeachment(p_voting_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.parliament_votings%rowtype; b public.bills%rowtype; yes integer; no integer; abstentions integer; total integer; seats integer; required integer; approved boolean; outcome text; successor jsonb; previous_role text;
begin
 select * into v from public.parliament_votings where id=p_voting_id for update;
 select * into b from public.bills where id=v.related_id for update;
 if b.type<>'IMPEACHMENT' then raise exception 'Este procedimento não é impeachment.'; end if;
 if v.status='closed' then return jsonb_build_object('finalized',true,'approved',b.status='Impeachment aprovado'); end if;
 seats:=(b.institutional_data->>'eligible_seats')::integer;required:=(b.institutional_data->>'required_approvals')::integer;
 if seats is null or seats<1 or required is null then raise exception 'A abertura precisa registrar o quórum do procedimento.'; end if;
 select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar'),count(*) filter(where vote='Abster') into total,yes,no,abstentions from public.parliament_voting_votes where voting_id=v.id;
 if clock_timestamp()<v.end_date and total<seats then return jsonb_build_object('finalized',false); end if;
 approved:=yes>=required;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 select role into previous_role from public.profiles where id=(b.institutional_data->>'president_id')::uuid for update;
 if previous_role is distinct from 'Presidente' then outcome:='Arquivado';approved:=false;
 elsif approved then
  outcome:='Impeachment aprovado';
  perform set_config('govrp.role_change_reason','Destituição por impeachment aprovado na Câmara: '||b.title,true);
  update public.profiles set role='Cidadão',manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),updated_at=clock_timestamp() where id=(b.institutional_data->>'president_id')::uuid;
  select value->'presidentialSuccession' into successor from public.system_settings where key='executive_governance';
 else outcome:='Impeachment rejeitado'; end if;
 update public.bills set status=outcome,updated_at=clock_timestamp(),institutional_data=institutional_data||jsonb_build_object('result',jsonb_build_object('approve',yes,'reject',no,'abstain',abstentions,'absent',greatest(seats-total,0),'required',required,'approved',approved,'decided_at',clock_timestamp(),'successor',successor,'presidency_already_vacated',previous_role is distinct from 'Presidente')) where id=b.id;
 update public.parliament_votings set status='closed' where id=v.id;
 insert into public.notifications(user_id,type,content,link,metadata)
 select id,'institutional_result',outcome||': '||b.title||'.','/services/parliament',jsonb_build_object('bill_id',b.id,'outcome',outcome,'occurred_at',clock_timestamp(),'former_president',b.institutional_data->'president_snapshot','successor',successor,'popup_pending',true,'neutral',true)
 from public.profiles where deleted_at is null and (onboarding_completed or onboarding_mode='legacy_migration');
 insert into public.dou_entries(title,summary,content,type,source_id,legal_metadata) values(outcome||': '||b.title,'Procedimento próprio do RP, decidido na Câmara dos Deputados.',yes||' votos favoráveis de '||required||' exigidos. '||coalesce(b.summary,''),'Ato Legislativo',b.id,jsonb_build_object('result',outcome,'succession',successor));
 perform public.justice_write_audit('impeachment.decided','bill',b.id,to_jsonb(b),jsonb_build_object('approved',approved,'approve',yes,'required',required,'successor',successor),'Apuração do procedimento institucional.');
 return jsonb_build_object('finalized',true,'approved',approved,'message',outcome);
end $$;
revoke all on function private.finalize_impeachment(uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.propose_parliament_bill(p_title text, p_summary text, p_full_text text, p_type text, p_house_id uuid DEFAULT NULL::uuid)
 RETURNS bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); actor_role text; resolved_house uuid; result public.bills%rowtype;
begin
  select role into actor_role from public.profiles where id=actor;
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_summary,'')))<15 then raise exception 'Título e resumo precisam ser completos.'; end if;
  if actor_role is null or (actor_role not in ('Admin','Presidente') and not exists(select 1 from public.parliament_members m where m.user_id=actor and m.id=public.get_active_parliament_member_id(actor,m.house_id))) then raise exception 'PARLIAMENT_AUTHORITY_REQUIRED'; end if;
  if p_type not in ('PL','PEC','PDL','Projeto de Lei','Proposta de Emenda Constitucional') then raise exception 'Escolha um tipo de proposta legislativa válido.'; end if;
  if actor_role IN('Admin','Presidente') then
    resolved_house:=p_house_id;
  else
    select pm.house_id into resolved_house from public.parliament_members pm
    where pm.user_id=actor and pm.term_start_date<=current_date and pm.term_end_date>=current_date
      and (p_house_id is null or pm.house_id=p_house_id)
    order by pm.term_end_date desc limit 1;
  end if;
  if resolved_house is null or not exists(select 1 from public.parliament_houses where id=resolved_house) then raise exception 'Casa legislativa não autorizada para este mandato.'; end if;
  if actor_role NOT IN('Admin','Presidente') and not exists(select 1 from public.parliament_members where user_id=actor and house_id=resolved_house and term_start_date<=current_date and term_end_date>=current_date) then raise exception 'O projeto deve tramitar na Casa do mandato do parlamentar.'; end if;
  insert into public.bills(title,summary,full_text,type,author_id,house_id,author_role,status)
  values(trim(p_title),trim(p_summary),nullif(trim(p_full_text),''),p_type,actor,resolved_house,actor_role,'Em tramitação') returning * into result;
  insert into public.notifications(user_id,sender_id,type,content,link)
  select pm.user_id,actor,'parliament_bill_proposed','Novo projeto em sua Casa: '||result.title,'/services/parliament/panel'
  from public.parliament_members pm where pm.house_id=resolved_house and pm.term_start_date<=current_date and pm.term_end_date>=current_date and pm.user_id<>actor;
  return result;
end; $function$;


CREATE OR REPLACE FUNCTION public.propose_decree_suspension(p_decree_id uuid, p_house_id uuid, p_reason text)
 RETURNS bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.decrees%rowtype; b public.bills%rowtype;
BEGIN
 IF NOT coalesce(public.get_user_role(auth.uid())='Admin',false) AND public.get_active_parliament_member_id(auth.uid(),p_house_id) IS NULL THEN RAISE EXCEPTION 'PARLIAMENT_AUTHORITY_REQUIRED'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<40 THEN RAISE EXCEPTION 'LEGAL_TEXT_REQUIRED'; END IF;
 SELECT * INTO d FROM public.decrees WHERE id=p_decree_id AND is_published AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGAL_SOURCE_NOT_FOUND'; END IF;
 b:=public.propose_parliament_bill('Sustação do decreto: '||d.title,p_reason,
   'Art. 1º. Fica sustado o decreto '||d.title||'. Art. 2º. Cessam seus efeitos sobre novas operações, preservado o histórico. Justificativa: '||p_reason,'PDL',p_house_id);
 UPDATE public.bills SET suspends_decree_id=d.id WHERE id=b.id RETURNING * INTO b;
 RETURN b;
END $function$;


CREATE OR REPLACE FUNCTION public.start_parliament_bill_voting(p_bill_id uuid, p_house_id uuid, p_title text, p_description text DEFAULT NULL::text)
 RETURNS parliament_votings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=(select auth.uid());
  v_bill public.bills%rowtype;
  v_voting public.parliament_votings%rowtype; v_seats integer; v_required integer; v_electorate jsonb; v_cfg jsonb;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select * into v_bill from public.bills where id=p_bill_id for update;
  if not found then raise exception 'BILL_NOT_FOUND'; end if;
  if v_bill.type='IMPEACHMENT' then
    if not private.is_house_president(v_actor,p_house_id) or p_house_id<>v_bill.house_id then raise exception 'Somente o Presidente da Câmara pode pautar este pedido.' using errcode='42501'; end if;
    if v_bill.status not in ('Protocolado','Em votação') then raise exception 'O pedido já foi decidido.'; end if;
    if not exists(select 1 from public.profiles where id=(v_bill.institutional_data->>'president_id')::uuid and role='Presidente') then raise exception 'O Presidente indicado já deixou o cargo. Arquive este pedido.'; end if;
  end if;
  if not public.is_parliament_governance_manager(v_actor,p_house_id)
     and not (
       v_bill.type='PEC'
       and p_house_id<>v_bill.house_id
       and exists(
         select 1 from public.parliament_members
         where user_id=v_actor and house_id=v_bill.house_id
           and term_start_date<=current_date and term_end_date>=current_date
       )
       and exists(
         select 1 from public.parliament_votings
         where related_id=p_bill_id and house_id=v_bill.house_id
           and type='bill' and status='closed'
       )
     ) then
    raise exception 'PARLIAMENT_MANAGER_REQUIRED' using errcode='42501';
  end if;
  if v_bill.house_id<>p_house_id and v_bill.type not in ('PEC','Proposta de Emenda Constitucional') then
    raise exception 'BILL_HOUSE_MISMATCH';
  end if;
  if v_bill.status in ('Sancionado','Promulgado','Vetado integralmente','Vetado parcialmente','Rejeitado') then
    raise exception 'BILL_ALREADY_DECIDED';
  end if;

  select * into v_voting
  from public.parliament_votings
  where related_id=p_bill_id and house_id=p_house_id and type='bill' and status='active'
  order by created_at desc limit 1;
  if found then return v_voting; end if;

  if v_bill.type='IMPEACHMENT' then
    select count(*),coalesce(jsonb_agg(id),'[]') into v_seats,v_electorate from public.parliament_members m where house_id=p_house_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id);
    if v_seats=0 then raise exception 'Não há Deputados ativos para esta votação.'; end if;
    v_cfg:=v_bill.institutional_data->'rule_snapshot';
    v_required:=ceil(v_seats*(v_cfg->>'impeachment_approval_numerator')::numeric/(v_cfg->>'impeachment_approval_denominator')::numeric);
    update public.bills set institutional_data=institutional_data||jsonb_build_object('eligible_seats',v_seats,'eligible_member_ids',v_electorate,'required_approvals',v_required,'pauted_by',v_actor,'voting_started_at',clock_timestamp()) where id=v_bill.id;
  end if;
  insert into public.parliament_votings(
    house_id,title,description,type,related_id,status,end_date
  ) values(
    p_house_id,
    left(coalesce(nullif(btrim(p_title),''),v_bill.title),180),
    nullif(btrim(coalesce(p_description,'')),''),
    'bill',p_bill_id,'active',clock_timestamp()+case when v_bill.type='IMPEACHMENT' then make_interval(secs=>(v_cfg->>'impeachment_duration_hours')::double precision*3600) else interval '24 hours' end
  ) returning * into v_voting;

  update public.bills set
    status=case when p_house_id=v_bill.house_id then 'Em votação' else 'Em votação (2ª Casa)' end,
    updated_at=clock_timestamp()
  where id=p_bill_id;

  insert into public.domain_events(
    event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at
  ) values(
    'parliament_voting_started','government','parliament_votings',v_voting.id,v_actor,
    jsonb_build_object('bill_id',p_bill_id,'house_id',p_house_id,'end_date',v_voting.end_date),
    'parliament-voting-started:'||v_voting.id,'processed',clock_timestamp()
  ) on conflict(idempotency_key) do nothing;

  return v_voting;
end;
$function$;


CREATE OR REPLACE FUNCTION public.cast_parliament_vote(p_voting_id uuid, p_member_id uuid, p_vote text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=(select auth.uid());
  v_voting public.parliament_votings%rowtype;
  v_member public.parliament_members%rowtype;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if p_vote not in ('Aprovar','Rejeitar','Abster') then raise exception 'INVALID_VOTE'; end if;

  select * into v_voting from public.parliament_votings where id=p_voting_id for update;
  if not found then raise exception 'VOTING_NOT_FOUND'; end if;
  if v_voting.status<>'active' or clock_timestamp()>v_voting.end_date then
    raise exception 'VOTING_NOT_OPEN';
  end if;

  select * into v_member from public.parliament_members
  where id=p_member_id and user_id=v_actor and house_id=v_voting.house_id
    and id=public.get_active_parliament_member_id(v_actor,v_voting.house_id);
  if not found then raise exception 'ACTIVE_HOUSE_MEMBER_REQUIRED' using errcode='42501'; end if;

  if exists(select 1 from public.bills b where b.id=v_voting.related_id and b.type='IMPEACHMENT' and not (b.institutional_data->'eligible_member_ids' @> jsonb_build_array(v_member.id))) then raise exception 'Seu mandato não integrava o colégio de votação registrado na abertura.' using errcode='42501'; end if;

  insert into public.parliament_voting_votes(voting_id,member_id,vote)
  values(p_voting_id,v_member.id,p_vote);

  return json_build_object('success',true,'message','Seu voto foi computado com sucesso!');
exception
  when unique_violation then
    raise exception 'PARLIAMENT_VOTE_ALREADY_CAST';
end;
$function$;


CREATE OR REPLACE FUNCTION private.finalize_bill_voting(p_voting_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.parliament_votings%rowtype; bill public.bills%rowtype; seats integer; voted integer; yes integer; no integer; approved boolean; other_house uuid; other_result record; next_status text;
begin
 select * into v from public.parliament_votings where id=p_voting_id for update;
 if not found or v.type<>'bill' then raise exception 'Votação legislativa não encontrada.'; end if;
 if v.status='closed' then return jsonb_build_object('finalized',true,'message','Votação já encerrada.'); end if;
 select * into bill from public.bills where id=v.related_id for update;
 if bill.type='IMPEACHMENT' then return private.finalize_impeachment(p_voting_id); end if;
 if lower(coalesce(bill.status,'')) in ('sancionado','promulgado','rejeitado','vetado','arquivado','sustado') then
  update public.parliament_votings set status='closed' where id=v.id;
  return jsonb_build_object('finalized',true,'message','Votação encerrada; decisão institucional preservada.');
 end if;
 select count(*) into seats from public.parliament_members where house_id=v.house_id and id=public.get_active_parliament_member_id(user_id,house_id);
 select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar') into voted,yes,no from public.parliament_voting_votes where voting_id=v.id;
 if clock_timestamp()<v.end_date and (seats=0 or voted<seats) then return jsonb_build_object('finalized',false); end if;
 approved:=case when bill.type='PEC' then yes>=ceil(greatest(seats,1)*2.0/3.0) else yes>no and yes>0 end;
 next_status:=case when approved and bill.type='PDL' and bill.suspends_decree_id is not null then 'Promulgado' when approved then 'Aguardando sanção presidencial' else 'Rejeitado' end;
 if bill.type='PEC' and approved then
  select pv.id,pv.status,pv.house_id,count(pvv.*) filter(where pvv.vote='Aprovar') approvals,
   (select greatest(count(*),1) from public.parliament_members where house_id=pv.house_id and term_start_date<=current_date and term_end_date>=current_date) seats
  into other_result from public.parliament_votings pv left join public.parliament_voting_votes pvv on pvv.voting_id=pv.id
  where pv.related_id=bill.id and pv.type='bill' and pv.house_id<>v.house_id group by pv.id order by pv.created_at desc limit 1;
  if found and other_result.status='closed' then next_status:=case when other_result.approvals>=ceil(other_result.seats*2.0/3.0) then 'Aguardando promulgação presidencial' else 'Rejeitado' end;
  else
   next_status:='Em votação (2ª Casa)';
   if other_result.id is null then
    select id into other_house from public.parliament_houses where id<>v.house_id order by case when id in ('a1b2c3d4-e5f6-7890-1234-567890abcdef','fedcba09-8765-4321-0987-654321fedcba') then 0 else 1 end,id limit 1;
    if other_house is null then raise exception 'A proposta constitucional exige duas Casas legislativas.'; end if;
    insert into public.parliament_votings(house_id,type,related_id,title,description,status,end_date) values(other_house,'bill',bill.id,'[2ª Casa] '||bill.title,'Votação constitucional na segunda Casa. Exige aprovação de dois terços.','active',clock_timestamp()+interval '24 hours');
   end if;
  end if;
 end if;
 update public.bills set status=next_status,updated_at=clock_timestamp() where id=bill.id;
 update public.parliament_votings set status='closed' where id=v.id;
 insert into public.notifications(user_id,type,content,link,metadata)
 select p.id,'parliament_voting_result','Votação encerrada: '||bill.title||'. Resultado: '||next_status||'.','/services/parliament',jsonb_build_object('voting_id',v.id,'bill_id',bill.id,'approve',yes,'reject',no,'abstain',greatest(seats-voted,0)+voted-yes-no)
 from public.profiles p where p.deleted_at is null and (p.id=bill.author_id or p.role='Presidente' or exists(select 1 from public.parliament_members m where m.user_id=p.id and m.house_id=v.house_id and m.term_end_date>=current_date));
 return jsonb_build_object('finalized',true,'approved',approved,'message','Votação encerrada. '||next_status||'.');
end $function$;


CREATE OR REPLACE FUNCTION public.update_bill_status(p_bill_id uuid, p_new_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=(select auth.uid());
  v_bill public.bills%rowtype;
  v_role text;
  v_is_parliament boolean;
  v_is_executive boolean;
  v_latest public.parliament_votings%rowtype;
  v_members integer:=0;
  v_votes integer:=0;
  v_approve integer:=0;
  v_reject integer:=0;
  v_ready boolean:=false;
  v_approved boolean:=false;
  v_approved_houses integer:=0;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select * into v_bill from public.bills where id=p_bill_id for update;
  if not found then raise exception 'BILL_NOT_FOUND'; end if;
  if v_bill.type='IMPEACHMENT' then raise exception 'O impeachment é decidido pela votação institucional da Câmara.'; end if;
  if v_bill.type='PDL' and v_bill.suspends_decree_id is not null then raise exception 'A sustação é decidida pela votação legislativa, sem sanção presidencial.'; end if;
  select role into v_role from public.profiles where id=v_actor;
  v_is_parliament:=public.is_parliament_governance_manager(v_actor,v_bill.house_id)
    or exists(select 1 from public.parliament_members where user_id=v_actor and house_id=v_bill.house_id and term_start_date<=current_date and term_end_date>=current_date);
  v_is_executive:=v_role in ('Admin','Presidente');

  if p_new_status in ('Aguardando sanção presidencial','Aguardando promulgação presidencial','Rejeitado') then
    if not v_is_parliament then raise exception 'PARLIAMENT_AUTHORITY_REQUIRED' using errcode='42501'; end if;
    select * into v_latest from public.parliament_votings
    where related_id=p_bill_id and type='bill'
    order by created_at desc limit 1;
    if not found then raise exception 'BILL_VOTING_NOT_FOUND'; end if;
    select count(*) into v_members from public.parliament_members
    where house_id=v_latest.house_id and term_start_date<=current_date and term_end_date>=current_date;
    select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar')
      into v_votes,v_approve,v_reject
    from public.parliament_voting_votes where voting_id=v_latest.id;
    v_ready:=clock_timestamp()>=v_latest.end_date or (v_members>0 and v_votes>=v_members);
    v_approved:=case when v_bill.type='PEC'
      then v_approve>=ceil(greatest(v_members,1)*2.0/3.0)
      else v_approve>v_reject and v_approve>0 end;
    if not v_ready then raise exception 'BILL_VOTING_NOT_READY'; end if;

    if p_new_status='Aguardando sanção presidencial' and (v_bill.type='PEC' or not v_approved) then
      raise exception 'BILL_RESULT_DOES_NOT_ALLOW_SANCTION';
    end if;
    if p_new_status='Rejeitado' and v_approved then
      raise exception 'BILL_RESULT_IS_APPROVED';
    end if;
    if p_new_status='Aguardando promulgação presidencial' then
      if v_bill.type<>'PEC' then raise exception 'ONLY_PEC_AWAITS_PROMULGATION'; end if;
      select count(*) into v_approved_houses
      from public.parliament_votings voting
      cross join lateral (
        select greatest(count(*),1)::integer as member_count
        from public.parliament_members member
        where member.house_id=voting.house_id
          and member.term_start_date<=current_date and member.term_end_date>=current_date
      ) members
      cross join lateral (
        select count(*)::integer as total_votes,
          count(*) filter(where vote.vote='Aprovar')::integer as approval_votes
        from public.parliament_voting_votes vote where vote.voting_id=voting.id
      ) result
      where voting.related_id=p_bill_id and voting.type='bill'
        and (clock_timestamp()>=voting.end_date or result.total_votes>=members.member_count)
        and result.approval_votes>=ceil(members.member_count*2.0/3.0);
      if v_approved_houses<2 then raise exception 'PEC_REQUIRES_TWO_APPROVED_HOUSES'; end if;
    end if;
  elsif p_new_status in ('Sancionado','Promulgado','Vetado integralmente','Vetado parcialmente') then
    if not v_is_executive then raise exception 'EXECUTIVE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
    if v_bill.status not in ('Aguardando sanção presidencial','Aguardando promulgação presidencial','Aprovado') then
      raise exception 'BILL_NOT_AWAITING_EXECUTIVE_DECISION';
    end if;
  else
    raise exception 'INVALID_BILL_STATUS';
  end if;

  update public.bills set status=p_new_status,updated_at=clock_timestamp() where id=p_bill_id;

  if p_new_status in ('Sancionado','Promulgado') then
    insert into public.dou_entries(title,summary,content,published_at,type,source_id)
    select
      v_bill.title,
      case when p_new_status='Sancionado'
        then 'Lei sancionada pela Presidência da República.'
        else 'Norma promulgada e publicada oficialmente.' end,
      coalesce(nullif(v_bill.full_text,''),v_bill.summary),
      clock_timestamp(),v_bill.type,v_bill.id
    where not exists(
      select 1 from public.dou_entries entry
      where entry.source_id=v_bill.id
    );
  end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.close_parliament_voting(p_voting_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=(select auth.uid());
  v_voting public.parliament_votings%rowtype;
  v_members integer;
  v_votes integer;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select * into v_voting from public.parliament_votings where id=p_voting_id for update;
  if not found then raise exception 'VOTING_NOT_FOUND'; end if;
  if v_voting.status='closed' then return; end if;

  if not public.is_parliament_governance_manager(v_actor,v_voting.house_id)
     and not exists(
       select 1 from public.parliament_members
       where user_id=v_actor and house_id=v_voting.house_id
         and term_start_date<=current_date and term_end_date>=current_date
     ) then raise exception 'PARLIAMENT_MEMBER_REQUIRED' using errcode='42501'; end if;

  select count(*) into v_members from public.parliament_members
  where house_id=v_voting.house_id and term_start_date<=current_date and term_end_date>=current_date;
  select count(*) into v_votes from public.parliament_voting_votes where voting_id=p_voting_id;
  if clock_timestamp()<v_voting.end_date and (v_members=0 or v_votes<v_members) then
    raise exception 'VOTING_NOT_READY_TO_CLOSE';
  end if;

  if v_voting.type='bill' then perform private.finalize_bill_voting(v_voting.id); return; end if;
  update public.parliament_votings set status='closed' where id=p_voting_id;
end;
$function$;


CREATE OR REPLACE FUNCTION private.notify_parliament_voting_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.status='active' and (tg_op='INSERT' or old.status is distinct from new.status) then
  insert into public.notifications(user_id,type,content,link,metadata) select distinct m.user_id,'parliament_voting_open','Nova votação na sua Casa Legislativa: '||coalesce((select name from public.parliament_houses where id=new.house_id),'Parlamento')||'. '||new.title||case when new.type='bill' then ' (projeto '||left(new.related_id::text,8)||')' else '' end||'.','/services/parliament',jsonb_build_object('voting_id',new.id,'bill_id',new.related_id,'house_id',new.house_id,'ends_at',new.end_date)
  from public.parliament_members m where m.house_id=new.house_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id);
 end if;
 if new.status='active' and (tg_op='INSERT' or old.status is distinct from new.status) and new.type='bill' and exists(select 1 from public.bills where id=new.related_id and type='IMPEACHMENT') then
  insert into public.notifications(user_id,type,content,link,metadata) select (institutional_data->>'president_id')::uuid,'impeachment_voting','A Câmara iniciou a votação do pedido de impeachment: '||title||'.','/services/parliament',jsonb_build_object('bill_id',id,'voting_id',new.id,'ends_at',new.end_date) from public.bills where id=new.related_id;
 end if;
 return new;
end $function$;


CREATE OR REPLACE FUNCTION private.notify_official_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE event_id bigint; origin text; loss boolean; details jsonb; assignment public.election_office_assignments%rowtype;
BEGIN
 IF NEW.role IS NOT DISTINCT FROM OLD.role OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 origin:=case when NEW.manual_role_override then 'administration'
   when NEW.role in('Deputado','Senador','Presidente','Vice-Presidente') then 'institutional_office'
   else 'institutional_transition' end;
 loss:=coalesce(NEW.role,'Cidadão') in('Cidadão','Prisioneiro','Preso') or (OLD.role like '%Presidente%' and NEW.role in ('Deputado','Senador'));
 IF NOT coalesce(NEW.manual_role_override,false) THEN
   SELECT * INTO assignment FROM public.election_office_assignments WHERE profile_id=NEW.id AND office_role=case when loss then OLD.role else NEW.role end ORDER BY assigned_at DESC LIMIT 1;
   IF FOUND THEN origin:='election'; END IF;
 END IF;
 details:=jsonb_build_object('user_id',NEW.id,'previous_role',OLD.role,'new_role',NEW.role,
   'reason',coalesce(nullif(current_setting('govrp.role_change_reason',true),''),case when loss then 'Encerramento ou afastamento do cargo oficial' else 'Atualização do cargo oficial' end),
   'origin',origin,'actor_id',auth.uid(),'occurred_at',clock_timestamp(),'role_assigned_at',NEW.role_assigned_at,
   'loss',loss,'popup_pending',true,'election_id',assignment.election_id,'office_role',NEW.role,'term_start_at',assignment.term_starts_at,'term_end_at',assignment.term_ends_at);
 INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 VALUES('role_changed','citizenship','profiles',NEW.id,auth.uid(),details,'role-change:'||gen_random_uuid()) RETURNING id INTO event_id;
 INSERT INTO public.notifications(user_id,sender_id,type,content,link,metadata)
 VALUES(NEW.id,auth.uid(),'role_changed',
   'Seu cargo foi alterado de '||coalesce(OLD.role,'Cidadão')||' para '||coalesce(NEW.role,'Cidadão')||'.',
   case when NEW.role in('Deputado','Senador') then '/services/parliament'
     when NEW.role in('Juiz','Promotor','Delegado','Policial','Advogado') then '/services/justice' else '/dashboard' end,
   details||jsonb_build_object('event_id',event_id));
 RETURN NEW;
END $function$;

create or replace function public.promulgate_decree_suspension(p_bill_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare b public.bills%rowtype; voting uuid; result jsonb;
begin
 select * into b from public.bills where id=p_bill_id;
 if b.suspends_decree_id is null or b.type<>'PDL' then raise exception 'Proposta de sustação não encontrada.'; end if;
 if public.get_active_parliament_member_id(auth.uid(),b.house_id) is null and not coalesce(public.get_user_role(auth.uid())='Admin',false) then raise exception 'Somente a Casa competente pode concluir a sustação.' using errcode='42501'; end if;
 if b.status='Promulgado' then return; end if;
 select id into voting from public.parliament_votings where related_id=b.id and type='bill' order by created_at desc limit 1;
 if voting is null then raise exception 'A sustação precisa de votação legislativa.'; end if;
 result:=private.finalize_bill_voting(voting);
 if not coalesce((result->>'finalized')::boolean,false) then raise exception 'A votação ainda está em andamento.'; end if;
end $$;
notify pgrst,'reload schema';
commit;
