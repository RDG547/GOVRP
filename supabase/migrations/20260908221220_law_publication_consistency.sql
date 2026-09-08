BEGIN;
-- The existing status RPC and the effects trigger publish the same legal source.
-- Preserve the quorum/competence checks and deduplicate by source, regardless of its label.
CREATE OR REPLACE FUNCTION public.update_bill_status(p_bill_id uuid,p_new_status text)
returns void
language plpgsql
security definer
set search_path=''
as $$
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
$$;
CREATE OR REPLACE FUNCTION public.publish_bill_to_dou()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF lower(NEW.status) IN('sancionado','promulgado') AND lower(coalesce(OLD.status,'')) NOT IN('sancionado','promulgado')
   AND NOT EXISTS(SELECT 1 FROM public.dou_entries WHERE source_id=NEW.id) THEN
   PERFORM public.activate_legal_effects('bill',NEW.id,NEW.author_id,NEW.title);
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION public.publish_bill_to_dou() OWNER TO postgres;
COMMIT;
