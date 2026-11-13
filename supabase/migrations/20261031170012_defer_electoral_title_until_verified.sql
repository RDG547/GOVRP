BEGIN;
CREATE OR REPLACE FUNCTION public.issue_citizen_onboarding_document(p_document_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_type text := case lower(trim(coalesce(p_document_type, '')))
    when 'cpf' then 'CPF' when 'rg' then 'RG'
    when 'título de eleitor' then 'Título de Eleitor' when 'titulo de eleitor' then 'Título de Eleitor'
    when 'ctd' then 'CTD' else null end;
  v_document public.documents%rowtype;
  v_number text;
  v_inserted boolean := false;
  v_name text;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;
  if v_type is null then raise exception 'Tipo de documento inválido.'; end if;
  if v_type = 'Título de Eleitor' then raise exception 'O Título de Eleitor será emitido posteriormente pelo DIC, após confirmação do e-mail e 24 horas de cadastro.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text || ':' || v_type, 0));

  select full_name into v_name from public.profiles
  where id = v_user_id and citizen_profile_confirmed_at is not null
    and residence_city_code is not null and initial_aspiration is not null
    and onboarding_completed = false;
  if v_name is null then raise exception 'Complete identidade, origem e perfil antes de emitir documentos.'; end if;
  if v_type in ('Título de Eleitor','CTD') and not exists (
    select 1 from public.documents where user_id = v_user_id and type in ('CPF','RG') and is_valid
    group by user_id having count(distinct type) = 2
  ) then raise exception 'Emita CPF e RG antes dos documentos obrigatórios.'; end if;

  select * into v_document from public.documents
  where user_id = v_user_id and type = v_type and is_valid = true
  order by issued_at desc limit 1;

  if not found then
    select case v_type
      when 'CPF' then cpf when 'RG' then rg
      when 'Título de Eleitor' then titulo_eleitor when 'CTD' then carteira_trabalho
    end into v_number
    from public.profiles where id = v_user_id;
    v_number := coalesce(nullif(trim(v_number), ''), public.generate_citizen_document_number(v_type));

    insert into public.documents(
      user_id, type, document_number, issued_at, is_valid, metadata, qr_code_data, full_name
    ) values (
      v_user_id, v_type, v_number, clock_timestamp(), true,
      jsonb_build_object('issued_by', 'citizen_onboarding_v2', 'onboarding_version', 2),
      'GOVRP:' || v_type || ':' || v_user_id || ':' || v_number, v_name
    ) returning * into v_document;
    v_inserted := true;
  end if;

  update public.profiles
  set cpf = case when v_type = 'CPF' then v_document.document_number else cpf end,
      rg = case when v_type = 'RG' then v_document.document_number else rg end,
      titulo_eleitor = case when v_type = 'Título de Eleitor' then v_document.document_number else titulo_eleitor end,
      carteira_trabalho = case when v_type = 'CTD' then v_document.document_number else carteira_trabalho end,
      onboarding_step = case
        when v_type = 'CTD' and exists (
  select 1 from public.documents d where d.user_id = v_user_id and d.is_valid and d.type='CTD'
) and onboarding_step in ('identity','origin','profile','civil_documents','mandatory_documents') then 'initial_status'
        when v_type in ('CPF','RG') and exists (
          select 1 from public.documents d where d.user_id = v_user_id and d.is_valid and d.type in ('CPF','RG')
          group by d.user_id having count(distinct d.type) = 2
        ) and onboarding_step in ('identity','origin','profile','civil_documents') then 'mandatory_documents'
        else onboarding_step end,
      onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_user_id;

  if v_inserted then
    perform public.record_citizen_lifecycle_event(
      v_user_id, 'document_issued', v_type || ' emitido.',
      jsonb_build_object('document_id', v_document.id, 'document_type', v_type),
      'document-issued:' || v_document.id, v_user_id
    );
    insert into public.notifications(user_id, content, link, type, metadata)
    values (v_user_id, v_type || ' emitido com sucesso.', '/services/dic', 'citizen_document',
      jsonb_build_object('document_id', v_document.id, 'document_type', v_type));
  end if;

  return jsonb_build_object('document', to_jsonb(v_document), 'created', v_inserted);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.finalize_citizen_onboarding()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_document_count integer;
  v_created_at timestamptz;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text || ':finalize', 0));
  select * into v_profile from public.profiles where id = v_user_id for update;
  if v_profile.id is null then raise exception 'Perfil não encontrado.'; end if;
  if not exists (
    select 1 from private.account_identities ai where ai.user_id = v_user_id
      and ai.real_full_name is not null and ai.real_date_of_birth is not null
      and ai.email is not null and ai.phone is not null
  ) then raise exception 'Os dados privados da conta estão incompletos.'; end if;
  if v_profile.onboarding_completed then
    return jsonb_build_object('profile', to_jsonb(v_profile) - 'email' - 'phone', 'already_completed', true);
  end if;
  if v_profile.full_name is null or v_profile.username_is_generated or v_profile.date_of_birth is null
     or v_profile.citizen_profile_confirmed_at is null then
    raise exception 'A identidade do cidadão está incompleta.';
  end if;
  if v_profile.birth_city_code is null or v_profile.residence_city_code is null
     or v_profile.birth_state_code is null or v_profile.residence_state_code is null then
    raise exception 'Origem e residência estão incompletas.';
  end if;
  if v_profile.initial_aspiration is null then raise exception 'Selecione uma aspiração inicial.'; end if;

  select count(distinct type) into v_document_count
  from public.documents
  where user_id = v_user_id and is_valid and type in ('CPF','RG','CTD');
  if v_document_count <> 3 then raise exception 'CPF, RG e CTD precisam estar emitidos para concluir a cidadania.'; end if;
  if not exists (select 1 from public.accounts where user_id = v_user_id) then
    raise exception 'A conta no Banco Nacional ainda não foi criada.';
  end if;

  v_created_at := coalesce(v_profile.citizenship_created_at, clock_timestamp());
  update public.profiles
  set onboarding_completed = true, onboarding_step = 'completed', onboarding_version = 2,
      citizenship_created_at = v_created_at, onboarding_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_user_id
  returning * into v_profile;

  perform public.record_citizen_lifecycle_event(
    v_user_id, 'citizenship_granted',
    v_profile.full_name || ' tornou-se oficialmente cidadão do GOVRP.',
    jsonb_build_object('citizenship_created_at', v_created_at, 'onboarding_version', 2),
    'citizenship-granted:' || v_user_id, v_user_id
  );
  insert into public.notifications(user_id, content, link, type, metadata)
  select v_user_id, 'Cidadania concedida a ' || v_profile.full_name || '.', '/dashboard', 'citizenship_granted',
    jsonb_build_object('citizenship_created_at', v_created_at)
  where not exists (
    select 1 from public.notifications n
    where n.user_id = v_user_id and n.type = 'citizenship_granted'
  );

  return jsonb_build_object('profile', to_jsonb(v_profile) - 'email' - 'phone', 'already_completed', false);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_eligible_electoral_title()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_uid uuid:=auth.uid();
  v_created timestamptz;
  v_confirmed timestamptz;
  v_profile public.profiles%rowtype;
  v_doc public.documents%rowtype;
  v_number text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre na sua conta para solicitar o título.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':electoral_title',0));
  SELECT created_at,email_confirmed_at INTO v_created,v_confirmed
  FROM auth.users WHERE id=v_uid AND deleted_at IS NULL;
  IF v_confirmed IS NULL THEN RAISE EXCEPTION 'Confirme seu e-mail antes de emitir o título.' USING ERRCODE='42501'; END IF;
  IF v_created IS NULL OR v_created > clock_timestamp()-interval '24 hours' THEN
    RAISE EXCEPTION 'A emissão eleitoral fica disponível após 24 horas de cadastro.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF v_profile.id IS NULL OR v_profile.deleted_at IS NOT NULL OR v_profile.onboarding_completed IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Conclua a cidadania antes de solicitar o título.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_doc FROM public.documents
  WHERE user_id=v_uid AND type='Título de Eleitor' AND is_valid
  ORDER BY issued_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_doc.issued_at < v_confirmed THEN
      RAISE EXCEPTION 'Título anterior à confirmação do e-mail; solicite análise à administração.';
    END IF;
    RETURN jsonb_build_object('document',to_jsonb(v_doc),'created',false);
  END IF;
  v_number:=public.generate_citizen_document_number('Título de Eleitor');
  INSERT INTO public.documents(user_id,type,document_number,issued_at,is_valid,metadata,qr_code_data,full_name)
  VALUES(v_uid,'Título de Eleitor',v_number,clock_timestamp(),true,
         jsonb_build_object('issued_by','electoral_verification','confirmed_email_at',v_confirmed),
         'GOVRP:Título de Eleitor:' || v_uid || ':' || v_number,v_profile.full_name)
  RETURNING * INTO v_doc;
  UPDATE public.profiles SET titulo_eleitor=v_number,updated_at=clock_timestamp() WHERE id=v_uid;
  INSERT INTO public.notifications(user_id,content,link,type,metadata)
  VALUES(v_uid,'Seu Título de Eleitor está disponível.','/services/dic','citizen_document',
         jsonb_build_object('document_id',v_doc.id,'document_type','Título de Eleitor'));
  RETURN jsonb_build_object('document',to_jsonb(v_doc),'created',true);
END $$;
REVOKE ALL ON FUNCTION public.issue_eligible_electoral_title() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_eligible_electoral_title() TO authenticated;
COMMIT;
