begin;
-- Keep the legacy entry point, but route all requests through the current approval queue.
create or replace function public.request_credit_card(p_card_brand text) returns json language plpgsql security definer set search_path='' as $$
declare result jsonb;brand text:=lower(btrim(p_card_brand));
begin
 if auth.uid() is null then raise exception 'Entre para solicitar seu cartão.' using errcode='42501';end if;
 if brand is null or brand not in ('visa','mastercard') then raise exception 'Selecione Visa ou Mastercard.';end if;
 result:=public.request_welcome_credit_card(brand);
 return (result||jsonb_build_object('message','Solicitação registrada para análise do Banco Nacional.'))::json;
end $$;
create function private.guard_card_issuance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if lower(coalesce(new.brand,'')) not in ('visa','mastercard') then raise exception 'As bandeiras disponíveis são Visa e Mastercard.';end if;
 if coalesce(new.card_type,new.type)='credit' and new.is_active then
  perform id from public.profiles where id=new.user_id for update;
  if exists(select 1 from public.cards where user_id=new.user_id and is_active and lower(brand)=lower(new.brand) and coalesce(card_type,type)='credit') then raise exception 'Já existe um cartão ativo desta bandeira.';end if;
  if (select count(*) from public.cards where user_id=new.user_id and is_active and coalesce(card_type,type)='credit')>=2 then raise exception 'O limite é de dois cartões de crédito ativos.';end if;
 end if;return new;
end $$;
create trigger guard_card_issuance before insert on public.cards for each row execute function private.guard_card_issuance();
revoke all on function private.guard_card_issuance() from public,anon,authenticated;

-- Explain the financial authorization status without exposing any banking rows.
create function public.get_agies_judicial_status(p_mission_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.assert_agies();
 return (select jsonb_build_object('status',r.status,'expires_at',r.expires_at,'decided_at',r.decided_at,'reason',r.decision_reason) from public.agies_missions m join public.judicial_requests r on r.id=m.judicial_request_id where m.id=p_mission_id and (m.agent_id=auth.uid() or private.agies_manager()));
end $$;
revoke all on function public.get_agies_judicial_status(uuid) from public,anon;
grant execute on function public.get_agies_judicial_status(uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.validate_citizen_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare k text; v jsonb; cfg jsonb;
begin
 select value into cfg from public.system_settings where key='citizen_happiness';
 if current_user not in('postgres','supabase_admin','service_role') and (new.state_enterprise_id is not null or new.residence_spec is not null) then raise exception 'Somente a gestão autorizada pode cadastrar ofertas estatais e imóveis.' using errcode='42501'; end if;
 if jsonb_typeof(new.consumable_effects)<>'object' then raise exception 'Defina os efeitos do consumível corretamente.'; end if;
 if coalesce((new.consumable_effects->>'health')::numeric,0)<0 then
   if new.category<>'Bebidas' or new.product_type<>'one-time' or new.consumable_effects<>jsonb_build_object('thirst',(cfg->>'alcohol_thirst')::numeric,'happiness',(cfg->>'alcohol_happiness')::numeric,'health',(cfg->>'alcohol_health')::numeric) then raise exception 'Bebidas alcoólicas usam sede +15, felicidade +8 e saúde -3.' using errcode='22023';end if;
   return new;
 end if;
 for k,v in select * from jsonb_each(new.consumable_effects) loop
   if k not in('hunger','thirst','happiness','hygiene') or jsonb_typeof(v)<>'number' or v::numeric<=0 or v::numeric>60 then raise exception 'Consumíveis podem recuperar até 60 pontos de fome ou sede.'; end if;
 end loop;
 if new.consumable_effects<>'{}' and (new.product_type<>'one-time' or new.category not in('Alimentos','Bebidas','Higiene')) then raise exception 'Consumíveis devem ser produtos de alimentos ou bebidas com quantidade em estoque.'; end if;
 return new;
end; $function$;
CREATE OR REPLACE FUNCTION public.citizen_need_action(p_action text, p_reference_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.citizen_needs%rowtype; item public.user_inventory%rowtype; effects jsonb; cfg jsonb; residence public.citizen_residences%rowtype; previous private.citizen_need_actions%rowtype; result jsonb;
begin
 if auth.uid() is null or p_idempotency_key is null then raise exception 'Autenticação e identificação da ação são necessárias.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 select * into previous from private.citizen_need_actions where idempotency_key=p_idempotency_key;
 if found then
   if previous.user_id<>auth.uid() or previous.action<>p_action or previous.reference_id is distinct from p_reference_id then raise exception 'Esta ação já foi usada em outra operação.'; end if;
   return previous.result;
 end if;
 n:=private.refresh_citizen_needs(auth.uid());
 if n.user_id is null then raise exception 'Conclua sua cidadania antes de cuidar das necessidades.'; end if;
 select value into cfg from public.system_settings where key='citizen_needs';
 if n.sleep_started_at is not null and p_action<>'wake' then raise exception 'Acorde antes de realizar outra atividade.'; end if;
 if p_action='wake' then
   n.sleep_started_at:=null;n.sleep_due_at:=null;n.sleep_start_value:=null;n.sleep_residence_id:=null;
 elsif p_action='consume' then
   perform private.assert_citizen_service('/services/inventory');
   select * into item from public.user_inventory where id=p_reference_id and user_id=auth.uid() and quantity>0 for update;
   if not found then raise exception 'Este item não está disponível no seu inventário.'; end if;
   select coalesce(item.metadata->'consumable_effects',consumable_effects) into effects from public.products where id=item.product_id;
   if coalesce((effects->>'health')::numeric,0)<0 then effects:=(effects-'social')||jsonb_build_object('happiness',(select (value->>'alcohol_happiness')::numeric from public.system_settings where key='citizen_happiness'));end if;
   if effects is null or effects='{}' then raise exception 'Este produto não é consumível.'; end if;
   if (coalesce((effects->>'hunger')::numeric,0)=0 or n.hunger>=100) and (coalesce((effects->>'thirst')::numeric,0)=0 or n.thirst>=100) and (coalesce((effects->>'social')::numeric,0)=0 or n.social>=100) and (coalesce((effects->>'happiness')::numeric,0)=0 or n.happiness>=100) and (coalesce((effects->>'hygiene')::numeric,0)=0 or n.hygiene>=100) then raise exception 'Suas necessidades de alimentação e bebida já estão completas.'; end if;
   if coalesce((effects->>'health')::numeric,0)<0 and n.health+(effects->>'health')::numeric<25 then raise exception 'Sua saúde está muito baixa para esta bebida. Procure atendimento no SNS antes de consumir.';end if;
   update public.user_inventory set quantity=quantity-1 where id=item.id;
   n.hunger:=greatest(0,least(100,n.hunger+coalesce((effects->>'hunger')::numeric,0)));n.thirst:=greatest(0,least(100,n.thirst+coalesce((effects->>'thirst')::numeric,0)));
   n.happiness:=greatest(0,least(100,n.happiness+coalesce((effects->>'happiness')::numeric,0)));
   n.hygiene:=greatest(0,least(100,n.hygiene+coalesce((effects->>'hygiene')::numeric,0)));
   n.social:=greatest(0,least(100,n.social+coalesce((effects->>'social')::numeric,0)));n.health:=greatest(25,least(100,n.health+coalesce((effects->>'health')::numeric,0)));
 elsif p_action in('bath','sleep') then
   perform private.assert_citizen_service('/services/national-housing');
   select * into residence from public.citizen_residences where id=p_reference_id and private.can_use_residence(id,auth.uid());
   if not found then raise exception 'Você precisa ser proprietário ou ter um aluguel ativo e pago para usar esta residência.' using errcode='42501'; end if;
   if p_action='bath' then
     if n.last_bath_rp+make_interval(hours=>coalesce((cfg->>'bath_cooldown_rp_hours')::integer,8))>public.rp_now() then raise exception 'Você já tomou banho recentemente. Aguarde o intervalo do RP.'; end if;
     n.hygiene:=least(100,n.hygiene+residence.hygiene_recovery);n.last_bath_rp:=public.rp_now();
   else
     if n.last_sleep_rp+make_interval(hours=>coalesce((cfg->>'sleep_cooldown_rp_hours')::integer,12))>public.rp_now() then raise exception 'Você já descansou recentemente. Aguarde o intervalo do RP.'; end if;
     if n.sleep>=100 then raise exception 'Seu cidadão já está descansado.'; end if;
     n.last_sleep_rp:=public.rp_now();n.sleep_started_at:=clock_timestamp();n.sleep_start_value:=n.sleep;n.sleep_residence_id:=residence.id;
     n.sleep_due_at:=n.sleep_started_at+make_interval(secs=>greatest(1,residence.sleep_minutes*60*(100-n.sleep)/100)::double precision);
   end if;
 else raise exception 'Escolha consumir, tomar banho ou dormir.'; end if;
 update public.citizen_needs set happiness=n.happiness,hunger=n.hunger,thirst=n.thirst,social=n.social,health=n.health,hygiene=n.hygiene,sleep=n.sleep,last_bath_rp=n.last_bath_rp,last_sleep_rp=n.last_sleep_rp,sleep_started_at=n.sleep_started_at,sleep_due_at=n.sleep_due_at,sleep_start_value=n.sleep_start_value,sleep_residence_id=n.sleep_residence_id,updated_at=clock_timestamp(),alert_bands=(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(n.alert_bands) where coalesce((to_jsonb(n)->>key)::numeric,0)<40) where user_id=auth.uid() returning * into n;
 result:=to_jsonb(n)||jsonb_build_object('server_now',clock_timestamp(),'rp_now',public.rp_now());
 insert into private.citizen_need_actions(user_id,action,reference_id,idempotency_key,result) values(auth.uid(),p_action,p_reference_id,p_idempotency_key,result);
 return result;
end; $function$;
CREATE OR REPLACE FUNCTION public.configure_citizen_happiness(p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k text;v numeric;previous jsonb;
begin
 if not public.is_admin() then raise exception 'Somente a administração pode configurar a felicidade.' using errcode='42501';end if;
 select value into previous from public.system_settings where key='citizen_happiness' for update;
 if jsonb_typeof(p_config) is distinct from 'object' or (p_config-array(select jsonb_object_keys(previous)))<>'{}' or (previous-array(select jsonb_object_keys(p_config)))<>'{}' then raise exception 'Informe todas as opções de felicidade.';end if;
 for k,v in select key,value::numeric from jsonb_each_text(p_config) loop
  if v is null or v::text in ('NaN','Infinity','-Infinity') or v not between -100 and 604800 then raise exception 'Configuração inválida.';end if;
 end loop;
 if (p_config->>'low_threshold')::numeric not between 0 and 50 or (p_config->>'recovery_threshold')::numeric not between 51 and 99 or (p_config->>'low_hours')::int not between 1 and 720 or (p_config->>'recovery_hours')::int not between 1 and 720 or (p_config->>'social_daily_cap')::numeric not between 0 and 20 or (p_config->>'social_cooldown_seconds')::int not between 60 and 86400 or (p_config->>'productivity_factor')::numeric not between .75 and 1 then raise exception 'Preserve os limites de tempo, recuperação e produtividade.';end if;
 if (p_config->>'election_win')::numeric not between 0 and 100 or (p_config->>'election_loss')::numeric not between -100 and 0 or (p_config->>'property_purchase')::numeric not between 0 and 30 or (p_config->>'professional_achievement')::numeric not between 0 and 10 or (p_config->>'alcohol_happiness')::numeric not between 1 and 20 or (p_config->>'alcohol_thirst')::numeric not between 1 and 60 or (p_config->>'alcohol_health')::numeric not between -10 and -1 then raise exception 'Use intensidades equilibradas nos eventos e bebidas.';end if;
 update public.system_settings set value=p_config where key='citizen_happiness';
 update public.products set consumable_effects=jsonb_build_object('thirst',(p_config->>'alcohol_thirst')::numeric,'happiness',(p_config->>'alcohol_happiness')::numeric,'health',(p_config->>'alcohol_health')::numeric) where coalesce((consumable_effects->>'health')::numeric,0)<0;
 perform economy_private.audit('happiness_configured','system_settings','citizen_happiness',previous,p_config,'Balanceamento da felicidade ficcional.',auth.uid());
 return p_config;
end $function$;
CREATE OR REPLACE FUNCTION public.request_agies_financial_authorization(p_mission_id uuid, p_investigation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare op public.agies_missions%rowtype;request_id uuid;
begin
 perform private.assert_agies();if not private.agies_manager() then raise exception 'O pedido exige a direção da AGIES.' using errcode='42501';end if;
 select * into op from public.agies_missions where id=p_mission_id for update;
 if op.id is null or op.operation_type<>'financial' or op.status<>'active' then raise exception 'Selecione uma operação financeira ativa.';end if;
 if op.judicial_request_id is not null then return op.judicial_request_id;end if;
 if not exists(select 1 from public.criminal_investigations where id=p_investigation_id and status not in ('closed','archived')) or not exists(select 1 from public.investigation_subjects where investigation_id=p_investigation_id and profile_id=op.target_id) then raise exception 'Vincule uma investigação policial aberta na qual o alvo esteja formalmente cadastrado.';end if;
 insert into public.judicial_requests(request_type,requested_by,investigation_id,target_profile_id,justification,expires_at,metadata)
 values('rp_confidentiality_break',auth.uid(),p_investigation_id,op.target_id,op.justification,clock_timestamp()+make_interval(hours=>(select (value->>'financial_access_hours')::int from public.system_settings where key='agies_rules')),jsonb_build_object('agies_mission_id',op.id,'scope','rp_bank_transactions','limit',100)) returning id into request_id;
 update public.agies_missions set judicial_request_id=request_id where id=op.id;
 perform private.agies_audit('judicial_authorization_requested',op.id,op.justification,jsonb_build_object('request',request_id,'investigation',p_investigation_id));
 perform public.justice_notify(p.id,'agies_judicial_request','Pedido de acesso financeiro fictício aguarda decisão judicial.','/services/justice?view=authority',jsonb_build_object('request_id',request_id)) from public.profiles p where p.role='Juiz' and p.deleted_at is null;
 return request_id;
end $function$;
CREATE OR REPLACE FUNCTION public.create_agies_operation(p_data jsonb, p_idempotency_key uuid)
 RETURNS agies_missions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare op public.agies_missions%rowtype;cfg jsonb;k text;target uuid;kind text;duration integer;today timestamptz;
begin
 perform private.assert_agies();
 if p_idempotency_key is null then raise exception 'Identifique a operação antes de enviar.';end if;
 perform pg_advisory_xact_lock(hashtextextended('agies-agent:'||auth.uid()::text,0));
 select * into op from public.agies_missions where idempotency_key=p_idempotency_key;
 if found then if op.agent_id<>auth.uid() then raise exception 'Identificador de outra operação.' using errcode='42501';end if;return op;end if;
 select value into cfg from public.system_settings where key='agies_rules';
 today:=date_trunc('day',clock_timestamp() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
 if (select count(*) from public.agies_missions where agent_id=auth.uid() and created_at>=today)>=(cfg->>'daily_operations')::int then raise exception 'Seu limite diário de operações foi atingido.';end if;
 if (select count(*) from public.agies_missions where agent_id=auth.uid() and status in ('awaiting_authorization','active'))>=(cfg->>'concurrent_operations')::int then raise exception 'Conclua uma operação antes de iniciar outra.';end if;
 kind:=p_data->>'type';k:=p_data->>'target_kind';target:=nullif(p_data->>'target_id','')::uuid;
 if length(btrim(coalesce(p_data->>'name','')))<5 or length(p_data->>'name')>120 or length(btrim(coalesce(p_data->>'justification','')))<30 or length(p_data->>'justification')>4000 or kind not in ('political','economic','counterintelligence','financial') or k not in ('citizen','party','company','event','institution') then raise exception 'Informe nome, tipo, alvo e uma justificativa de ao menos 30 caracteres.';end if;
 if (k='citizen' and not exists(select 1 from public.profiles where id=target and deleted_at is null and onboarding_completed)) or (k='party' and not exists(select 1 from public.political_parties where id=target and is_active)) or (k='company' and not exists(select 1 from public.businesses where id=target and status='active')) or (kind='financial' and k<>'citizen') then raise exception 'Escolha um alvo válido para o tipo de operação.';end if;
 duration:=case when kind='financial' or p_data->>'strategy'='intensive' then (cfg->>'complex_hours')::int else (cfg->>'simple_hours')::int end;
 insert into public.agies_missions(name,description,status,agent_id,target_kind,target_id,operation_type,justification,classification,strategy,budget,risk,idempotency_key)
 values(btrim(p_data->>'name'),left(coalesce(p_data->>'objective',''),2000),'awaiting_authorization',auth.uid(),k,target,kind,btrim(p_data->>'justification'),coalesce(p_data->>'classification','confidential'),coalesce(p_data->>'strategy','balanced'),(cfg->>'base_cost')::numeric*duration,case when kind='financial' then 35 when kind='counterintelligence' then 15 else 15 end+case p_data->>'strategy' when 'intensive' then 20 when 'discreet' then -5 else 0 end-least(10,coalesce((select max(quality)*.1 from public.agies_missions where operation_type='counterintelligence' and collected_at>clock_timestamp()-interval '12 hours' and status in ('completed','exposed')),0))::int,p_idempotency_key) returning * into op;
 perform private.agies_audit('operation_created',op.id,op.justification,jsonb_build_object('target_kind',k,'target',target,'budget',op.budget));
 return op;
end $function$;
CREATE OR REPLACE FUNCTION public.get_professional_activities(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; e public.business_employees%rowtype; family text; v_day timestamptz;
begin
 if auth.uid() is null then raise exception 'Entre para consultar seu trabalho.' using errcode='42501';end if;
 select * into b from public.businesses where id=p_business_id and status='active';
 select * into e from public.business_employees where business_id=b.id and profile_id=auth.uid() and fired_at is null;
 if e.id is not null then select game_family into family from public.business_role_templates where id=e.role_template_id;
 elsif b.owner_id=auth.uid() and b.owner_operates then select game_family into family from public.business_types where id=b.business_type_id;
 else raise exception 'Você precisa ter um vínculo ativo ou atuar como proprietário na operação.' using errcode='42501';end if;
 v_day:=date_trunc('day',clock_timestamp() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
 return jsonb_build_object('server_now',clock_timestamp(),'daily_limit',5,
   'used_today',(select count(*) from public.professional_work_sessions where user_id=auth.uid() and started_at>=v_day),
   'company_name',b.name,'role_name',coalesce(e.role,'Proprietário na operação'),
   'catalog',(select jsonb_agg(to_jsonb(t)||jsonb_build_object('experience',20,'role',coalesce(e.role,'Proprietário na operação'),'title',case when (e.id is null or exists(select 1 from public.business_role_templates rt where rt.id=e.role_template_id and rt.can_manage)) and t.activity_key='planning' then 'Planejar a operação empresarial' when (e.id is null or exists(select 1 from public.business_role_templates rt where rt.id=e.role_template_id and rt.can_manage)) and t.activity_key='routine' then 'Revisar recursos e prioridades' else t.title end)) from private.professional_activity_catalog(coalesce(family,'logistics')) t),
   'active',(select to_jsonb(s) from public.professional_work_sessions s where user_id=auth.uid() and status='active' and expires_at>clock_timestamp() limit 1),
   'recent',(select coalesce(jsonb_agg(to_jsonb(s) order by started_at desc),'[]') from public.professional_work_sessions s where user_id=auth.uid() and business_id=b.id and started_at>=v_day));
end $function$;

commit;
