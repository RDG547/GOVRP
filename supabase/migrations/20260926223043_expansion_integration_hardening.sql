BEGIN;
CREATE OR REPLACE FUNCTION public.issue_document_request(p_document_type text, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    current_user_id UUID := auth.uid();
    doc_fee numeric;
    user_account record; quote jsonb;
    new_doc_number text;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(current_user_id::text||':document:'||coalesce(p_document_type,''),0));
    IF p_document_type IS NULL OR p_document_type NOT IN('CNH','Passport','CPF','RG','CTD','CNPJ','Título de Eleitor','Certificado de Reservista','Certidão de Casamento','Registro Profissional') THEN RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE'; END IF;
    -- Prevent issuing duplicate documents, except for CNPJ which can have multiple.
    IF EXISTS (SELECT 1 FROM public.documents WHERE user_id = current_user_id AND type = p_document_type AND p_document_type <> 'CNPJ') THEN
      RETURN json_build_object('success', false, 'message', 'Você já possui este documento.');
    END IF;

    if p_document_type='CNPJ' and (not exists(select 1 from public.business_types where id=p_metadata->>'business_type_id' and is_active) or length(btrim(coalesce(p_metadata->>'company_name','')))<3) then raise exception 'Informe o nome empresarial e uma atividade válida para o CNPJ.'; end if;
    if p_document_type='CNPJ' then p_metadata:=(p_metadata-'business_id')||jsonb_build_object('activity_name',(select name from public.business_types where id=p_metadata->>'business_type_id')); end if;
    -- Check if user has a bank account to pay fees.
    PERFORM public.process_due_legal_effects();
    quote:=public.quote_legal_levies('document',0,false,NULL,NULL,p_document_type);
    doc_fee:=(quote->>'buyer_tax')::numeric;
    SELECT * INTO user_account FROM public.accounts WHERE user_id = current_user_id FOR UPDATE;
    IF user_account IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Você precisa de uma conta bancária para solicitar documentos.');
    END IF;

    -- Check for sufficient balance.
    IF user_account.balance < doc_fee THEN
        RETURN json_build_object('success', false, 'message', 'Saldo insuficiente para pagar a taxa de emissão.');
    END IF;

    -- Generate a unique number for the new document.
    new_doc_number := public.generate_unique_document_number(p_document_type);

    -- Insert the new document record.
    INSERT INTO public.documents (user_id, type, document_number, issued_at, expires_at, is_valid, metadata)
    VALUES (
        current_user_id,
        p_document_type,
        new_doc_number,
        now(),
        CASE
            WHEN p_document_type = 'CNH' THEN now() + interval '5 years'
            WHEN p_document_type = 'Passport' THEN now() + interval '10 years'
            ELSE NULL
        END,
        true,
        p_metadata -- Store additional data like business names for CNPJ
    );

    -- Deduct fee if applicable and record the transaction.
    IF doc_fee > 0 THEN
        UPDATE public.accounts SET balance = balance - doc_fee WHERE id = user_account.id;
        INSERT INTO public.transactions (from_account_id, amount, description, type, metadata)
        VALUES (user_account.id, doc_fee, 'Taxa de emissão de ' || p_document_type, 'service_fee',quote);
        INSERT INTO public.government_finances(id) VALUES(1) ON CONFLICT DO NOTHING;
        UPDATE public.government_finances SET treasury_balance=treasury_balance+doc_fee WHERE id=1;
    END IF;

    -- Notify the user.
    INSERT INTO public.notifications (user_id, type, content, link)
    VALUES (current_user_id, 'document_issued', 'Seu documento ' || p_document_type || ' foi emitido com sucesso!', '/dashboard');

    RETURN json_build_object('success', true, 'message', 'Documento emitido com sucesso!');
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_party_customization(p_party_id uuid, p_customization jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare party public.political_parties%rowtype;
begin
  select * into party from public.political_parties where id=p_party_id for update;
  if not found then return json_build_object('success',false,'message','Partido não encontrado.'); end if;
  if auth.uid() is null or not coalesce(auth.uid()=party.owner_id or auth.uid()=party.president_id or public.get_user_role(auth.uid())='Admin',false) then return json_build_object('success',false,'message','Sem permissão para personalizar o partido.'); end if;
  if p_customization is null or jsonb_typeof(p_customization)<>'object' then return json_build_object('success',false,'message','Personalização inválida.'); end if;
  if p_customization ? 'font_key' and not public.valid_brand_font(p_customization->>'font_key') then raise exception 'Selecione uma fonte da biblioteca da plataforma.'; end if;
  if p_customization ? 'header_url' and coalesce(p_customization->>'header_url','')<>'' and p_customization->>'header_url' !~ '^https://' then raise exception 'Informe uma imagem HTTPS válida.'; end if;
  if party.status='Encerrado' then raise exception 'O partido está encerrado.'; end if;
  if p_customization ? 'logo_url' and coalesce(p_customization->>'logo_url','')<>'' and p_customization->>'logo_url' !~ '^https://' then raise exception 'Informe uma imagem HTTPS válida.'; end if;
  if p_customization ? 'logo_url' then update public.political_parties set logo_url=nullif(p_customization->>'logo_url','') where id=party.id; end if;
  if p_customization ? 'primary_color' then perform public.set_party_color(p_party_id,p_customization->>'primary_color'); end if;
  update public.political_parties set customization=coalesce(customization,'{}')||(p_customization-'primary_color') where id=party.id;
  insert into public.party_history(party_id,actor_id,event_type,summary,current_state) values(party.id,auth.uid(),'customization_updated','Página partidária personalizada.',p_customization);
  return json_build_object('success',true,'message','Página do partido atualizada.');
end; $function$;
CREATE OR REPLACE FUNCTION public.link_company_cnpj(p_business_id uuid, p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; d public.documents%rowtype;
begin
 select * into b from public.businesses where id=p_business_id for update;
 if auth.uid() is null or b.owner_id is distinct from auth.uid() then raise exception 'Somente o proprietário pode vincular CNPJs.' using errcode='42501'; end if;
 select * into d from public.documents where id=p_document_id and user_id=auth.uid() and type='CNPJ' and is_valid and (expires_at is null or expires_at>clock_timestamp()) for update;
 if d.id is null or not exists(select 1 from public.business_types where id=d.metadata->>'business_type_id' and is_active) or (not exists(select 1 from public.documents where id=b.cnpj_document_id and is_valid and (expires_at is null or expires_at>clock_timestamp())) and d.metadata->>'business_type_id' is distinct from b.business_type_id) then raise exception 'Selecione um CNPJ ativo e compatível com a atividade.'; end if;
 if d.metadata->>'business_id' is not null and d.metadata->>'business_id'<>b.id::text then raise exception 'CNPJ já vinculado a outra empresa.'; end if;
 update public.documents set metadata=coalesce(metadata,'{}')||jsonb_build_object('business_id',b.id) where id=d.id;
 update public.businesses set cnpj_document_id=case when exists(select 1 from public.documents where id=b.cnpj_document_id and is_valid and (expires_at is null or expires_at>clock_timestamp())) then b.cnpj_document_id else d.id end,metadata=coalesce(metadata,'{}')-'cnpj_regularization_required' where id=b.id;
end $function$;

CREATE OR REPLACE FUNCTION public.update_company_brand(p_business_id uuid,p_brand jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.businesses%rowtype;
BEGIN
 SELECT * INTO b FROM public.businesses WHERE id=p_business_id FOR UPDATE;
 IF auth.uid() IS NULL OR b.owner_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente o proprietário pode personalizar a empresa.' USING errcode='42501'; END IF;
 IF NOT coalesce(public.valid_brand_font(p_brand->>'font_key'),false) OR coalesce(p_brand->>'color','')!~'^#[0-9a-fA-F]{6}$'
  OR (coalesce(p_brand->>'logo_url','')<>'' AND p_brand->>'logo_url'!~'^https://') THEN RAISE EXCEPTION 'Confira a fonte, a cor e a imagem da empresa.'; END IF;
 UPDATE public.businesses SET logo_url=nullif(p_brand->>'logo_url',''),font_key=p_brand->>'font_key',brand_color=p_brand->>'color' WHERE id=b.id;
 PERFORM public.justice_write_audit('business.brand_updated','business',b.id,jsonb_build_object('font_key',b.font_key,'color',b.brand_color,'logo_url',b.logo_url),p_brand,'Personalização empresarial.');
END; $$;
REVOKE ALL ON FUNCTION public.update_company_brand(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_company_brand(uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.close_cnpj(p_document_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.documents%rowtype;
begin
 select * into d from public.documents where id=p_document_id and user_id=auth.uid() and type='CNPJ' for update;
 if not found then raise exception 'CNPJ não encontrado ou não pertence a você.' using errcode='42501'; end if;
 if not d.is_valid then return json_build_object('success',true,'message','Este CNPJ já está encerrado.'); end if;
 update public.documents set is_valid=false,expires_at=clock_timestamp() where id=d.id;
 update public.businesses b set cnpj_document_id=(select id from public.documents other where other.id<>d.id and other.metadata->>'business_id'=b.id::text and other.metadata->>'business_type_id'=b.business_type_id and other.is_valid and (other.expires_at is null or other.expires_at>clock_timestamp()) order by issued_at limit 1) where b.cnpj_document_id=d.id and exists(select 1 from public.documents other where other.id<>d.id and other.metadata->>'business_id'=b.id::text and other.metadata->>'business_type_id'=b.business_type_id and other.is_valid and (other.expires_at is null or other.expires_at>clock_timestamp()));
 update public.businesses b set metadata=coalesce(metadata,'{}')||jsonb_build_object('cnpj_regularization_required',true) where b.cnpj_document_id=d.id;
 return json_build_object('success',true,'message','CNPJ encerrado. O histórico, a empresa e seus produtos foram preservados.');
end $function$;
CREATE OR REPLACE FUNCTION public.get_company_page(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre para consultar empresas.' using errcode='42501'; end if;
 select * into b from public.businesses where id=p_business_id;
 if not found then return null; end if;
 return jsonb_build_object('id',b.id,'name',b.name,'description',b.description,'status',b.status,'created_at',b.created_at,'business_type_id',b.business_type_id,'logo_url',b.logo_url,'font_key',b.font_key,'brand_color',b.brand_color,'owner_id',b.owner_id,
 'owner',(select jsonb_build_object('id',id,'full_name',full_name,'avatar_url',avatar_url) from public.profiles where id=b.owner_id),
 'activity',(select name from public.business_types where id=b.business_type_id),'regularization_required',b.metadata->'cnpj_regularization_required',
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'image_url',p.image_url,'price',p.final_price)) from public.get_products_with_final_price() p where p.seller->>'business_id'=b.id::text),'[]'::jsonb),
 'cnpjs',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'number',d.document_number,'activity',coalesce(d.metadata->>'activity_name',t.name),'issued_at',d.issued_at,'is_valid',d.is_valid and (d.expires_at is null or d.expires_at>now()))) from public.documents d left join public.business_types t on t.id=d.metadata->>'business_type_id' where d.type='CNPJ' and (d.id=b.cnpj_document_id or d.metadata->>'business_id'=b.id::text)),'[]'::jsonb));
end $function$;
CREATE OR REPLACE FUNCTION public.promote_vice_president_when_presidency_empty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g public.government_terms%rowtype; a public.election_office_assignments%rowtype; successor uuid; cfg jsonb; reason text; new_start timestamptz; new_end timestamptz;
BEGIN
 IF current_setting('govrp.executive_transition',true)='replacing' THEN RETURN new; END IF;
 IF new.role<>'Presidente' AND old.role<>'Presidente' THEN RETURN new; END IF;
 IF new.role=old.role AND new.role_assigned_at IS NOT DISTINCT FROM old.role_assigned_at THEN RETURN new; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 SELECT * INTO g FROM public.government_terms WHERE ended_at IS NULL FOR UPDATE;
 IF new.role='Presidente' THEN
  IF current_setting('govrp.succession_head',true)=new.id::text THEN RETURN new; END IF;
  SELECT * INTO a FROM public.election_office_assignments WHERE NOT new.manual_role_override AND profile_id=new.id AND office_role='Presidente' AND status='active' AND term_ends_at>clock_timestamp() ORDER BY assigned_at DESC LIMIT 1;
  IF g.head_id=new.id AND g.election_id IS NOT DISTINCT FROM a.election_id AND NOT g.is_interim AND old.role='Presidente' AND NOT new.manual_role_override THEN RETURN new; END IF;
  PERFORM set_config('govrp.executive_transition','replacing',true);
  IF g.id IS NOT NULL THEN
   PERFORM private.end_government_cabinet(g.id,'Encerramento do gabinete pela posse de novo Governo.');
   UPDATE public.government_terms SET ended_at=clock_timestamp() WHERE id=g.id;
   UPDATE public.presidential_formation SET ended_at=clock_timestamp(),status='invalidated' WHERE ended_at IS NULL AND government_id=g.id;
  ELSE PERFORM private.end_government_cabinet(NULL,'Encerramento do gabinete anterior à posse do novo Governo.'); END IF;
  UPDATE public.election_office_assignments SET status='revoked',ended_at=clock_timestamp(),metadata=metadata||jsonb_build_object('reason','Posse de novo Governo')
   WHERE office_role IN ('Presidente','Vice-Presidente') AND status='active' AND profile_id<>new.id AND (a.election_id IS NULL OR election_id<>a.election_id);
  UPDATE public.profiles SET role='Cidadão',manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),
   titles=array_remove(array_remove(coalesce(titles,'{}'),'Presidente'),'Vice-Presidente')
   WHERE role IN ('Presidente','Vice-Presidente') AND id<>new.id AND deleted_at IS NULL;
  SELECT value INTO cfg FROM public.system_settings WHERE key='executive_transition_rules';
  new_start:=coalesce((select original.term_starts_at from public.elections e join public.government_terms original on original.id=e.government_id where e.id=a.election_id and e.extraordinary),a.term_starts_at,clock_timestamp());
  new_end:=coalesce(a.term_ends_at,new_start+make_interval(days=>greatest(1,coalesce((cfg->>'administrative_term_days')::integer,30))));
  INSERT INTO public.government_terms(original_president_id,head_id,election_id,term_starts_at,term_ends_at,source,leadership_history)
  VALUES(new.id,new.id,a.election_id,new_start,new_end,CASE WHEN a.id IS NULL THEN 'administrative' ELSE 'election' END,
   jsonb_build_array(jsonb_build_object('head_id',new.id,'at',clock_timestamp(),'actor_id',auth.uid(),'reason','Posse de novo Governo')));
  PERFORM set_config('govrp.executive_transition','',true);
 ELSE
  IF g.head_id IS DISTINCT FROM old.id THEN RETURN new; END IF;
  reason:=coalesce(nullif(current_setting('govrp.role_change_reason',true),''),'Vacância presidencial');
  UPDATE public.election_office_assignments SET status='revoked',ended_at=clock_timestamp(),metadata=metadata||jsonb_build_object('reason',reason)
   WHERE profile_id=old.id AND office_role='Presidente' AND status='active';
  IF g.term_ends_at<=clock_timestamp() THEN
   PERFORM private.end_government_cabinet(g.id,'Encerramento normal do mandato presidencial.');
   UPDATE public.government_terms SET ended_at=clock_timestamp() WHERE id=g.id;
   RETURN new;
  END IF;
  SELECT id INTO successor FROM public.profiles WHERE role='Vice-Presidente' AND deleted_at IS NULL AND id<>old.id ORDER BY role_assigned_at DESC NULLS LAST,id LIMIT 1 FOR UPDATE;
  IF successor IS NOT NULL THEN
   UPDATE public.government_terms SET head_id=successor,is_interim=false,source='vice_succession',cabinet_decision='pending',
    leadership_history=leadership_history||jsonb_build_array(jsonb_build_object('head_id',successor,'previous_head_id',old.id,'at',clock_timestamp(),'reason',reason)) WHERE id=g.id;
   UPDATE public.election_office_assignments SET status='revoked',ended_at=clock_timestamp() WHERE profile_id=successor AND status='active';
   IF g.election_id IS NOT NULL THEN
    INSERT INTO public.election_office_assignments(election_id,profile_id,office_role,votes_received,term_starts_at,term_ends_at,assigned_by,metadata)
    VALUES(g.election_id,successor,'Presidente',0,clock_timestamp(),g.term_ends_at,auth.uid(),jsonb_build_object('succession',true,'former_president_id',old.id))
    ON CONFLICT(election_id,profile_id,office_role) DO UPDATE SET status='active',ended_at=NULL,term_ends_at=excluded.term_ends_at,metadata=excluded.metadata;
   END IF;
   PERFORM set_config('govrp.succession_head',successor::text,true);
   UPDATE public.profiles SET role='Presidente',manual_role_override=(g.election_id IS NULL),role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),
    titles=array_remove(coalesce(titles,'{}'),'Vice-Presidente') WHERE id=successor;
   PERFORM set_config('govrp.succession_head','',true);
  ELSE PERFORM private.assign_interim_president(g.id,reason); END IF;
  PERFORM public.justice_write_audit('executive.succession','government',g.id,to_jsonb(g),jsonb_build_object('successor_id',successor),reason);
 END IF;
 PERFORM private.refresh_office_assignment_snapshot();
 RETURN new;
END; $function$;
CREATE OR REPLACE FUNCTION private.finalize_impeachment(p_voting_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select jsonb_build_object('promoted_president_id',head_id,'interim',is_interim,'government_id',id) into successor from public.government_terms where ended_at is null;
  if successor is not null then successor:=successor||coalesce((select jsonb_build_object('name',full_name,'avatar_url',avatar_url) from public.profiles where id=(successor->>'promoted_president_id')::uuid),'{}'::jsonb); end if;
 else outcome:='Impeachment rejeitado'; end if;
 update public.bills set status=outcome,updated_at=clock_timestamp(),institutional_data=institutional_data||jsonb_build_object('result',jsonb_build_object('approve',yes,'reject',no,'abstain',abstentions,'absent',greatest(seats-total,0),'required',required,'approved',approved,'decided_at',clock_timestamp(),'successor',successor,'presidency_already_vacated',previous_role is distinct from 'Presidente')) where id=b.id;
 update public.parliament_votings set status='closed' where id=v.id;
 insert into public.notifications(user_id,type,content,link,metadata)
 select id,'institutional_result',outcome||': '||b.title||'.','/services/parliament',jsonb_build_object('bill_id',b.id,'outcome',outcome,'occurred_at',clock_timestamp(),'former_president',b.institutional_data->'president_snapshot','successor',successor,'popup_pending',true,'neutral',true)
 from public.profiles where deleted_at is null and (onboarding_completed or onboarding_mode='legacy_migration');
 insert into public.dou_entries(title,summary,content,type,source_id,legal_metadata) values(outcome||': '||b.title,'Procedimento próprio do RP, decidido na Câmara dos Deputados.',yes||' votos favoráveis de '||required||' exigidos. '||coalesce(b.summary,''),'Ato Legislativo',b.id,jsonb_build_object('result',outcome,'succession',successor));
 perform public.justice_write_audit('impeachment.decided','bill',b.id,to_jsonb(b),jsonb_build_object('approved',approved,'approve',yes,'required',required,'successor',successor),'Apuração do procedimento institucional.');
 return jsonb_build_object('finalized',true,'approved',approved,'message',outcome);
end $function$;
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
 if v.status='closed' then return coalesce(v.result,'{}')||jsonb_build_object('finalized',true,'message','Votação já encerrada.'); end if;
 select * into bill from public.bills where id=v.related_id for update;
 if bill.type='IMPEACHMENT' then return private.finalize_impeachment(p_voting_id); end if;
 if lower(coalesce(bill.status,'')) in ('sancionado','promulgado','rejeitado','vetado','arquivado','sustado') then
  update public.parliament_votings set status='closed',tie_break_pending=false,result=jsonb_build_object('approved',approved,'yes',yes,'no',no,'seats',seats,'required',required) where id=v.id;
  return jsonb_build_object('finalized',true,'message','Votação encerrada; decisão institucional preservada.');
 end if;
 select count(*) into seats from public.parliament_members m where m.id=any(v.eligible_member_ids) and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id);
 select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar'),count(*) filter(where member_id=any(v.eligible_member_ids) and exists(select 1 from public.parliament_members m where m.id=member_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id))),coalesce(bool_or(member_id=v.chair_member_id),false)
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
  select pv.id,pv.status,pv.house_id,pv.result
  into other_result from public.parliament_votings pv left join public.parliament_voting_votes pvv on pvv.voting_id=pv.id
  where pv.related_id=bill.id and pv.type='bill' and pv.house_id<>v.house_id group by pv.id order by pv.created_at desc limit 1;
  if found and other_result.status='closed' then next_status:=case when coalesce((other_result.result->>'approved')::boolean,false) then 'Aguardando promulgação presidencial' else 'Rejeitado' end;
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
end $function$;

INSERT INTO public.system_settings(key,value,description) VALUES('parliament_proposition_voting_rules',
 '{"PL":"simple_majority","PLP":"absolute_majority","PEC":"qualified_majority","PDL":"simple_majority"}',
 'Regra estrutural por categoria de proposição; cada votação preserva seu snapshot.') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.configure_proposition_voting_rule(p_type text,p_rule_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Somente Admin pode configurar o regimento de votação.' USING errcode='42501'; END IF;
 IF p_type NOT IN ('PL','PLP','PEC','PDL') OR NOT EXISTS(SELECT 1 FROM public.parliament_voting_rules WHERE key=p_rule_key) THEN RAISE EXCEPTION 'Escolha uma categoria e uma regra disponíveis.'; END IF;
 UPDATE public.system_settings SET value=jsonb_set(value,ARRAY[p_type],to_jsonb(p_rule_key)),updated_at=clock_timestamp() WHERE key='parliament_proposition_voting_rules';
 PERFORM public.justice_write_audit('parliament.voting_rule','system_settings',NULL,NULL,jsonb_build_object('type',p_type,'rule',p_rule_key),'Regra de proposição configurada. Projetos existentes mantêm a regra registrada.');
END; $$;
REVOKE ALL ON FUNCTION public.configure_proposition_voting_rule(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_proposition_voting_rule(text,text) TO authenticated;
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
 new.voting_rule:=case when new.type='IMPEACHMENT' then 'qualified_majority' else coalesce((select value->>new.type from public.system_settings where key='parliament_proposition_voting_rules'),'simple_majority') end;
 return new;
end $function$;
CREATE OR REPLACE FUNCTION private.expire_marketplace_listings()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p record; active_fee boolean;
BEGIN
 SELECT active_listing_fee_enabled AND active_listing_fee_amount>0 INTO active_fee FROM public.state_enterprises WHERE service_key='marketplace' FOR SHARE;
 IF NOT coalesce(active_fee,false) THEN RETURN;END IF;
 FOR p IN UPDATE public.products SET listing_status='awaiting_renewal' WHERE state_enterprise_id IS NULL AND listing_status='active'
  AND listing_paid_until<=clock_timestamp() AND archived_at IS NULL RETURNING id,seller_id,name,listing_paid_until LOOP
  INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(p.seller_id,'marketplace_listing_expired',
   'O anúncio '||p.name||' aguarda renovação. Nenhum valor foi debitado automaticamente.','/dashboard/citizen?tab=business',jsonb_build_object('product_id',p.id,'expired_at',p.listing_paid_until));
 END LOOP;
END; $function$;
CREATE OR REPLACE FUNCTION public.configure_marketplace_fees(p_percentage numeric, p_fixed_fee numeric, p_publication_mode text, p_manager_id uuid, p_listing_enabled boolean, p_listing_amount numeric, p_period_days integer)
 RETURNS state_enterprises
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE previous public.state_enterprises%rowtype; result public.state_enterprises%rowtype;
BEGIN
 IF NOT coalesce(public.can_manage_marketplace(),false) THEN RAISE EXCEPTION 'Você não tem permissão para gerir este marketplace.' USING errcode='42501';END IF;
 IF p_fixed_fee IS NULL OR p_fixed_fee<0 OR p_fixed_fee>1000000 OR p_listing_amount IS NULL OR p_listing_amount<0 OR p_listing_amount>1000000 OR p_period_days IS NULL OR p_period_days NOT BETWEEN 1 AND 365 OR p_listing_enabled IS NULL THEN RAISE EXCEPTION 'Confira os valores das taxas e o período de 1 a 365 dias reais.'; END IF;
 SELECT * INTO previous FROM public.state_enterprises WHERE service_key='marketplace' FOR UPDATE;
 PERFORM public.configure_marketplace('percentage',p_percentage,p_publication_mode,p_manager_id);
 UPDATE public.state_enterprises SET fixed_sale_fee=round(p_fixed_fee,2),active_listing_fee_enabled=p_listing_enabled,
  active_listing_fee_amount=round(p_listing_amount,2),active_listing_fee_period=p_period_days,updated_at=clock_timestamp()
  WHERE id=previous.id RETURNING * INTO result;
 IF p_listing_enabled AND p_listing_amount>0 AND (NOT previous.active_listing_fee_enabled OR previous.active_listing_fee_amount=0) THEN
  -- Existing advertisements get a full free adaptation period. No automatic debit.
  UPDATE public.products SET listing_paid_until=clock_timestamp()+make_interval(days=>p_period_days),listing_status='active',
   listing_fee_snapshot=jsonb_build_object('amount',0,'period_days',p_period_days,'grace_period',true,'policy_amount',p_listing_amount)
   WHERE state_enterprise_id IS NULL AND archived_at IS NULL AND listing_paid_until IS NULL;
  INSERT INTO public.notifications(user_id,type,content,link,metadata)
  SELECT DISTINCT seller_id,'marketplace_listing_policy','A taxa de anúncio ativo foi habilitada. Seus anúncios existentes têm um período gratuito de adaptação; a renovação será manual.',
   '/dashboard/citizen?tab=business',jsonb_build_object('amount',p_listing_amount,'period_days',p_period_days)
   FROM public.products WHERE state_enterprise_id IS NULL AND archived_at IS NULL;
 ELSIF NOT p_listing_enabled OR p_listing_amount=0 THEN
  UPDATE public.products SET listing_status='active' WHERE state_enterprise_id IS NULL AND listing_status='awaiting_renewal';
 END IF;
 PERFORM public.justice_write_audit('marketplace.fees','state_enterprise',result.id,to_jsonb(previous),to_jsonb(result),'Taxas de venda e anúncio configuradas.');
 RETURN result;
END; $function$;
NOTIFY pgrst,'reload schema';
COMMIT;
