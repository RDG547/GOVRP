begin;
set local lock_timeout='10s';
create function public.valid_brand_font(p_key text) returns boolean language sql immutable set search_path='' as $$ select p_key=any(array['default','modern','institutional','classic','elegant','geometric','editorial','technical']) $$;
revoke all on function public.valid_brand_font(text) from public,anon;
grant execute on function public.valid_brand_font(text) to authenticated,service_role;
alter table public.political_parties add constraint party_font_library check (customization->>'font_key' is null or public.valid_brand_font(customization->>'font_key'));
alter table public.businesses add column logo_url text, add column font_key text not null default 'default' check(public.valid_brand_font(font_key)), add column brand_color text not null default '#64748B' check(brand_color~'^#[0-9a-fA-F]{6}$'), add column cnpj_document_id uuid references public.documents(id);
alter table public.business_types add column requires_cnpj boolean not null default true;
update public.businesses set metadata=coalesce(metadata,'{}')||jsonb_build_object('cnpj_regularization_required',true) where cnpj_document_id is null;
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
  if p_customization ? 'primary_color' then perform public.set_party_color(p_party_id,p_customization->>'primary_color'); end if;
  update public.political_parties set customization=coalesce(customization,'{}')||(p_customization-'primary_color') where id=party.id;
  insert into public.party_history(party_id,actor_id,event_type,summary,current_state) values(party.id,auth.uid(),'customization_updated','Página partidária personalizada.',p_customization);
  return json_build_object('success',true,'message','Página do partido atualizada.');
end; $function$
;
create function public.create_political_party(p_name text,p_acronym text,p_ideology text,p_logo_url text,p_statute text,p_description text,p_orientation public.political_orientation,p_color text,p_font_key text)
returns json language plpgsql security definer set search_path='' as $$ declare r json; begin
 if not coalesce(public.valid_brand_font(p_font_key),false) then raise exception 'Selecione uma fonte da biblioteca.'; end if;
 r:=public.create_political_party(p_name,p_acronym,p_ideology,p_logo_url,p_statute,p_description,p_orientation,p_color);
 if (r->>'success')::boolean then perform public.update_party_customization((r->>'party_id')::uuid,jsonb_build_object('font_key',p_font_key)); end if; return r;
end $$;
revoke all on function public.create_political_party(text,text,text,text,text,text,public.political_orientation,text,text) from public,anon;
grant execute on function public.create_political_party(text,text,text,text,text,text,public.political_orientation,text,text) to authenticated;
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
$function$
;
alter function public.register_business_authoritative(uuid,text,text,text,uuid) set schema private;
revoke all on function private.register_business_authoritative(uuid,text,text,text,uuid) from public,anon,authenticated;
create function public.register_business_authoritative(p_owner_id uuid,p_business_type_id text,p_company_name text,p_description text,p_idempotency_key uuid,p_cnpj_id uuid default null,p_brand jsonb default '{}') returns public.businesses
language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype; doc public.documents%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 select * into b from public.businesses where registration_idempotency_key=p_idempotency_key;
 if found then if b.owner_id<>p_owner_id then raise exception 'Operação não autorizada.'; end if; return b; end if;
 if not coalesce(public.valid_brand_font(coalesce(p_brand->>'font_key','default')),false) or coalesce(p_brand->>'color','#64748B')!~'^#[0-9a-fA-F]{6}$' or (coalesce(p_brand->>'logo_url','')<>'' and p_brand->>'logo_url'!~'^https://') then raise exception 'Confira a personalização da empresa.'; end if;
 select * into doc from public.documents where id=p_cnpj_id and user_id=p_owner_id and type='CNPJ' and is_valid and (expires_at is null or expires_at>clock_timestamp()) for update;
 if (select requires_cnpj from public.business_types where id=p_business_type_id) and (doc.id is null or doc.metadata->>'business_type_id' is distinct from p_business_type_id) then raise exception 'Você precisa abrir um CNPJ compatível com esta atividade antes de criar a empresa.'; end if;
 if doc.id is not null and exists(select 1 from public.businesses where cnpj_document_id=doc.id) then raise exception 'Este CNPJ já está vinculado a uma empresa.'; end if;
 b:=private.register_business_authoritative(p_owner_id,p_business_type_id,p_company_name,p_description,p_idempotency_key);
 update public.businesses set cnpj_document_id=doc.id,logo_url=nullif(p_brand->>'logo_url',''),font_key=coalesce(p_brand->>'font_key','default'),brand_color=coalesce(p_brand->>'color','#64748B') where id=b.id returning * into b;
 if doc.id is not null then update public.documents set metadata=coalesce(metadata,'{}')||jsonb_build_object('business_id',b.id) where id=doc.id; end if;
 return b;
end $$;
revoke all on function public.register_business_authoritative(uuid,text,text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.register_business_authoritative(uuid,text,text,text,uuid,uuid,jsonb) to service_role;
create function public.link_company_cnpj(p_business_id uuid,p_document_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype; d public.documents%rowtype;
begin
 select * into b from public.businesses where id=p_business_id for update;
 if auth.uid() is null or b.owner_id is distinct from auth.uid() then raise exception 'Somente o proprietário pode vincular CNPJs.' using errcode='42501'; end if;
 select * into d from public.documents where id=p_document_id and user_id=auth.uid() and type='CNPJ' and is_valid for update;
 if d.id is null or d.metadata->>'business_type_id' is distinct from b.business_type_id then raise exception 'Selecione um CNPJ ativo e compatível com a atividade.'; end if;
 if d.metadata->>'business_id' is not null and d.metadata->>'business_id'<>b.id::text then raise exception 'CNPJ já vinculado a outra empresa.'; end if;
 update public.documents set metadata=coalesce(metadata,'{}')||jsonb_build_object('business_id',b.id) where id=d.id;
 update public.businesses set cnpj_document_id=coalesce(cnpj_document_id,d.id),metadata=coalesce(metadata,'{}')-'cnpj_regularization_required' where id=b.id;
end $$;
revoke all on function public.link_company_cnpj(uuid,uuid) from public,anon;
grant execute on function public.link_company_cnpj(uuid,uuid) to authenticated;
create function public.get_company_page(p_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.businesses%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre para consultar empresas.' using errcode='42501'; end if;
 select * into b from public.businesses where id=p_business_id;
 if not found then return null; end if;
 return jsonb_build_object('id',b.id,'name',b.name,'description',b.description,'status',b.status,'created_at',b.created_at,'business_type_id',b.business_type_id,'logo_url',b.logo_url,'font_key',b.font_key,'brand_color',b.brand_color,'owner_id',b.owner_id,
 'owner',(select jsonb_build_object('id',id,'full_name',full_name,'avatar_url',avatar_url) from public.profiles where id=b.owner_id),
 'activity',(select name from public.business_types where id=b.business_type_id),'regularization_required',b.metadata->'cnpj_regularization_required',
 'cnpjs',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'number',d.document_number,'activity',t.name,'issued_at',d.issued_at,'is_valid',d.is_valid)) from public.documents d left join public.business_types t on t.id=d.metadata->>'business_type_id' where d.type='CNPJ' and (d.id=b.cnpj_document_id or d.metadata->>'business_id'=b.id::text)),'[]'::jsonb));
end $$;
revoke all on function public.get_company_page(uuid) from public,anon;
grant execute on function public.get_company_page(uuid) to authenticated;
create or replace function public.close_cnpj(p_document_id uuid) returns json language plpgsql security definer set search_path='' as $$
declare d public.documents%rowtype;
begin
 select * into d from public.documents where id=p_document_id and user_id=auth.uid() and type='CNPJ' for update;
 if not found then raise exception 'CNPJ não encontrado ou não pertence a você.' using errcode='42501'; end if;
 if not d.is_valid then return json_build_object('success',true,'message','Este CNPJ já está encerrado.'); end if;
 update public.documents set is_valid=false,expires_at=clock_timestamp() where id=d.id;
 update public.businesses b set metadata=coalesce(metadata,'{}')||jsonb_build_object('cnpj_regularization_required',true) where b.cnpj_document_id=d.id;
 return json_build_object('success',true,'message','CNPJ encerrado. O histórico, a empresa e seus produtos foram preservados.');
end $$;
commit;
