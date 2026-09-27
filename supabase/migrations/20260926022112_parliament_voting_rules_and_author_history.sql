begin;
set local lock_timeout='10s';
create table public.parliament_voting_rules (
 key text primary key, label text not null, chair_votes_normally boolean not null,
 approval_basis text not null check(approval_basis in ('cast','seats')),
 numerator integer not null check(numerator>0), denominator integer not null check(denominator>=numerator),
 tie_break boolean not null default false, tie_break_hours integer not null default 24 check(tie_break_hours between 1 and 72)
);
insert into public.parliament_voting_rules values
 ('simple_majority','Maioria simples',false,'cast',1,2,true,24),
 ('absolute_majority','Maioria absoluta',true,'seats',1,2,false,24),
 ('qualified_majority','Maioria qualificada (2/3)',true,'seats',2,3,false,24);
alter table public.parliament_voting_rules enable row level security;
create policy voting_rules_read on public.parliament_voting_rules for select to authenticated using(true);
grant select on public.parliament_voting_rules to authenticated;
revoke all on public.parliament_voting_rules from anon;
alter table public.bills add column voting_rule text references public.parliament_voting_rules(key);
alter table public.bills add column author_identity_snapshot jsonb;
-- Existing author_role/party snapshot are historical; never reconstruct old affiliations.
update public.bills set voting_rule=case when type in ('PEC','Proposta de Emenda Constitucional','IMPEACHMENT') then 'qualified_majority' else 'simple_majority' end;
alter table public.bills alter column voting_rule set not null;
alter table public.parliament_votings add column rule_snapshot jsonb not null default '{}', add column eligible_member_ids uuid[] not null default '{}', add column chair_member_id uuid, add column tie_break_pending boolean not null default false, add column result jsonb;
create function private.snapshot_voting_electorate() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.bills%rowtype;
begin
 if new.type<>'bill' then return new; end if;
 select * into b from public.bills where id=new.related_id;
 select to_jsonb(r) into new.rule_snapshot from public.parliament_voting_rules r where r.key=b.voting_rule;
 if b.type='IMPEACHMENT' then new.rule_snapshot:=new.rule_snapshot||jsonb_build_object('numerator',coalesce((b.institutional_data->'rule_snapshot'->>'impeachment_approval_numerator')::int,2),'denominator',coalesce((b.institutional_data->'rule_snapshot'->>'impeachment_approval_denominator')::int,3)); end if;
 select m.id into new.chair_member_id from public.parliament_members m where m.house_id=new.house_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id) and private.is_house_president(m.user_id,m.house_id) order by m.id limit 1;
 select coalesce(array_agg(m.id),'{}'::uuid[]) into new.eligible_member_ids from public.parliament_members m
 where m.house_id=new.house_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
 and (coalesce((new.rule_snapshot->>'chair_votes_normally')::boolean,false) or m.id is distinct from new.chair_member_id);
 return new;
end $$;
revoke all on function private.snapshot_voting_electorate() from public,anon,authenticated;
create trigger snapshot_voting_electorate before insert on public.parliament_votings for each row execute function private.snapshot_voting_electorate();
-- Already-open sessions retain the rules under which they started, including votes by the chair.
update public.parliament_votings v set rule_snapshot=to_jsonb(r)||jsonb_build_object('chair_votes_normally',true,'tie_break',false,'legacy',true),
 eligible_member_ids=coalesce((select array_agg(m.id) from public.parliament_members m where m.house_id=v.house_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)),'{}'::uuid[])
 from public.bills b join public.parliament_voting_rules r on r.key=b.voting_rule where v.type='bill' and v.related_id=b.id;
CREATE OR REPLACE FUNCTION private.snapshot_bill_party()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 select jsonb_build_object('id',p.id,'name',p.name,'acronym',p.acronym,'logo_url',p.logo_url,'recorded_at',clock_timestamp()) into new.author_party_snapshot
 from public.party_members m join public.political_parties p on p.id=m.party_id where m.user_id=new.author_id and p.status<>'Encerrado' order by m.joined_at desc limit 1;
 new.author_party_snapshot:=coalesce(new.author_party_snapshot,jsonb_build_object('unaffiliated',true,'recorded_at',clock_timestamp()));
 select jsonb_build_object('id',p.id,'name',p.full_name,'avatar_url',p.avatar_url,'role',p.role,'recorded_at',clock_timestamp()) into new.author_identity_snapshot from public.profiles p where p.id=new.author_id;
 new.author_role:=new.author_identity_snapshot->>'role';
 new.voting_rule:=coalesce(new.voting_rule,case when new.type in ('PEC','Proposta de Emenda Constitucional','IMPEACHMENT') then 'qualified_majority' else 'simple_majority' end);
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION private.protect_bill_party_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if new.author_party_snapshot is distinct from old.author_party_snapshot or new.author_identity_snapshot is distinct from old.author_identity_snapshot or new.author_role is distinct from old.author_role or new.author_id is distinct from old.author_id then raise exception 'A filiação registrada no protocolo é histórica e não pode ser alterada.'; end if;
 if new.voting_rule is distinct from old.voting_rule then raise exception 'A regra da proposição é definida no protocolo.'; end if;
 return new;
end $function$
;
drop trigger if exists protect_bill_party_snapshot on public.bills;
create trigger protect_bill_party_snapshot before update on public.bills for each row execute function private.protect_bill_party_snapshot();
CREATE OR REPLACE FUNCTION private.finalize_bill_voting(p_voting_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.parliament_votings%rowtype; bill public.bills%rowtype; seats integer; voted integer; yes integer; no integer; approved boolean; other_house uuid; other_result record; next_status text; ordinary_voted integer; chair_voted boolean; required integer;
begin
 select * into v from public.parliament_votings where id=p_voting_id for update;
 if not found or v.type<>'bill' then raise exception 'Votação legislativa não encontrada.'; end if;
 if v.status='closed' then return jsonb_build_object('finalized',true,'message','Votação já encerrada.'); end if;
 select * into bill from public.bills where id=v.related_id for update;
 if bill.type='IMPEACHMENT' then return private.finalize_impeachment(p_voting_id); end if;
 if lower(coalesce(bill.status,'')) in ('sancionado','promulgado','rejeitado','vetado','arquivado','sustado') then
  update public.parliament_votings set status='closed',tie_break_pending=false,result=jsonb_build_object('approved',approved,'yes',yes,'no',no,'seats',seats,'required',required) where id=v.id;
  return jsonb_build_object('finalized',true,'message','Votação encerrada; decisão institucional preservada.');
 end if;
 select count(*) into seats from public.parliament_members m where m.id=any(v.eligible_member_ids) and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id);
 select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar'),count(*) filter(where member_id=any(v.eligible_member_ids)),coalesce(bool_or(member_id=v.chair_member_id),false)
 into voted,yes,no,ordinary_voted,chair_voted from public.parliament_voting_votes where voting_id=v.id;
 if v.tie_break_pending and not chair_voted and clock_timestamp()<v.end_date then return jsonb_build_object('finalized',false,'tie_break_pending',true); end if;
 if not v.tie_break_pending and clock_timestamp()<v.end_date and (seats=0 or ordinary_voted<seats) then return jsonb_build_object('finalized',false); end if;
 if not v.tie_break_pending and yes=no and voted>0 and coalesce((v.rule_snapshot->>'tie_break')::boolean,false)
 and exists(select 1 from public.parliament_members m where m.id=v.chair_member_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id) and private.is_house_president(m.user_id,m.house_id)) then
  update public.parliament_votings set tie_break_pending=true,end_date=clock_timestamp()+make_interval(hours=>(v.rule_snapshot->>'tie_break_hours')::int) where id=v.id;
  insert into public.notifications(user_id,type,content,link,metadata) select user_id,'parliament_tie_break','A votação de '||bill.title||' aguarda seu voto de desempate.','/services/parliament/panel',jsonb_build_object('voting_id',v.id) from public.parliament_members where id=v.chair_member_id;
  return jsonb_build_object('finalized',false,'tie_break_pending',true);
 end if;
 required:=case when v.rule_snapshot->>'approval_basis'='seats' then
 case when v.rule_snapshot->>'numerator'='1' and v.rule_snapshot->>'denominator'='2' then floor(seats/2.0)+1 else ceil(seats*(v.rule_snapshot->>'numerator')::numeric/(v.rule_snapshot->>'denominator')::numeric) end else 1 end;
 approved:=case when v.rule_snapshot->>'approval_basis'='seats' then yes>=greatest(required,1) else yes>no and yes>0 end;
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
 update public.parliament_votings set status='closed',tie_break_pending=false,result=jsonb_build_object('approved',approved,'yes',yes,'no',no,'seats',seats,'required',required) where id=v.id;
 insert into public.notifications(user_id,type,content,link,metadata)
 select m.user_id,'parliament_voting_result',
 case when vote.vote='Abster' then 'Votação encerrada: o projeto "'||bill.title||'", no qual você registrou abstenção, foi '
 when (vote.vote='Aprovar' and approved) or (vote.vote='Rejeitar' and not approved) then 'Boa notícia! O projeto "'||bill.title||'", em que você votou '||case vote.vote when 'Aprovar' then 'a favor' else 'contra' end||', foi '
 else 'Resultado da votação: o projeto "'||bill.title||'", em que você votou '||case vote.vote when 'Aprovar' then 'a favor' else 'contra' end||', foi ' end
 ||case when approved then 'aprovado' else 'rejeitado' end||' pela sua Casa Legislativa.',
 '/services/parliament',jsonb_build_object('voting_id',v.id,'bill_id',bill.id,'vote',vote.vote,'approved',approved,'tone',case when vote.vote='Abster' then 'neutral' when (vote.vote='Aprovar')=approved then 'positive' else 'institutional' end)
 from public.parliament_voting_votes vote join public.parliament_members m on m.id=vote.member_id where vote.voting_id=v.id
 and not exists(select 1 from public.notifications n where n.user_id=m.user_id and n.type='parliament_voting_result' and n.metadata->>'voting_id'=v.id::text);
 return jsonb_build_object('finalized',true,'approved',approved,'message','Votação encerrada. '||next_status||'.');
end $function$
;
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
    raise exception 'Esta votação já foi encerrada.';
  end if;

  select * into v_member from public.parliament_members
  where id=p_member_id and user_id=v_actor and house_id=v_voting.house_id
    and id=public.get_active_parliament_member_id(v_actor,v_voting.house_id);
  if not found then raise exception 'ACTIVE_HOUSE_MEMBER_REQUIRED' using errcode='42501'; end if;

  if exists(select 1 from public.bills b where b.id=v_voting.related_id and b.type='IMPEACHMENT' and not (b.institutional_data->'eligible_member_ids' @> jsonb_build_array(v_member.id))) then raise exception 'Seu mandato não integrava o colégio de votação registrado na abertura.' using errcode='42501'; end if;

  if v_voting.type='bill' then
    if v_voting.tie_break_pending then
      if v_member.id is distinct from v_voting.chair_member_id or not private.is_house_president(v_actor,v_voting.house_id) or p_vote='Abster' then raise exception 'Esta votação aguarda o voto de desempate da Presidência da Casa.' using errcode='42501'; end if;
    elsif not(v_member.id=any(v_voting.eligible_member_ids)) then
      raise exception 'A Presidência da Casa vota apenas no desempate nesta matéria, ou o mandato não integrava o colégio de votação.' using errcode='42501';
    end if;
  end if;
  insert into public.parliament_voting_votes(voting_id,member_id,vote)
  values(p_voting_id,v_member.id,p_vote);

  if v_voting.type='bill' then perform private.finalize_bill_voting(v_voting.id); end if;
  return json_build_object('success',true,'message','Seu voto foi computado com sucesso!');
exception
  when unique_violation then
    raise exception 'PARLIAMENT_VOTE_ALREADY_CAST';
end;
$function$
;
CREATE OR REPLACE FUNCTION private.close_due_bill_votings()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v record;
begin
 for v in select id from public.parliament_votings where type='bill' and status='active' and exists(select 1 from public.bills b where b.id=related_id) order by end_date for update skip locked loop
  begin
   perform private.finalize_bill_voting(v.id);
  exception when others then
   raise warning 'Falha ao encerrar votação %: % (%)', v.id, sqlerrm, sqlstate;
  end;
 end loop;
end $function$
;
alter publication supabase_realtime add table public.parliament_voting_rules;
commit;
