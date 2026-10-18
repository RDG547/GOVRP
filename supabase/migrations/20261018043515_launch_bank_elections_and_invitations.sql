begin;

-- Cancellation is a lifecycle transition; invoices and transaction references survive.
create or replace function public.cancel_credit_card(p_card_id uuid) returns json language plpgsql security definer set search_path='' as $$
declare c public.cards%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre para cancelar seu cartão.' using errcode='42501';end if;
 select * into c from public.cards where id=p_card_id and user_id=auth.uid() for update;
 if c.id is null then return json_build_object('success',false,'message','Cartão não encontrado ou não pertence a você.');end if;
 if not c.is_active then return json_build_object('success',true,'message','Este cartão já foi cancelado.');end if;
 if coalesce(c.used_limit,0)>0 or exists(select 1 from public.card_invoices where card_id=c.id and amount>0 and lower(status) not in ('paid','pago','paga','cancelled','cancelado')) then
  return json_build_object('success',false,'message','Pague o saldo devedor e as faturas em aberto antes de cancelar este cartão.');
 end if;
 update public.cards set is_active=false where id=c.id;
 perform economy_private.audit('card_cancelled','cards',c.id::text,to_jsonb(c)-'cvv'-'card_number',jsonb_build_object('is_active',false),'Cancelamento solicitado pelo titular.',auth.uid());
 return json_build_object('success',true,'message','Cartão cancelado. Seu histórico foi preservado.');
end $$;
revoke all on function public.cancel_credit_card(uuid) from public,anon;
grant execute on function public.cancel_credit_card(uuid) to authenticated;

create or replace function public.get_election_participation(p_election_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;e public.elections%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre para consultar os resultados.' using errcode='42501';end if;
 select * into e from public.elections where id=p_election_id;if e.id is null then return null;end if;
 if clock_timestamp()<=e.voting_end_date or lower(coalesce(e.status,'')) in ('cancelled','canceled','cancelada') then return jsonb_build_object('in_progress',true,'available',false);end if;
 select real_participation into result from public.election_settlements where election_id=e.id;
 if result is null or result='{}' then result:=private.real_election_participation(e.id);end if;
 return result||jsonb_build_object('available',true,'in_progress',false);
end $$;

create or replace function public.withdraw_my_candidacy(p_candidate_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.candidates%rowtype;e public.elections%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre para retirar a candidatura.' using errcode='42501';end if;
 select * into c from public.candidates where id=p_candidate_id and user_id=auth.uid() for update;
 if c.id is null then raise exception 'Esta candidatura não pertence à sua conta.' using errcode='42501';end if;
 select * into e from public.elections where id=c.election_id for update;
 if c.status='Withdrawn' then return jsonb_build_object('success',true,'idempotent',true);end if;
 if clock_timestamp()>=e.voting_start_date or e.status in ('Voting','Finished','Cancelled') or exists(select 1 from public.election_settlements where election_id=e.id) then raise exception 'O prazo para retirar esta candidatura terminou. Ela permanece no histórico eleitoral.';end if;
 if c.status not in ('Pendente','Approved') then raise exception 'Somente candidaturas pendentes ou aprovadas podem ser retiradas.';end if;
 update public.candidates set status='Withdrawn',removed_at=clock_timestamp() where id=c.id;
 insert into public.election_audit_log(election_id,actor_id,actor_role,action,entity_type,entity_id,before_state,after_state)
 values(e.id,auth.uid(),public.get_user_role(auth.uid()),'candidacy_withdrawn','candidate',c.id::text,to_jsonb(c),jsonb_build_object('status','Withdrawn'));
 if c.vice_candidate_id is not null then insert into public.notifications(user_id,sender_id,type,content,link,metadata) values(c.vice_candidate_id,auth.uid(),'vice_candidacy_cancelled','A candidatura da sua chapa foi retirada pelo titular.','/services/elections',jsonb_build_object('candidate_id',c.id,'election_id',e.id));end if;
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.withdraw_my_candidacy(uuid) from public,anon;
grant execute on function public.withdraw_my_candidacy(uuid) to authenticated;

-- Never demote a current office using a client/service snapshot of a past election.
create or replace function public.reconcile_current_electoral_offices() returns void language plpgsql security definer set search_path='' as $$
declare a public.election_office_assignments%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre para sincronizar os mandatos.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 perform private.maintain_government_term();
 for a in select * from public.election_office_assignments where status='active' and term_ends_at<=clock_timestamp() for update loop
  update public.election_office_assignments set status='expired',ended_at=clock_timestamp() where id=a.id;
  perform set_config('govrp.role_change_reason','Encerramento do mandato eleitoral '||a.id,true);
  update public.profiles p set role='Cidadão',titles=array_remove(coalesce(titles,'{}'),a.office_role),role_assigned_at=clock_timestamp()
  where p.id=a.profile_id and p.role=a.office_role and not p.manual_role_override
   and not exists(select 1 from public.election_office_assignments current_office where current_office.profile_id=p.id and current_office.office_role=p.role and current_office.status='active' and current_office.term_ends_at>clock_timestamp())
   and not exists(select 1 from public.government_terms g where g.head_id=p.id and g.ended_at is null and g.term_ends_at>clock_timestamp());
 end loop;
 perform private.refresh_office_assignment_snapshot();
end $$;
revoke all on function public.reconcile_current_electoral_offices() from public,anon;
grant execute on function public.reconcile_current_electoral_offices() to authenticated;

create or replace function private.guard_presidential_transition() returns trigger language plpgsql security definer set search_path='' as $$
declare g public.government_terms%rowtype;reason text:=nullif(current_setting('govrp.role_change_reason',true),'');
begin
 if old.role<>'Presidente' or new.role='Presidente' then return new;end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 select * into g from public.government_terms where head_id=old.id and ended_at is null for update;
 if g.id is null then return new;end if;
 if current_setting('govrp.executive_transition',true)='replacing' or g.term_ends_at<=clock_timestamp() or (public.is_admin(auth.uid()) and current_setting('govrp.admin_role_change',true)=old.id::text) or reason like 'Renúncia à Presidência%' or reason like 'Destituição por impeachment%' then
  perform public.justice_write_audit('executive.transition_authorized','government',g.id,jsonb_build_object('role',old.role,'assignment',old.role_assigned_at),jsonb_build_object('role',new.role,'source',coalesce(reason,current_setting('govrp.executive_transition',true)),'actor',auth.uid()),coalesce(reason,'Transição institucional registrada.'));
  return new;
 end if;
 raise exception 'A Presidência possui mandato vigente. A alteração exige renúncia, destituição, nova posse ou ação administrativa autorizada.' using errcode='42501';
end $$;
create trigger guard_presidential_transition before update of role on public.profiles for each row execute function private.guard_presidential_transition();
revoke all on function private.guard_presidential_transition() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_election_results(p_election_id uuid)
 RETURNS TABLE(candidate_id uuid, political_name text, campaign_photo_url text, party_name text, party_logo_url text, vote_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    candidate.id,
    candidate.political_name,
    coalesce(candidate.identity_snapshot->>'avatar_url',candidate.campaign_photo_url),
    coalesce(candidate.identity_snapshot->'party'->>'name',party.name),
    coalesce(candidate.identity_snapshot->'party'->>'logo_url',party.logo_url),
    count(vote.id) filter (where vote.is_valid)
  from public.candidates candidate
  left join public.votes vote
    on vote.candidate_id = candidate.id
   and vote.election_id = candidate.election_id
   and vote.is_valid
  left join public.political_parties party on party.id = candidate.party_id
  where candidate.election_id = p_election_id
    and candidate.status = 'Approved'
    and exists(select 1 from public.elections e where e.id=p_election_id and e.voting_end_date<clock_timestamp())
  group by candidate.id, party.name, party.logo_url
  order by count(vote.id) filter (where vote.is_valid) desc, candidate.created_at, candidate.id;
$function$;

commit;
