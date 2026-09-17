begin;
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
 if lower(coalesce(bill.status,'')) in ('sancionado','promulgado','rejeitado','vetado','arquivado','sustado') then
  update public.parliament_votings set status='closed' where id=v.id;
  return jsonb_build_object('finalized',true,'message','Votação encerrada; decisão institucional preservada.');
 end if;
 select count(*) into seats from public.parliament_members where house_id=v.house_id and term_start_date<=(clock_timestamp() at time zone 'America/Sao_Paulo')::date and term_end_date>=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
 select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar') into voted,yes,no from public.parliament_voting_votes where voting_id=v.id;
 if clock_timestamp()<v.end_date and (seats=0 or voted<seats) then return jsonb_build_object('finalized',false); end if;
 approved:=case when bill.type='PEC' then yes>=ceil(greatest(seats,1)*2.0/3.0) else yes>no and yes>0 end;
 next_status:=case when approved then 'Aguardando sanção presidencial' else 'Rejeitado' end;
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
CREATE OR REPLACE FUNCTION private.close_due_bill_votings()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v record;
begin
 for v in select id from public.parliament_votings where type='bill' and status='active' and end_date<=clock_timestamp() and exists(select 1 from public.bills b where b.id=related_id) order by end_date for update skip locked loop
  begin
   perform private.finalize_bill_voting(v.id);
  exception when others then
   raise warning 'Falha ao encerrar votação %: % (%)', v.id, sqlerrm, sqlstate;
  end;
 end loop;
end $function$;
CREATE OR REPLACE FUNCTION private.guard_marketplace_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare mode text;
begin
 if new.state_enterprise_id is not null then return new; end if;
 if tg_op='UPDATE' and current_user not in('postgres','supabase_admin','service_role') and (new.moderation_status is distinct from old.moderation_status or new.moderation_reason is distinct from old.moderation_reason or new.moderated_by is distinct from old.moderated_by or new.moderated_at is distinct from old.moderated_at) then raise exception 'A moderação exige uma ação autorizada.'; end if;
 select publication_mode into mode from public.state_enterprises where service_key='marketplace';
 if tg_op='INSERT' then new.moderation_status:=case when mode='approval' then 'pending' else 'approved' end;
 elsif mode='approval' and new.moderation_status='approved' and (new.name is distinct from old.name or new.description is distinct from old.description or new.image_url is distinct from old.image_url or new.category is distinct from old.category or new.price is distinct from old.price or new.subscription_price is distinct from old.subscription_price or new.product_type is distinct from old.product_type) then new.moderation_status:='pending'; end if;
 return new;
end; $function$;
CREATE OR REPLACE FUNCTION private.protect_marketplace_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user not in ('postgres','supabase_admin','service_role') and (new.commission_type is distinct from old.commission_type or new.commission_value is distinct from old.commission_value or new.publication_mode is distinct from old.publication_mode or new.manager_id is distinct from old.manager_id or new.operating_business_id is distinct from old.operating_business_id or new.service_key is distinct from old.service_key or new.is_privatized is distinct from old.is_privatized or new.privatization_buyer_id is distinct from old.privatization_buyer_id) then raise exception 'Use a ação autorizada de configuração do marketplace.'; end if;
 return new;
end; $function$;
drop index public.candidate_electoral_number_unique;
create unique index candidate_electoral_number_unique on public.candidates(election_id,electoral_number) where lower(coalesce(status,'')) not in ('rejected','rejeitado','cancelled','cancelado','cancelada','withdrawn');
CREATE OR REPLACE FUNCTION private.assign_candidate_electoral_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_digits integer; v_prefix text; v_min integer; v_max integer;
begin
  v_digits:=private.election_number_digits(new.election_id);
  if v_digits is null then raise exception 'Eleição não encontrada.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('candidate-number:'||new.election_id::text,0));
  if tg_op='UPDATE' and old.electoral_number is not null and new.electoral_number is distinct from old.electoral_number and exists(select 1 from public.elections where id=new.election_id and (status in ('Voting','Finished') or voting_start_date<=clock_timestamp())) then raise exception 'O número não pode mudar depois do início da votação.'; end if;
  if new.party_id is not null then
    select electoral_number into v_prefix from public.political_parties where id=new.party_id;
  else
    v_prefix:='0'; -- Independent candidacies keep the existing constitutional eligibility rule.
  end if;
  if v_prefix is null then raise exception 'O partido precisa de número eleitoral.'; end if;
  v_min:=(v_prefix||repeat('0',v_digits-length(v_prefix)))::integer;
  v_max:=(v_prefix||repeat('9',v_digits-length(v_prefix)))::integer;
  if new.electoral_number is null then
    select lpad(n::text,v_digits,'0') into new.electoral_number from generate_series(v_min,v_max) n where not exists(select 1 from public.candidates c where c.election_id=new.election_id and c.electoral_number=lpad(n::text,v_digits,'0') and c.id<>new.id and lower(coalesce(c.status,'')) not in ('rejected','rejeitado','cancelled','cancelado','cancelada','withdrawn')) order by n limit 1;
  end if;
  if not coalesce(new.electoral_number ~ ('^[0-9]{'||v_digits||'}$') and left(new.electoral_number,length(v_prefix))=v_prefix,false) then raise exception 'Use % dígitos começando por %.',v_digits,v_prefix; end if;
  if exists(select 1 from public.candidates c where c.election_id=new.election_id and c.electoral_number=new.electoral_number and c.id<>new.id and lower(coalesce(c.status,'')) not in ('rejected','rejeitado','cancelled','cancelado','cancelada','withdrawn')) then raise exception 'Este número já está reservado nesta eleição.'; end if;
  return new;
end; $function$;
create or replace function public.reactivate_state_enterprise(p_enterprise_id uuid)
returns public.state_enterprises language plpgsql security definer set search_path='' as $$
declare old_row public.state_enterprises%rowtype; new_row public.state_enterprises%rowtype;
begin
 if auth.uid() is null or not coalesce(public.get_user_role(auth.uid()) in ('Admin','Presidente'),false) then raise exception 'Somente a autoridade executiva pode reestatizar este serviço.'; end if;
 select * into old_row from public.state_enterprises where id=p_enterprise_id for update;
 if not found then raise exception 'Estatal não encontrada.'; end if;
 if not old_row.is_privatized then return old_row; end if;
 update public.state_enterprises set is_privatized=false,is_active=true,privatization_status='none',privatization_price=null,privatization_buyer_id=null,privatized_at=null,operating_business_id=null,manager_id=null,updated_at=clock_timestamp() where id=p_enterprise_id returning * into new_row;
 perform public.justice_write_audit('state_enterprise.reactivated','state_enterprise',p_enterprise_id,to_jsonb(old_row),to_jsonb(new_row),'Reestatização pela autoridade executiva');
 if old_row.privatization_buyer_id is not null then
  insert into public.notifications(user_id,type,content,link,metadata) values(old_row.privatization_buyer_id,'state_enterprise_reactivated','O serviço '||old_row.name||' retornou à administração pública. Seu histórico financeiro foi preservado.','/services/entrepreneur-portal',jsonb_build_object('enterprise_id',p_enterprise_id));
 end if;
 return new_row;
end $$;
revoke all on function public.reactivate_state_enterprise(uuid) from public,anon;
grant execute on function public.reactivate_state_enterprise(uuid) to authenticated;
create or replace function public.request_fine_hearing(p_fine_id uuid,p_reason text,p_preferred_times jsonb default '[]'::jsonb)
returns public.fine_hearing_requests language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result public.fine_hearing_requests%rowtype;
begin
 if length(trim(coalesce(p_reason,'')))<20 then raise exception 'Explique o pedido em pelo menos 20 caracteres.'; end if;
 perform 1 from public.police_fines where id=p_fine_id and user_id=actor and status in('Pendente','Vencida','Em Recurso') for update;
 if not found then raise exception 'Esta multa não está disponível para pedido de audiência.'; end if;
 select * into result from public.fine_hearing_requests where fine_id=p_fine_id and requester_id=actor order by created_at desc limit 1;
 if found then return result; end if;
 insert into public.fine_hearing_requests(fine_id,requester_id,reason,preferred_times) values(p_fine_id,actor,trim(p_reason),coalesce(p_preferred_times,'[]'::jsonb)) returning * into result;
 return result;
end $$;
alter policy "Contextual case evidence access" on public.case_evidence using (
 (((criminal_case_id is not null) and public.justice_can_access_case(criminal_case_id)) or ((investigation_id is not null) and public.justice_can_access_investigation(investigation_id)))
 and (confidentiality_level in ('public','restricted') or public.justice_has_role(array['Admin','Delegado','Promotor','Juiz']) or exists(select 1 from public.criminal_investigations ci where ci.id=investigation_id and (ci.lead_officer_id=auth.uid() or ci.delegate_id=auth.uid())))
);
CREATE OR REPLACE FUNCTION public.ensure_party_core_leadership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status='Encerrado' then new.owner_id:=null; new.president_id:=null; new.vice_president_id:=null; return new; end if;
  if new.owner_id is null and new.president_id is null then
    new.owner_id := coalesce(public.get_oldest_party_member(new.id, '{}'::uuid[]), new.founder_id);
    new.president_id := coalesce(
      public.get_oldest_party_member(new.id, array_remove(array[new.owner_id], null)),
      new.owner_id
    );
  end if;

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.protect_party_founder()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.founder_id is distinct from old.founder_id and coalesce(current_setting('govrp.allow_founder_correction',true),'')<>'on' then raise exception 'O fundador é um registro histórico permanente.'; end if;
  return new;
end; $function$;
-- Preserve the legacy text-only RPC response for empty messages. The richer
-- attachment RPC keeps its validation and authentication unchanged.
create or replace function public.send_x_message(p_recipient_id uuid,p_content text)
returns json language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is not null and btrim(coalesce(p_content,''))='' then
  return json_build_object('success',false,'message','Escreva uma mensagem antes de enviar.');
 end if;
 return public.send_x_message(p_recipient_id,p_content,null,null);
end $$;
commit;
notify pgrst,'reload schema';
