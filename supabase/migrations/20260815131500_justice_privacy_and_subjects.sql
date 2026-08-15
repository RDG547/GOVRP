-- Privacidade de investigações, vínculo legítimo de pedidos e BO detalhado.

alter table public.police_occurrences
  add column if not exists involved_people jsonb not null default '[]'::jsonb,
  add column if not exists witnesses jsonb not null default '[]'::jsonb,
  add column if not exists evidence jsonb not null default '[]'::jsonb;

alter table public.investigation_subjects
  add column if not exists is_secret boolean not null default true,
  add column if not exists notes text;

create or replace function public.create_police_occurrence(
  p_title text,p_description text,p_occurrence_type text,p_location text,p_occurred_at timestamptz,
  p_anonymous boolean,p_priority text,p_involved_people jsonb,p_witnesses jsonb,p_evidence jsonb
)
returns public.police_occurrences language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result public.police_occurrences%rowtype;
begin
  if actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if length(trim(coalesce(p_title,'')))<5 then raise exception 'TITLE_TOO_SHORT'; end if;
  if length(trim(coalesce(p_description,'')))<20 then raise exception 'DESCRIPTION_TOO_SHORT'; end if;
  if p_priority not in('low','normal','high','urgent') then raise exception 'INVALID_PRIORITY'; end if;
  if jsonb_typeof(coalesce(p_involved_people,'[]'))<>'array' or jsonb_typeof(coalesce(p_witnesses,'[]'))<>'array' or jsonb_typeof(coalesce(p_evidence,'[]'))<>'array' then raise exception 'Detalhes complementares precisam ser listas.'; end if;
  insert into public.police_occurrences(protocol_number,title,description,details,occurrence_type,type,location,occurred_at,reported_by,user_id,anonymous,is_anonymous,priority,status,confidentiality_level,involved_people,witnesses,evidence)
  values(public.justice_next_number('BO'),trim(p_title),trim(p_description),trim(p_description),trim(p_occurrence_type),trim(p_occurrence_type),nullif(trim(p_location),''),coalesce(p_occurred_at,clock_timestamp()),case when p_anonymous then null else actor end,case when p_anonymous then null else actor end,p_anonymous,p_anonymous,p_priority,'Pendente','restricted',coalesce(p_involved_people,'[]'),coalesce(p_witnesses,'[]'),coalesce(p_evidence,'[]')) returning * into result;
  perform public.justice_write_audit('occurrence.created','police_occurrence',result.id,null,(to_jsonb(result)-'user_id'-'reported_by'),'Ocorrência registrada pelo cidadão');
  perform public.justice_notify(actor,'justice_occurrence_created','Ocorrência '||result.protocol_number||' recebida.','/services/justice?view=citizen',jsonb_build_object('occurrence_id',result.id,'protocol_number',result.protocol_number));
  return result;
end; $$;
grant execute on function public.create_police_occurrence(text,text,text,text,timestamptz,boolean,text,jsonb,jsonb,jsonb) to authenticated,service_role;

create or replace function public.add_investigation_subject(p_investigation_id uuid,p_profile_id uuid,p_subject_status text,p_notify_subject boolean,p_notes text default null)
returns public.investigation_subjects language plpgsql security definer set search_path='' as $$
declare result public.investigation_subjects%rowtype; v_investigation_number text;
begin
  if not public.justice_has_role(array['Admin','Policial','Police','Delegado']) then raise exception 'Sem competência para vincular investigados.'; end if;
  if p_subject_status not in('under_review','investigated','cleared','indicted') then raise exception 'Situação inválida.'; end if;
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Perfil não encontrado.'; end if;
  select ci.investigation_number into v_investigation_number from public.criminal_investigations ci where ci.id=p_investigation_id for update;
  if v_investigation_number is null then raise exception 'Investigação não encontrada.'; end if;
  insert into public.investigation_subjects(investigation_id,profile_id,subject_status,notified_at,is_secret,notes)
  values(p_investigation_id,p_profile_id,p_subject_status,case when p_notify_subject then clock_timestamp() else null end,not p_notify_subject,nullif(trim(p_notes),''))
  on conflict(investigation_id,profile_id) do update set subject_status=excluded.subject_status,notified_at=case when p_notify_subject then coalesce(public.investigation_subjects.notified_at,clock_timestamp()) else public.investigation_subjects.notified_at end,is_secret=case when p_notify_subject then false else public.investigation_subjects.is_secret end,notes=coalesce(excluded.notes,public.investigation_subjects.notes)
  returning * into result;
  if p_notify_subject then perform public.justice_notify(p_profile_id,'investigation_subject_notified','Seu nome foi formalmente vinculado à investigação '||v_investigation_number||'.','/services/justice?view=citizen',jsonb_build_object('investigation_id',p_investigation_id)); end if;
  perform public.justice_write_audit('investigation.subject_linked','investigation_subject',p_investigation_id,null,to_jsonb(result),coalesce(p_notes,'Vínculo de pessoa à investigação'));
  return result;
end; $$;

drop policy if exists investigation_subjects_own_read on public.investigation_subjects;
create policy investigation_subjects_own_read on public.investigation_subjects for select to authenticated using((profile_id=auth.uid() and notified_at is not null and not is_secret) or public.justice_has_role(array['Admin','Policial','Police','Delegado','Promotor','Juiz']));
revoke insert,update,delete on public.investigation_subjects from authenticated;
grant execute on function public.add_investigation_subject(uuid,uuid,text,boolean,text) to authenticated,service_role;

create or replace function public.get_my_security_status()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'warrants',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'number',w.warrant_number,'type',w.warrant_type,'status',w.status,'issuedAt',w.issued_at,'expiresAt',w.expires_at)) from public.warrants w where w.target_profile_id=auth.uid() and w.status='issued' and w.expires_at>clock_timestamp()),'[]'::jsonb),
    'investigations',coalesce((select jsonb_agg(jsonb_build_object('number',i.investigation_number,'status',s.subject_status,'openedAt',i.opened_at)) from public.investigation_subjects s join public.criminal_investigations i on i.id=s.investigation_id where s.profile_id=auth.uid() and s.notified_at is not null and not s.is_secret),'[]'::jsonb)
  );
$$;

create or replace function public.create_citizen_justice_request(
  p_request_type text,p_subject text,p_description text,p_related_occurrence_id uuid default null,
  p_related_investigation_id uuid default null,p_evidence jsonb default '[]'::jsonb
)
returns public.citizen_justice_requests language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result public.citizen_justice_requests%rowtype;
begin
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if p_request_type not in('formal_investigation','asset_release') then raise exception 'Tipo de pedido inválido.'; end if;
  if length(trim(coalesce(p_subject,'')))<5 or length(trim(coalesce(p_description,'')))<20 then raise exception 'Preencha assunto e fundamentação completos.'; end if;
  if jsonb_typeof(coalesce(p_evidence,'[]'))<>'array' then raise exception 'Evidências inválidas.'; end if;
  if p_related_occurrence_id is not null and not exists(select 1 from public.police_occurrences where id=p_related_occurrence_id and (user_id=actor or reported_by=actor)) then raise exception 'A ocorrência informada não está vinculada a você.'; end if;
  if p_related_investigation_id is not null and not exists(select 1 from public.investigation_subjects where investigation_id=p_related_investigation_id and profile_id=actor and notified_at is not null and not is_secret) then raise exception 'A investigação informada não pode ser utilizada neste pedido.'; end if;
  if p_request_type='asset_release' and p_related_occurrence_id is null and p_related_investigation_id is null then raise exception 'Vincule o pedido de liberação a uma ocorrência ou investigação legítima.'; end if;
  insert into public.citizen_justice_requests(requester_id,request_type,subject,description,related_occurrence_id,related_investigation_id,evidence)
  values(actor,p_request_type,trim(p_subject),trim(p_description),p_related_occurrence_id,p_related_investigation_id,coalesce(p_evidence,'[]')) returning * into result;
  return result;
end; $$;
