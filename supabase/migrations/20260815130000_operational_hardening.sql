-- Fechamento operacional e de segurança dos fluxos criados na auditoria de 15/08/2026.

-- Corrige rotinas legadas que ainda podiam falhar em produção.
drop function if exists public.disaffiliate_from_party__v1_bak(uuid);
drop function if exists public.disaffiliate_from_party__v2_bak(uuid,uuid);
drop function if exists public.founder_leave_party(uuid,uuid);
drop function if exists public.admin_pay_user_invoice(uuid);
drop function if exists public.admin_forgive_debt(uuid,text);
drop function if exists public.place_authoritative_trade(uuid,text,text,text,text,numeric,numeric,timestamptz,numeric,timestamptz,integer,text,text);

create or replace function public.admin_change_user_password(p_user_id uuid,p_new_password text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if public.get_user_role(auth.uid())<>'Admin' then raise exception 'Apenas administradores podem alterar credenciais.'; end if;
  if length(coalesce(p_new_password,''))<8 then return jsonb_build_object('success',false,'message','A senha deve conter ao menos 8 caracteres.'); end if;
  update auth.users set encrypted_password=extensions.crypt(p_new_password,extensions.gen_salt('bf')),updated_at=clock_timestamp() where id=p_user_id;
  if not found then return jsonb_build_object('success',false,'message','Usuário não encontrado.'); end if;
  return jsonb_build_object('success',true,'message','Senha atualizada com sucesso.');
end; $$;
revoke all on function public.admin_change_user_password(uuid,text) from public,anon;
grant execute on function public.admin_change_user_password(uuid,text) to authenticated,service_role;

create or replace function public.delete_post(p_post_id uuid)
returns json language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); owner_id uuid;
begin
  select user_id into owner_id from public.posts where id=p_post_id for update;
  if owner_id is null then return json_build_object('success',false,'message','Post não encontrado.'); end if;
  if actor<>owner_id and public.get_user_role(actor)<>'Admin' then return json_build_object('success',false,'message','Você não tem permissão para excluir este post.'); end if;
  delete from public.posts where id=p_post_id;
  return json_build_object('success',true,'message','Post excluído com sucesso.');
end; $$;

create or replace function public.delete_story(p_story_id uuid)
returns json language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); owner_id uuid;
begin
  select user_id into owner_id from public.stories where id=p_story_id for update;
  if owner_id is null then return json_build_object('success',false,'message','Story não encontrado.'); end if;
  if actor<>owner_id and public.get_user_role(actor)<>'Admin' then return json_build_object('success',false,'message','Você não tem permissão para excluir este story.'); end if;
  delete from public.posts where story_id=p_story_id;
  delete from public.stories where id=p_story_id;
  return json_build_object('success',true,'message','Story excluído com sucesso.');
end; $$;

create or replace function public.create_reply(p_parent_post_id uuid,p_content text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); parent_author uuid; actor_handle text;
begin
  if actor is null or length(trim(coalesce(p_content,'')))=0 then raise exception 'Resposta inválida.'; end if;
  select user_id into parent_author from public.posts where id=p_parent_post_id;
  if parent_author is null then raise exception 'Publicação original não encontrada.'; end if;
  insert into public.posts(user_id,content,parent_post_id) values(actor,trim(p_content),p_parent_post_id);
  update public.posts set comments_count=coalesce(comments_count,0)+1 where id=p_parent_post_id;
  if actor<>parent_author then
    select coalesce(x_handle,username,full_name,'Alguém') into actor_handle from public.profiles where id=actor;
    insert into public.notifications(user_id,sender_id,type,content,link)
    values(parent_author,actor,'x_reply',actor_handle||' respondeu à sua publicação.','/services/x');
  end if;
end; $$;

create or replace function public.get_account_transactions(p_account_id uuid)
returns table(id uuid,created_at timestamptz,type text,amount double precision,description text,metadata jsonb,direction text,other_party_name text)
language sql stable security definer set search_path='' as $$
  select t.id,t.created_at,t.type,t.amount::double precision,t.description,t.metadata,
    case when t.from_account_id=p_account_id then 'sent' else 'received' end,
    case when t.from_account_id=p_account_id then receiver.full_name else sender.full_name end
  from public.transactions t
  left join public.accounts sa on sa.id=t.from_account_id left join public.profiles sender on sender.id=sa.user_id
  left join public.accounts ra on ra.id=t.to_account_id left join public.profiles receiver on receiver.id=ra.user_id
  where (t.from_account_id=p_account_id or t.to_account_id=p_account_id)
    and exists(select 1 from public.accounts own where own.id=p_account_id and (own.user_id=auth.uid() or public.get_user_role(auth.uid())='Admin'))
  order by t.created_at desc;
$$;

create or replace function public.sync_parliament_membership(p_user_id uuid,p_new_role text,p_old_role text)
returns void language plpgsql security definer set search_path='' as $$
declare house uuid;
begin
  select id into house from public.parliament_houses
  where lower(name) like case when p_new_role in('Deputado','Presidente da Câmara','Presidente da Câmara dos Deputados') then '%câmara%'
    when p_new_role in('Senador','Presidente do Senado','Presidente do Senado Federal') then '%senado%' else '#nenhuma#' end limit 1;
  if house is not null then
    update public.parliament_members set term_end_date=current_date-1 where user_id=p_user_id and house_id<>house and term_end_date>=current_date;
    insert into public.parliament_members(user_id,house_id,term_start_date,term_end_date)
    values(p_user_id,house,current_date,current_date+interval '4 years')
    on conflict(user_id,house_id) do update set term_start_date=least(public.parliament_members.term_start_date,excluded.term_start_date),term_end_date=excluded.term_end_date;
  elsif p_old_role in('Deputado','Presidente da Câmara','Presidente da Câmara dos Deputados','Senador','Presidente do Senado','Presidente do Senado Federal') then
    update public.parliament_members set term_end_date=current_date-1 where user_id=p_user_id and term_end_date>=current_date;
  end if;
end; $$;

create or replace function public.publish_parliament_leadership_gazette_event(p_term_id uuid,p_member_id uuid,p_house_id uuid,p_position text,p_event text,p_term_start_date date,p_term_end_date date,p_concluded_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare house_name text; profile_name text; office_label text; normalized_source uuid; entry_title text; entry_summary text; entry_content text;
begin
  select h.name,coalesce(p.full_name,p.username,'Parlamentar') into house_name,profile_name
  from public.parliament_members pm join public.parliament_houses h on h.id=p_house_id left join public.profiles p on p.id=pm.user_id where pm.id=p_member_id;
  if house_name is null or p_event not in('start','end') then return; end if;
  office_label:=public.resolve_parliament_leadership_office_label(house_name,p_position);
  normalized_source:=public.normalize_official_gazette_source_id(format('parliament-leadership-%s-%s-%s',p_event,p_term_id,p_member_id));
  if exists(select 1 from public.dou_entries where source_id=normalized_source) then return; end if;
  if p_event='start' then
    entry_title:=format('Posse em %s: %s',office_label,profile_name); entry_summary:=format('%s teve sua posse em %s oficializada.',profile_name,office_label);
    entry_content:=format('%s passa a exercer o cargo de %s na %s. Início: %s.',profile_name,office_label,house_name,coalesce(to_char(p_term_start_date,'DD/MM/YYYY'),'data indefinida'));
  else
    entry_title:=format('Encerramento de %s: %s',office_label,profile_name); entry_summary:=format('%s deixou o cargo de %s.',profile_name,office_label);
    entry_content:=format('%s encerrou o exercício de %s na %s.',profile_name,office_label,house_name);
  end if;
  insert into public.dou_entries(title,summary,content,type,source_id,published_at) values(entry_title,entry_summary,entry_content,'Nomeacao e Exoneracao',normalized_source,clock_timestamp());
end; $$;

create or replace function public.decide_judicial_request(p_request_id uuid,p_approved boolean,p_decision_reason text,p_warrant_duration_rp_days numeric default 7)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_request public.judicial_requests%rowtype; decided public.judicial_requests%rowtype; issued public.warrants%rowtype; warrant_kind text; real_seconds bigint;
begin
  if not public.justice_has_role(array['Admin','Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(trim(coalesce(p_decision_reason,'')))<20 then raise exception 'DECISION_REASON_TOO_SHORT'; end if;
  select * into old_request from public.judicial_requests where id=p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if old_request.status<>'pending' then raise exception 'REQUEST_ALREADY_DECIDED'; end if;
  if old_request.requested_by=auth.uid() then raise exception 'JUDGE_CONFLICT_OF_INTEREST'; end if;
  update public.judicial_requests set status=(case when p_approved then 'approved' else 'denied' end)::public.justice_request_status,
    decided_by=auth.uid(),decision_reason=trim(p_decision_reason),decided_at=clock_timestamp() where id=p_request_id returning * into decided;
  if p_approved and decided.request_type in('arrest_warrant','search_warrant') then
    warrant_kind:=case when decided.request_type='arrest_warrant' then 'arrest' else 'search' end; real_seconds:=public.rp_duration_to_real_seconds(p_warrant_duration_rp_days,'day');
    insert into public.warrants(warrant_number,warrant_type,target_profile_id,case_id,investigation_id,request_id,issued_by,expires_at,status)
    values(public.justice_next_number('MAN'),warrant_kind,decided.target_profile_id,decided.case_id,decided.investigation_id,decided.id,auth.uid(),clock_timestamp()+make_interval(secs=>real_seconds),'issued') returning * into issued;
  end if;
  perform public.justice_notify(decided.requested_by,case when p_approved then 'justice_request_approved' else 'justice_request_denied' end,case when p_approved then 'Seu pedido judicial foi aprovado.' else 'Seu pedido judicial foi negado.' end,'/services/justice?view=authority',jsonb_build_object('request_id',decided.id,'warrant_id',issued.id));
  perform public.justice_write_audit('judicial_request.decided','judicial_request',decided.id,to_jsonb(old_request),to_jsonb(decided),p_decision_reason);
  return jsonb_build_object('request',to_jsonb(decided),'warrant',to_jsonb(issued));
end; $$;

create or replace function public.process_automatic_stabilizers()
returns jsonb language plpgsql security definer set search_path='' as $$
declare unemployment numeric:=coalesce(economy_private.latest_indicator('unemployment_rate'),8.5); threshold numeric:=economy_private.calibration_numeric('automatic_stabilizer_unemployment_threshold',10); transfer_amount numeric; event_source_id text; created_expenditure uuid;
begin
  if auth.uid() is not null and not public.economic_has_role(array['Admin']) then raise exception 'Execução manual restrita ao Admin.' using errcode='42501'; end if;
  if unemployment<=threshold then return jsonb_build_object('status','not_required','unemployment_rate',unemployment); end if;
  transfer_amount:=least((unemployment-threshold)*economy_private.calibration_numeric('baseline_population',2000000)*25,economy_private.calibration_numeric('automatic_stabilizer_monthly_cap',100000000));
  event_source_id:='unemployment:'||to_char(date_trunc('month',public.rp_now()),'YYYY-MM');
  insert into public.government_expenditures(expenditure_type,ministry,source_table,source_id,amount,productive_share,occurred_at_rp,metadata)
  values('social_assistance','Assistência Social','automatic_stabilizers',event_source_id,transfer_amount,0,public.rp_now(),jsonb_build_object('unemployment_rate',unemployment,'threshold',threshold))
  on conflict(source_table,source_id,expenditure_type) do nothing returning id into created_expenditure;
  if created_expenditure is null then return jsonb_build_object('status','already_processed','source_id',event_source_id); end if;
  return jsonb_build_object('status','processed','amount',transfer_amount,'expenditure_id',created_expenditure);
end; $$;

create or replace function public.process_weekly_salaries()
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch uuid:=gen_random_uuid(); paid numeric:=0; quantity int:=0; treasury numeric; person record; salary numeric; account_id uuid;
begin
  if auth.uid() is not null and public.get_user_role(auth.uid())<>'Admin' then raise exception 'Apenas administradores podem processar a folha.'; end if;
  if exists(select 1 from public.salary_payments where paid_at>=date_trunc('week',clock_timestamp())) then return jsonb_build_object('success',true,'message','A folha desta semana já foi processada.'); end if;
  select treasury_balance into treasury from public.government_finances where id=1 for update;
  for person in select p.id,p.role,coalesce(p.full_name,p.username,'Servidor') name from public.profiles p where p.role in('Presidente','Vice-Presidente','Deputado','Senador','Presidente do Senado','Presidente da Câmara','Presidente da Câmara dos Deputados','Ministro') loop
    salary:=case person.role when 'Presidente' then 35000 when 'Vice-Presidente' then 24500 when 'Deputado' then 10500 when 'Senador' then 17500 when 'Presidente do Senado' then 24500 when 'Presidente da Câmara' then 21000 when 'Presidente da Câmara dos Deputados' then 21000 else 17500 end;
    select id into account_id from public.accounts where user_id=person.id for update;
    if account_id is not null and treasury>=salary then
      insert into public.salary_payments(user_id,role,title,amount,payment_batch_id) values(person.id,person.role,person.role,salary,batch);
      update public.accounts set balance=balance+salary,updated_at=clock_timestamp() where id=account_id;
      insert into public.transactions(to_account_id,amount,description,type,metadata) values(account_id,salary,'Remuneração semanal: '||person.role,'salary',jsonb_build_object('batchId',batch,'role',person.role));
      insert into public.notifications(user_id,type,content,link) values(person.id,'salary','Remuneração semanal creditada em sua conta.','/services/bank');
      treasury:=treasury-salary; paid:=paid+salary; quantity:=quantity+1;
    end if;
  end loop;
  update public.government_finances set treasury_balance=treasury,updated_at=clock_timestamp() where id=1;
  return jsonb_build_object('success',true,'batch_id',batch,'total_paid',paid,'payments_count',quantity);
end; $$;
revoke all on function public.process_weekly_salaries() from public,anon;
grant execute on function public.process_weekly_salaries() to authenticated,service_role;

-- Compatibilidade segura com o formulário partidário antigo.
create or replace function public.create_political_party(p_name text,p_acronym text,p_ideology text,p_logo_url text,p_statute text)
returns json language plpgsql security definer set search_path='' as $$
begin return public.create_political_party(p_name,p_acronym,p_ideology,p_logo_url,p_statute,'', 'Centro'::public.political_orientation); end; $$;
revoke all on function public.create_political_party(text,text,text,text,text) from public,anon;
grant execute on function public.create_political_party(text,text,text,text,text) to authenticated,service_role;

create or replace function public.protect_party_founder()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.founder_id is distinct from old.founder_id and current_setting('govrp.allow_founder_correction',true)<>'on' then raise exception 'O fundador é um registro histórico permanente.'; end if;
  return new;
end; $$;

create or replace function public.admin_correct_party_founder(p_party_id uuid,p_founder_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_founder uuid;
begin
  if public.get_user_role(auth.uid())<>'Admin' then raise exception 'Apenas a administração pode corrigir o fundador histórico.'; end if;
  if length(trim(coalesce(p_reason,'')))<20 then raise exception 'A correção exige justificativa detalhada.'; end if;
  if not exists(select 1 from public.profiles where id=p_founder_id) then raise exception 'Fundador informado não existe.'; end if;
  select founder_id into old_founder from public.political_parties where id=p_party_id for update;
  if old_founder is null then raise exception 'Partido não encontrado.'; end if;
  perform set_config('govrp.allow_founder_correction','on',true);
  update public.political_parties set founder_id=p_founder_id where id=p_party_id;
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state,current_state)
  values(p_party_id,auth.uid(),'founder_corrected',trim(p_reason),jsonb_build_object('founderId',old_founder),jsonb_build_object('founderId',p_founder_id));
  return jsonb_build_object('success',true);
end; $$;
grant execute on function public.admin_correct_party_founder(uuid,uuid,text) to authenticated,service_role;

-- Decisões completas para multas, audiências e pedidos administrativos.
create or replace function public.decide_fine_appeal(p_appeal_id uuid,p_approved boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare appeal public.fine_appeals%rowtype; fine public.police_fines%rowtype;
begin
  if not public.justice_has_role(array['Admin','Corregedor','Juiz','Delegado']) then raise exception 'Sem competência para julgar o recurso.'; end if;
  if length(trim(coalesce(p_reason,'')))<15 then raise exception 'Fundamente a decisão.'; end if;
  select * into appeal from public.fine_appeals where id=p_appeal_id for update;
  if not found or appeal.status not in('pending','under_review') then raise exception 'Recurso indisponível para decisão.'; end if;
  select * into fine from public.police_fines where id=appeal.fine_id for update;
  update public.fine_appeals set status=case when p_approved then 'approved' else 'rejected' end,reviewed_by=auth.uid(),decision_reason=trim(p_reason),reviewed_at=clock_timestamp() where id=p_appeal_id;
  if p_approved and fine.status<>'Paga' then update public.police_fines set status='Cancelada',updated_at=clock_timestamp() where id=fine.id; end if;
  perform public.justice_notify(appeal.appellant_id,'fine_appeal_decided','O recurso da multa '||fine.fine_code||' foi '||case when p_approved then 'deferido.' else 'indeferido.' end,'/services/justice?view=citizen',jsonb_build_object('appeal_id',appeal.id,'fine_id',fine.id));
  perform public.justice_write_audit('fine.appeal_decided','fine_appeal',appeal.id,to_jsonb(appeal),jsonb_build_object('approved',p_approved,'reason',trim(p_reason)),trim(p_reason));
  return jsonb_build_object('success',true);
end; $$;

create or replace function public.decide_fine_hearing(p_hearing_id uuid,p_status text,p_scheduled_at timestamptz,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare hearing public.fine_hearing_requests%rowtype; v_fine_code text;
begin
  if not public.justice_has_role(array['Admin','Corregedor','Juiz']) then raise exception 'Sem competência para gerir audiências.'; end if;
  if p_status not in('scheduled','held','denied','cancelled') then raise exception 'Situação de audiência inválida.'; end if;
  if p_status='scheduled' and (p_scheduled_at is null or p_scheduled_at<=clock_timestamp()) then raise exception 'Escolha uma data futura.'; end if;
  select * into hearing from public.fine_hearing_requests where id=p_hearing_id for update;
  if not found then raise exception 'Audiência não encontrada.'; end if;
  update public.fine_hearing_requests set status=p_status,scheduled_at=case when p_status='scheduled' then p_scheduled_at else scheduled_at end,decided_by=auth.uid(),decision_notes=trim(p_notes),updated_at=clock_timestamp() where id=p_hearing_id;
  select pf.fine_code into v_fine_code from public.police_fines pf where pf.id=hearing.fine_id;
  perform public.justice_notify(hearing.requester_id,'fine_hearing_updated','A audiência da multa '||v_fine_code||' foi atualizada.','/services/justice?view=citizen',jsonb_build_object('hearing_id',hearing.id));
  return jsonb_build_object('success',true);
end; $$;

create or replace function public.decide_citizen_justice_request(p_request_id uuid,p_status text,p_notes text,p_assigned_to uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request public.citizen_justice_requests%rowtype;
begin
  if not public.justice_has_role(array['Admin','Policial','Police','Delegado','Promotor','Juiz']) then raise exception 'Sem competência para decidir o pedido.'; end if;
  if p_status not in('under_review','more_information','approved','denied','completed','cancelled') then raise exception 'Situação inválida.'; end if;
  if length(trim(coalesce(p_notes,'')))<10 then raise exception 'Registre a fundamentação.'; end if;
  select * into request from public.citizen_justice_requests where id=p_request_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  update public.citizen_justice_requests set status=p_status,assigned_to=coalesce(p_assigned_to,auth.uid()),decision_notes=trim(p_notes),decided_at=case when p_status in('approved','denied','completed','cancelled') then clock_timestamp() else decided_at end,updated_at=clock_timestamp() where id=p_request_id;
  perform public.justice_notify(request.requester_id,'citizen_justice_request_updated','O pedido '||request.protocol_number||' foi atualizado.','/services/justice?view=citizen',jsonb_build_object('request_id',request.id,'status',p_status));
  return jsonb_build_object('success',true);
end; $$;

create or replace function public.manage_public_safety_campaign(p_campaign_id uuid,p_title text,p_summary text,p_content text,p_category text,p_starts_at timestamptz,p_ends_at timestamptz,p_is_published boolean)
returns public.public_safety_campaigns language plpgsql security definer set search_path='' as $$
declare result public.public_safety_campaigns%rowtype;
begin
  if not public.justice_has_role(array['Admin','Policial','Police','Delegado']) then raise exception 'Sem competência para publicar campanhas.'; end if;
  if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_content,'')))<20 then raise exception 'Conteúdo insuficiente.'; end if;
  if p_ends_at is not null and p_ends_at<=p_starts_at then raise exception 'Período inválido.'; end if;
  if p_campaign_id is null then
    insert into public.public_safety_campaigns(title,summary,content,category,starts_at,ends_at,is_published,created_by)
    values(trim(p_title),trim(p_summary),trim(p_content),trim(p_category),coalesce(p_starts_at,clock_timestamp()),p_ends_at,p_is_published,auth.uid()) returning * into result;
  else
    update public.public_safety_campaigns set title=trim(p_title),summary=trim(p_summary),content=trim(p_content),category=trim(p_category),starts_at=coalesce(p_starts_at,starts_at),ends_at=p_ends_at,is_published=p_is_published,updated_at=clock_timestamp() where id=p_campaign_id returning * into result;
  end if;
  return result;
end; $$;

revoke insert,update,delete on public.police_fines,public.fine_appeals,public.fine_hearing_requests,public.citizen_justice_requests,public.public_safety_campaigns from authenticated;
drop policy if exists safety_campaigns_authority_read on public.public_safety_campaigns;
create policy safety_campaigns_authority_read on public.public_safety_campaigns for select to authenticated using(public.justice_has_role(array['Admin','Policial','Police','Delegado']));
grant execute on function public.decide_fine_appeal(uuid,boolean,text) to authenticated,service_role;
grant execute on function public.decide_fine_hearing(uuid,text,timestamptz,text) to authenticated,service_role;
grant execute on function public.decide_citizen_justice_request(uuid,text,text,uuid) to authenticated,service_role;
grant execute on function public.manage_public_safety_campaign(uuid,text,text,text,text,timestamptz,timestamptz,boolean) to authenticated,service_role;

-- Mídia, publicidade institucional e integridade pública administráveis.
create or replace function public.manage_media_outlet(p_outlet_id uuid,p_name text,p_editor_id uuid,p_profile text,p_credibility numeric,p_is_active boolean)
returns public.media_outlets language plpgsql security definer set search_path='' as $$
declare result public.media_outlets%rowtype;
begin
  if public.get_user_role(auth.uid()) not in('Presidente','Admin') then raise exception 'Sem permissão para gerir veículos.'; end if;
  if p_profile not in('governista','oposicao','neutro','sensacionalista') or p_credibility not between 0 and 100 then raise exception 'Perfil editorial inválido.'; end if;
  if not exists(select 1 from public.profiles where id=p_editor_id) then raise exception 'Editor não encontrado.'; end if;
  if p_outlet_id is null then insert into public.media_outlets(name,editor_id,editorial_profile,credibility_score,is_active) values(trim(p_name),p_editor_id,p_profile,p_credibility,p_is_active) returning * into result;
  else update public.media_outlets set name=trim(p_name),editor_id=p_editor_id,editorial_profile=p_profile,credibility_score=p_credibility,is_active=p_is_active,updated_at=clock_timestamp() where id=p_outlet_id returning * into result; end if;
  return result;
end; $$;

create or replace function public.create_public_integrity_case(p_title text,p_summary text,p_accused_profiles uuid[],p_evidence jsonb,p_source_type text,p_source_id text)
returns public.public_integrity_cases language plpgsql security definer set search_path='' as $$
declare result public.public_integrity_cases%rowtype;
begin
  if not public.justice_has_role(array['Admin','Policial','Police','Delegado','Promotor','Juiz']) and public.get_user_role(auth.uid())<>'Presidente' and not exists(select 1 from public.media_outlets where editor_id=auth.uid() and is_active) then raise exception 'Sem competência para abrir caso de integridade.'; end if;
  if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_summary,'')))<20 then raise exception 'Relato insuficiente.'; end if;
  insert into public.public_integrity_cases(title,summary,accused_profiles,evidence,source_type,source_id,created_by)
  values(trim(p_title),trim(p_summary),coalesce(p_accused_profiles,'{}'),coalesce(p_evidence,'[]'),p_source_type,p_source_id,auth.uid()) returning * into result;
  insert into public.public_integrity_case_events(case_id,new_status,summary,actor_id) values(result.id,'suspicion','Suspeita registrada para apuração, sem presunção de culpa.',auth.uid());
  return result;
end; $$;
grant execute on function public.manage_media_outlet(uuid,text,uuid,text,numeric,boolean) to authenticated,service_role;
grant execute on function public.create_public_integrity_case(text,text,uuid[],jsonb,text,text) to authenticated,service_role;

-- Adoção e conclusão de sugestões sem confiar no estado calculado pelo cliente.
update public.bill_suggestions set status='Pendente' where lower(status)='pending';

create or replace function public.is_house_presiding_authority(p_actor uuid,p_house_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.get_user_role(p_actor)='Admin' or exists(
    select 1 from public.parliament_leadership_terms term join public.parliament_members member on member.id=term.member_id
    where term.house_id=p_house_id and term.position='president' and term.status='active' and term.term_start_date<=current_date and term.term_end_date>=current_date and member.user_id=p_actor
  );
$$;

create or replace function public.handle_suggestion_acceptance(p_suggestion_id uuid,p_house_id uuid)
returns json language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); suggestion public.bill_suggestions%rowtype; voting_id uuid; target_allowed boolean:=false;
begin
  if not public.is_house_presiding_authority(actor,p_house_id) then return json_build_object('success',false,'message','Somente a presidência da Casa pode iniciar esta votação.'); end if;
  select * into suggestion from public.bill_suggestions where id=p_suggestion_id for update;
  if not found or suggestion.status<>'Pendente' then return json_build_object('success',false,'message','Sugestão indisponível.'); end if;
  target_allowed:=case suggestion.target_type
    when 'house' then suggestion.target_id=p_house_id
    when 'parliamentarian' then exists(select 1 from public.parliament_members where user_id=suggestion.target_id and house_id=p_house_id and term_end_date>=current_date)
    when 'party' then exists(select 1 from public.party_members party_member join public.parliament_members parliament_member on parliament_member.user_id=party_member.user_id where party_member.party_id=suggestion.target_id and parliament_member.house_id=p_house_id and parliament_member.term_end_date>=current_date)
    else false end;
  if not target_allowed then return json_build_object('success',false,'message','A sugestão não pertence a esta Casa.'); end if;
  insert into public.parliament_votings(house_id,title,description,type,related_id,status,end_date)
  values(p_house_id,suggestion.title,suggestion.suggestion,'suggestion',suggestion.id,'active',clock_timestamp()+interval '24 hours') returning id into voting_id;
  update public.bill_suggestions set status='em_votacao',adopted_by=actor,updated_at=clock_timestamp() where id=suggestion.id;
  return json_build_object('success',true,'message','Sugestão enviada para votação.','voting_id',voting_id);
end; $$;

create or replace function public.reject_bill_suggestion(p_suggestion_id uuid,p_house_id uuid,p_reason text default 'Arquivada pela Casa legislativa.')
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.is_house_presiding_authority(auth.uid(),p_house_id) then raise exception 'Somente a presidência da Casa pode rejeitar a sugestão.'; end if;
  update public.bill_suggestions set status='rejeitada',updated_at=clock_timestamp() where id=p_suggestion_id and status='Pendente' and ((target_type='house' and target_id=p_house_id) or target_type in('parliamentarian','party'));
  if not found then raise exception 'Sugestão indisponível.'; end if;
  return jsonb_build_object('success',true,'message',p_reason);
end; $$;

create or replace function public.finalize_bill_suggestion_voting(p_voting_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); voting public.parliament_votings%rowtype; suggestion public.bill_suggestions%rowtype; seats int; votes_cast int; approvals int; rejections int; approved boolean; created_bill public.bills%rowtype;
begin
  select * into voting from public.parliament_votings where id=p_voting_id and type='suggestion' for update;
  if not found then raise exception 'Votação de sugestão não encontrada.'; end if;
  if not exists(select 1 from public.parliament_members where user_id=actor and house_id=voting.house_id and term_end_date>=current_date) and public.get_user_role(actor)<>'Admin' then raise exception 'Sem mandato nesta Casa.'; end if;
  select count(*) into seats from public.parliament_members where house_id=voting.house_id and term_start_date<=current_date and term_end_date>=current_date;
  select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar') into votes_cast,approvals,rejections from public.parliament_voting_votes where voting_id=voting.id;
  if voting.status='active' and clock_timestamp()<voting.end_date and votes_cast<greatest(seats,1) then return jsonb_build_object('finalized',false); end if;
  select * into suggestion from public.bill_suggestions where id=voting.related_id for update;
  approved:=approvals>=case when approvals+rejections>0 then floor((approvals+rejections)/2.0)+1 else 1 end;
  if approved and suggestion.adopted_bill_id is null then
    insert into public.bills(title,summary,full_text,author_id,house_id,author_role,status,type)
    values(suggestion.title,suggestion.suggestion,suggestion.suggestion,suggestion.author_id,voting.house_id,'Cidadão','Em tramitação',suggestion.bill_type) returning * into created_bill;
    update public.bill_suggestions set status='aprovada',adopted_by=coalesce(adopted_by,actor),adopted_bill_id=created_bill.id,updated_at=clock_timestamp() where id=suggestion.id;
  elsif not approved then update public.bill_suggestions set status='rejeitada',updated_at=clock_timestamp() where id=suggestion.id; end if;
  update public.parliament_votings set status='closed' where id=voting.id and status<>'closed';
  return jsonb_build_object('finalized',true,'approved',approved,'bill',to_jsonb(created_bill),'message',case when approved then 'Sugestão aprovada e convertida em projeto.' else 'Sugestão rejeitada pela Casa.' end);
end; $$;

revoke update,delete,insert on public.bill_suggestions from authenticated;
grant execute on function public.handle_suggestion_acceptance(uuid,uuid) to authenticated,service_role;
grant execute on function public.reject_bill_suggestion(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.finalize_bill_suggestion_voting(uuid) to authenticated,service_role;
