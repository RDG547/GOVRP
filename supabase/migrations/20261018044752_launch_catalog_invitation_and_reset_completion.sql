begin;
alter table public.minister_invitations add column popup_deferred_at timestamptz;
create function public.defer_government_invitation_popup(p_invitation_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Entre para adiar o aviso.' using errcode='42501';end if;
 update public.minister_invitations set popup_deferred_at=coalesce(popup_deferred_at,clock_timestamp()) where id=p_invitation_id and candidate_id=auth.uid() and status='pending';
end $$;
create function public.defer_invitation_popup(p_notification_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Entre para adiar o aviso.' using errcode='42501';end if;
 update public.notifications set metadata=metadata||jsonb_build_object('popup_deferred_at',clock_timestamp()) where id=p_notification_id and user_id=auth.uid() and type='vice_candidacy_invitation' and metadata->>'status'='pending';
end $$;
create function public.dismiss_all_informational_popups() returns integer language plpgsql security definer set search_path='' as $$
declare count_updated integer;
begin
 if auth.uid() is null then raise exception 'Entre para fechar seus avisos.' using errcode='42501';end if;
 update public.notifications set is_read=true,metadata=coalesce(metadata,'{}')||jsonb_build_object('popup_pending',false,'popup_shown_at',clock_timestamp())
 where user_id=auth.uid() and metadata->>'popup_shown_at' is null and type in ('role_changed','office_awarded','business_balance','salary_payment_failed','election_candidacy_open','election_voting_open','election_result_published','institutional_result');
 get diagnostics count_updated=row_count;return count_updated;
end $$;
revoke all on function public.defer_government_invitation_popup(uuid),public.defer_invitation_popup(uuid),public.dismiss_all_informational_popups() from public,anon;
grant execute on function public.defer_government_invitation_popup(uuid),public.defer_invitation_popup(uuid),public.dismiss_all_informational_popups() to authenticated;

create or replace function public.get_my_invitations() returns jsonb language plpgsql security definer set search_path='' as $$
declare government jsonb;vice jsonb;
begin
 if auth.uid() is null then raise exception 'Entre para consultar seus convites.' using errcode='42501';end if;
 if not exists(select 1 from private.admin_development_modes where user_id=auth.uid() and mode<>'normal' and not execute_real) then perform private.maintain_minister_invitations();end if;
 select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('office',coalesce(m.name,o.role_label),'inviter',p.full_name,'kind','government') order by i.created_at desc),'[]') into government from public.minister_invitations i left join public.government_ministries m on m.id=i.ministry_id left join public.executive_office_definitions o on o.office_key=i.office_key left join public.profiles p on p.id=i.invited_by where i.candidate_id=auth.uid();
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'office','Vice-Presidência · '||coalesce(n.metadata->>'election_name','Chapa eleitoral'),'inviter',n.metadata->>'candidate_name','created_at',n.created_at,'expires_at',e.candidacy_end_date,'kind','vice','status',case when n.metadata->>'status'='pending' and (e.candidacy_end_date<=clock_timestamp() or e.status in ('Finished','Cancelled')) then 'expired' else coalesce(n.metadata->>'status','pending') end,'popup_deferred_at',n.metadata->>'popup_deferred_at') order by n.created_at desc),'[]') into vice from public.notifications n left join public.elections e on e.id::text=n.metadata->>'election_id' where n.user_id=auth.uid() and n.type='vice_candidacy_invitation';
 return jsonb_build_object('server_now',clock_timestamp(),'items',government||vice);
end $$;

-- Keep existing offer management and authorization; add photographs and category/effects.

CREATE OR REPLACE FUNCTION public.get_presidential_formation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.presidential_formation%rowtype; offices jsonb; ministries jsonb; cfg jsonb; remaining integer;
begin
 if auth.uid() is null or coalesce(public.get_user_role(auth.uid()),'')<>'Presidente' then return null; end if;
 perform private.maintain_minister_invitations();
 insert into public.presidential_formation(user_id,government_id) select auth.uid(),id from public.government_terms where ended_at is null and head_id=auth.uid() on conflict do nothing;
 select * into f from public.presidential_formation where user_id=auth.uid() and ended_at is null for update;
 select value into cfg from public.system_settings where key='executive_governance';
 select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('appointment',cfg->'specialAppointments'->o.office_key,'invitation',(select to_jsonb(i) from public.minister_invitations i where i.government_id=f.government_id and i.office_key=o.office_key order by created_at desc limit 1)) order by sort_order),'[]') into offices from public.executive_office_definitions o where required_for_formation;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'holder_id',a.user_id,'invitation',(select to_jsonb(i) from public.minister_invitations i where i.government_id=f.government_id and i.ministry_id=m.id order by created_at desc limit 1)) order by m.name),'[]') into ministries
 from public.government_ministries m left join lateral (select user_id from public.ministers where ministry_id=m.id and status='active' order by appointed_at desc limit 1) a on true where m.is_active;
 select count(*) into remaining from jsonb_array_elements(offices) o where o->'appointment'->>'user_id' is null;
 remaining:=remaining+(select count(*) from jsonb_array_elements(ministries) m where m->>'holder_id' is null);
 if f.status='pending' then update public.presidential_formation set status='in_progress' where id=f.id returning * into f; end if;
 return to_jsonb(f)||jsonb_build_object('offices',offices,'ministries',ministries,'remaining',remaining,'awaiting',(select count(*) from public.minister_invitations where government_id=f.government_id and status='pending' and expires_at>clock_timestamp()),'revision',(select max(coalesce(responded_at,created_at)) from public.minister_invitations where government_id=f.government_id),'government',(select to_jsonb(g) from public.government_terms g where g.ended_at is null and g.head_id=auth.uid()));
end; $function$
;

CREATE OR REPLACE FUNCTION public.configure_citizen_offer(p_enterprise_id uuid, p_product_id uuid, p_offer jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.state_enterprises%rowtype; spec jsonb; pid uuid; v numeric; k text;
begin
 if not coalesce(public.can_manage_citizen_enterprise(p_enterprise_id),false) then raise exception 'Você não tem permissão para administrar esta empresa.' using errcode='42501';end if;
 select * into e from public.state_enterprises where id=p_enterprise_id for update;
 if jsonb_typeof(p_offer)<>'object' or length(btrim(coalesce(p_offer->>'name','')))<3 or length(p_offer->>'name')>120 or (p_offer->>'price') is null or (p_offer->>'price')::numeric<=0 or (p_offer->>'price')::numeric>1000000000 or (p_offer->>'stock') is null or (p_offer->>'stock')::integer not between 0 and 1000000 then raise exception 'Confira nome, preço e estoque da oferta.';end if;
 if coalesce(p_offer->>'image_url','')<>'' and (length(p_offer->>'image_url')>2048 or (p_offer->>'image_url' not like 'https://%' and p_offer->>'image_url' not like '/images/%')) then raise exception 'Use uma foto enviada à plataforma ou um endereço HTTPS válido.';end if;
 if e.service_key='national_housing' then
  spec:=p_offer->'residence_spec';
  if spec is null or not exists(select 1 from public.economic_regions where code=spec->>'state') or length(btrim(coalesce(spec->>'city','')))<2 or coalesce((spec->>'area_sqm')::numeric,0) not between 12 and 10000 or coalesce((spec->>'quality')::integer,0) not between 1 and 3 or coalesce((spec->>'hygiene_recovery')::integer,0) not between 1 and 100 or coalesce((spec->>'sleep_minutes')::numeric,0) not between 1 and 120 or coalesce((spec->>'rent_price')::numeric,0) not between 0 and 1000000000 or coalesce((spec->>'rent_period_days')::integer,0) not between 1 and 30 then raise exception 'Confira estado, cidade, área, qualidade, recuperação e condições de aluguel.';end if;
  foreach k in array array['bedrooms','bathrooms','living_rooms','kitchens'] loop
   if coalesce((spec->'rooms'->>k)::integer,-1) not between 0 and 50 then raise exception 'Informe a quantidade de cômodos de cada tipo.';end if;
  end loop;
 else
  if jsonb_typeof(p_offer->'consumable_effects')<>'object' or coalesce(p_offer->'consumable_effects','{}')='{}' then raise exception 'Informe os efeitos do alimento ou bebida.';end if;
  for k,v in select key,value::numeric from jsonb_each_text(p_offer->'consumable_effects') loop
   if k not in('hunger','thirst','hygiene','happiness','health') or v not between -10 and 100 or (k<>'health' and v<=0) then raise exception 'A recuperação de fome ou sede deve ficar entre 1 e 100.';end if;
  end loop;
 end if;
 if p_product_id is not null then
  update public.products set image_url=nullif(p_offer->>'image_url',''),category=case when spec is not null then 'Moradia' else coalesce(nullif(p_offer->>'category',''),'Alimentos') end,name=btrim(p_offer->>'name'),description=left(coalesce(p_offer->>'description',''),2000),price=round((p_offer->>'price')::numeric,2),stock=(p_offer->>'stock')::integer,residence_spec=spec,consumable_effects=case when spec is null then p_offer->'consumable_effects' else '{}'::jsonb end,archived_at=case when coalesce((p_offer->>'archived')::boolean,false) then now() end where id=p_product_id and state_enterprise_id=e.id returning id into pid;
  if pid is null then raise exception 'A oferta não pertence a esta empresa.';end if;
 else
  insert into public.products(state_enterprise_id,name,image_url,description,price,stock,category,residence_spec,consumable_effects) values(e.id,btrim(p_offer->>'name'),nullif(p_offer->>'image_url',''),left(coalesce(p_offer->>'description',''),2000),round((p_offer->>'price')::numeric,2),(p_offer->>'stock')::integer,case when spec is null then coalesce(nullif(p_offer->>'category',''),'Alimentos') else 'Moradia' end,spec,case when spec is null then p_offer->'consumable_effects' else '{}'::jsonb end) returning id into pid;
 end if;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('citizen_offer_configured','economy','products',pid,auth.uid(),jsonb_build_object('enterprise_id',e.id,'offer',p_offer),'offer-config:'||gen_random_uuid());
 return pid;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Use números válidos nos preços, cômodos, estoque e recuperação.';
end $function$
;

CREATE OR REPLACE FUNCTION private.validate_citizen_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare k text; v jsonb;
begin
 if current_user not in('postgres','supabase_admin','service_role') and (new.state_enterprise_id is not null or new.residence_spec is not null) then raise exception 'Somente a gestão autorizada pode cadastrar ofertas estatais e imóveis.' using errcode='42501'; end if;
 if jsonb_typeof(new.consumable_effects)<>'object' then raise exception 'Defina os efeitos do consumível corretamente.'; end if;
 if coalesce((new.consumable_effects->>'health')::numeric,0)<0 then
   if new.category<>'Bebidas' or new.product_type<>'one-time' or new.consumable_effects<>jsonb_build_object('thirst',15,'happiness',8,'health',-3) then raise exception 'Bebidas alcoólicas usam sede +15, felicidade +8 e saúde -3.' using errcode='22023';end if;
   return new;
 end if;
 for k,v in select * from jsonb_each(new.consumable_effects) loop
   if k not in('hunger','thirst','happiness','hygiene') or jsonb_typeof(v)<>'number' or v::numeric<=0 or v::numeric>60 then raise exception 'Consumíveis podem recuperar até 60 pontos de fome ou sede.'; end if;
 end loop;
 if new.consumable_effects<>'{}' and (new.product_type<>'one-time' or new.category not in('Alimentos','Bebidas','Higiene')) then raise exception 'Consumíveis devem ser produtos de alimentos ou bebidas com quantidade em estoque.'; end if;
 return new;
end; $function$
;

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
   if coalesce((effects->>'health')::numeric,0)<0 then effects:=(effects-'social')||jsonb_build_object('happiness',8);end if;
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.get_citizen_needs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.citizen_needs%rowtype; age_rp integer;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501';end if;
 if public.is_admin() and exists(select 1 from private.admin_development_modes where user_id=auth.uid() and mode<>'normal' and not execute_real) then
  select * into n from public.citizen_needs where user_id=auth.uid();
 else n:=private.refresh_citizen_needs(auth.uid());end if;
 if n.user_id is null then return null;end if;
 select extract(year from age(public.rp_now(),date_of_birth))::integer into age_rp from public.profiles where id=auth.uid();
 return to_jsonb(n)||jsonb_build_object('happiness_recovery_threshold',(select (value->>'recovery_threshold')::numeric from public.system_settings where key='citizen_happiness'),'happiness_recovery_hours',(select (value->>'recovery_hours')::int from public.system_settings where key='citizen_happiness'),'age_rp',greatest(0,age_rp),'rp_now',public.rp_now(),'server_now',clock_timestamp());
end;$function$
;

CREATE OR REPLACE FUNCTION private.rp_reset_policy()
 RETURNS TABLE(table_name text, reset_mode text, owner_columns text[])
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  values
    ('citizen_happiness_events','clear','{user_id}'::text[]),
    ('agies_clearances','clear','{user_id}'::text[]),
    ('agies_dossiers','clear','{responsible_id}'::text[]),
    ('agies_reports','clear','{author_id}'::text[]),
    ('agies_report_recipients','clear','{user_id}'::text[]),
    ('agies_tasks','clear','{agent_id}'::text[]),
    ('minister_invitations','clear','{candidate_id,invited_by}'::text[]),
    ('election_result_receipts','clear','{user_id}'::text[]),
    ('business_recipes','keep','{}'::text[]),
    ('business_inventory','clear','{}'::text[]),
    ('business_role_templates','keep','{}'::text[]),
    ('business_national_cycles','clear','{}'::text[]),
    ('government_terms','clear','{original_president_id,head_id}'::text[]),
    ('professional_work_sessions','clear','{user_id}'::text[]),
    ('stock_price_history','clear','{}'::text[]),
    ('residence_leases','clear','{landlord_id,tenant_id}'::text[]),
    ('economic_resources','keep','{}'::text[]),
    ('economic_regions','keep','{}'::text[]),
    ('business_daily_operations','clear','{}'::text[]),
    ('business_applications','clear','{profile_id}'::text[]),
    ('parliament_voting_rules','keep','{}'::text[]),
    ('stock_dividend_receipts','clear','{user_id}'::text[]),
    ('business_vacancies','clear','{}'::text[]),
    ('healthcare_visits','clear','{user_id}'::text[]),
    ('business_supply_contracts','clear','{}'::text[]),
    ('company_dividends','clear','{}'::text[]),
    ('citizen_professional_experience','clear','{profile_id}'::text[]),
    ('stock_index_history','clear','{}'::text[]),
    ('business_supply_orders','clear','{}'::text[]),
    ('party_treasuries','clear','{}'::text[]),
    ('party_treasury_entries','clear','{actor_id}'::text[]),
    ('citizen_needs','clear','{user_id}'::text[]),
    ('citizen_residences','clear','{owner_id}'::text[]),
    ('presidential_formation','clear','{user_id}'::text[]),
    ('executive_office_definitions','keep','{}'::text[]),
    ('accounts', 'clear', '{user_id}'::text[]),
    ('achievements', 'keep', '{}'::text[]),
    ('agies_missions', 'clear', '{agent_id}'::text[]),
    ('app_config', 'keep', '{}'::text[]),
    ('appeals', 'clear', '{filed_by}'::text[]),
    ('armed_forces_enlistment', 'clear', '{user_id}'::text[]),
    ('armed_forces_operations', 'clear', '{commander_id}'::text[]),
    ('armed_forces_reports', 'clear', '{reporter_id}'::text[]),
    ('arrests', 'clear', '{suspect_id}'::text[]),
    ('bill_status_history', 'clear', '{}'::text[]),
    ('bill_suggestions', 'clear', '{author_id}'::text[]),
    ('bill_votes', 'clear', '{}'::text[]),
    ('bills', 'clear', '{author_id}'::text[]),
    ('bills_of_exchange', 'clear', '{issuer_id,payer_id}'::text[]),
    ('business_balance_cycles', 'clear', '{owner_id}'::text[]),
    ('business_economic_snapshots', 'clear', '{}'::text[]),
    ('business_employees', 'clear', '{profile_id}'::text[]),
    ('business_transactions', 'clear', '{}'::text[]),
    ('business_types', 'keep', '{}'::text[]),
    ('businesses', 'clear', '{owner_id}'::text[]),
    ('candidates', 'clear', '{user_id,vice_candidate_id}'::text[]),
    ('card_invoice_items', 'clear', '{}'::text[]),
    ('card_invoices', 'clear', '{user_id}'::text[]),
    ('cards', 'clear', '{user_id}'::text[]),
    ('case_charges', 'clear', '{defendant_id}'::text[]),
    ('case_documents', 'clear', '{author_id}'::text[]),
    ('case_evidence', 'clear', '{}'::text[]),
    ('case_parties', 'clear', '{profile_id}'::text[]),
    ('case_timeline_events', 'clear', '{}'::text[]),
    ('citizen_economic_snapshots', 'clear', '{profile_id}'::text[]),
    ('citizen_economic_statuses', 'clear', '{profile_id}'::text[]),
    ('citizen_justice_requests', 'clear', '{requester_id}'::text[]),
    ('citizen_lifecycle_events', 'clear', '{user_id}'::text[]),
    ('citizen_objective_definitions', 'keep', '{}'::text[]),
    ('citizen_objective_progress', 'clear', '{user_id}'::text[]),
    ('comments', 'clear', '{user_id}'::text[]),
    ('commerce_orders', 'clear', '{buyer_id}'::text[]),
    ('constitution_amendments', 'clear', '{}'::text[]),
    ('constitution_articles', 'keep', '{}'::text[]),
    ('constitution_sections', 'keep', '{}'::text[]),
    ('country_constitutions', 'keep', '{}'::text[]),
    ('country_population_segments', 'reset', '{}'::text[]),
    ('country_rp_economic_snapshots', 'clear', '{}'::text[]),
    ('country_rp_events', 'clear', '{}'::text[]),
    ('country_rp_exchange_history', 'clear', '{}'::text[]),
    ('country_rp_exchange_rates', 'clear', '{}'::text[]),
    ('country_rp_states', 'reset', '{}'::text[]),
    ('credit_card_applications', 'clear', '{user_id}'::text[]),
    ('criminal_cases', 'clear', '{}'::text[]),
    ('criminal_investigations', 'clear', '{}'::text[]),
    ('criminal_records', 'clear', '{user_id}'::text[]),
    ('currency_market_cycles', 'clear', '{}'::text[]),
    ('currency_market_states', 'reset', '{}'::text[]),
    ('daily_check_ins', 'clear', '{user_id}'::text[]),
    ('decrees', 'clear', '{author_id}'::text[]),
    ('document_history', 'clear', '{user_id}'::text[]),
    ('document_requests', 'clear', '{user_id}'::text[]),
    ('documents', 'clear', '{user_id}'::text[]),
    ('domain_events', 'clear', '{}'::text[]),
    ('donation_webhook_events', 'keep', '{}'::text[]),
    ('donations', 'keep', '{}'::text[]),
    ('dou_entries', 'clear', '{}'::text[]),
    ('economic_alerts', 'clear', '{}'::text[]),
    ('economic_audit_log', 'clear', '{}'::text[]),
    ('economic_bulletins', 'clear', '{}'::text[]),
    ('economic_calibrations', 'keep', '{}'::text[]),
    ('economic_engine_runs', 'clear', '{}'::text[]),
    ('economic_events', 'clear', '{actor_profile_id}'::text[]),
    ('economic_forecasts', 'clear', '{}'::text[]),
    ('economic_indicators', 'clear', '{}'::text[]),
    ('economic_periods', 'clear', '{}'::text[]),
    ('economic_policy_decisions', 'clear', '{}'::text[]),
    ('economic_policy_effects', 'clear', '{}'::text[]),
    ('economic_sector_snapshots', 'clear', '{}'::text[]),
    ('economic_sectors', 'keep', '{}'::text[]),
    ('economic_shocks', 'clear', '{}'::text[]),
    ('economic_state', 'reset', '{}'::text[]),
    ('election_audit_log', 'clear', '{}'::text[]),
    ('election_office_assignments', 'clear', '{profile_id}'::text[]),
    ('election_settlements', 'clear', '{}'::text[]),
    ('election_types', 'keep', '{}'::text[]),
    ('elections', 'clear', '{}'::text[]),
    ('evidence_custody_events', 'clear', '{}'::text[]),
    ('fine_appeals', 'clear', '{appellant_id}'::text[]),
    ('fine_hearing_requests', 'clear', '{requester_id}'::text[]),
    ('fiscal_periods', 'clear', '{}'::text[]),
    ('followers', 'clear', '{follower_id,following_id}'::text[]),
    ('government_expenditures', 'clear', '{}'::text[]),
    ('government_finances', 'reset', '{}'::text[]),
    ('government_media_contracts', 'clear', '{}'::text[]),
    ('government_ministries', 'reset', '{}'::text[]),
    ('government_popularity_events', 'clear', '{}'::text[]),
    ('government_popularity_state', 'reset', '{}'::text[]),
    ('government_projects', 'clear', '{}'::text[]),
    ('government_revenues', 'clear', '{}'::text[]),
    ('government_rules', 'clear', '{}'::text[]),
    ('hearing_participants', 'clear', '{profile_id}'::text[]),
    ('hearings', 'clear', '{}'::text[]),
    ('investigation_events', 'clear', '{}'::text[]),
    ('investigation_parties', 'clear', '{profile_id}'::text[]),
    ('investigation_subjects', 'clear', '{profile_id}'::text[]),
    ('investment_operations', 'clear', '{user_id}'::text[]),
    ('investment_options', 'clear', '{}'::text[]),
    ('investment_portfolio_snapshots', 'clear', '{user_id}'::text[]),
    ('judicial_decisions', 'clear', '{}'::text[]),
    ('judicial_requests', 'clear', '{requested_by,target_profile_id}'::text[]),
    ('justice_audit_log', 'clear', '{}'::text[]),
    ('justice_deadlines', 'clear', '{}'::text[]),
    ('justice_number_counters', 'clear', '{}'::text[]),
    ('labor_market_snapshots', 'clear', '{}'::text[]),
    ('legal_authority_rules', 'keep', '{}'::text[]),
    ('law_effects', 'clear', '{}'::text[]),
    ('likes', 'clear', '{user_id}'::text[]),
    ('loan_applications', 'clear', '{user_id}'::text[]),
    ('loans', 'clear', '{user_id}'::text[]),
    ('media_outlets', 'clear', '{editor_id}'::text[]),
    ('minister_history', 'clear', '{minister_profile_id}'::text[]),
    ('ministers', 'clear', '{user_id}'::text[]),
    ('monetary_policy_meetings', 'clear', '{}'::text[]),
    ('national_event_decision_options', 'clear', '{}'::text[]),
    ('national_event_responses', 'clear', '{}'::text[]),
    ('national_game_events', 'clear', '{}'::text[]),
    ('national_indicator_points', 'clear', '{}'::text[]),
    ('national_media_briefs', 'clear', '{}'::text[]),
    ('news_articles', 'clear', '{author_id}'::text[]),
    ('news_categories', 'keep', '{}'::text[]),
    ('notifications', 'clear', '{user_id,sender_id}'::text[]),
    ('parliament_commission_houses', 'clear', '{}'::text[]),
    ('parliament_commission_members', 'clear', '{}'::text[]),
    ('parliament_commission_supports', 'clear', '{}'::text[]),
    ('parliament_commissions', 'clear', '{}'::text[]),
    ('parliament_houses', 'keep', '{}'::text[]),
    ('parliament_leadership_candidates', 'clear', '{}'::text[]),
    ('parliament_leadership_elections', 'clear', '{}'::text[]),
    ('parliament_leadership_terms', 'clear', '{}'::text[]),
    ('parliament_leadership_votes', 'clear', '{}'::text[]),
    ('parliament_members', 'clear', '{user_id}'::text[]),
    ('parliament_voting_votes', 'clear', '{}'::text[]),
    ('parliament_votings', 'clear', '{}'::text[]),
    ('party_affiliation_requests', 'clear', '{user_id}'::text[]),
    ('party_history', 'clear', '{}'::text[]),
    ('party_members', 'clear', '{user_id}'::text[]),
    ('penal_code', 'keep', '{}'::text[]),
    ('penal_time_brackets', 'keep', '{}'::text[]),
    ('plebiscite_votes', 'clear', '{voter_id}'::text[]),
    ('plebiscites', 'clear', '{author_id}'::text[]),
    ('police_fines', 'clear', '{user_id}'::text[]),
    ('police_investigations', 'clear', '{}'::text[]),
    ('police_occurrences', 'clear', '{user_id}'::text[]),
    ('police_reports', 'clear', '{}'::text[]),
    ('police_wanted_list', 'clear', '{profile_id}'::text[]),
    ('political_parties', 'clear', '{founder_id,owner_id}'::text[]),
    ('political_point_events', 'clear', '{user_id}'::text[]),
    ('population_segment_events', 'clear', '{}'::text[]),
    ('post_likes', 'clear', '{user_id}'::text[]),
    ('posts', 'clear', '{user_id}'::text[]),
    ('price_basket_items', 'reset', '{}'::text[]),
    ('price_observations', 'clear', '{}'::text[]),
    ('prison_activities', 'keep', '{}'::text[]),
    ('prison_activity_runs', 'clear', '{inmate_id}'::text[]),
    ('prison_appeals', 'clear', '{user_id}'::text[]),
    ('prison_cells', 'keep', '{}'::text[]),
    ('prison_events', 'clear', '{}'::text[]),
    ('prison_facilities', 'keep', '{}'::text[]),
    ('prison_hearings', 'clear', '{user_id}'::text[]),
    ('prison_terms', 'clear', '{inmate_id}'::text[]),
    ('prison_visits', 'clear', '{inmate_id,visitor_id}'::text[]),
    ('prison_wings', 'keep', '{}'::text[]),
    ('product_ownership_history', 'clear', '{user_id}'::text[]),
    ('product_reviews', 'clear', '{user_id}'::text[]),
    ('products', 'clear', '{seller_id}'::text[]),
    ('profiles', 'reset', '{}'::text[]),
    ('public_integrity_case_events', 'clear', '{}'::text[]),
    ('public_integrity_cases', 'clear', '{}'::text[]),
    ('public_safety_campaigns', 'clear', '{}'::text[]),
    ('reposts', 'clear', '{user_id}'::text[]),
    ('rp_time_settings', 'reset', '{}'::text[]),
    ('salary_payments', 'clear', '{user_id}'::text[]),
    ('security_audit_log', 'keep', '{}'::text[]),
    ('sentences', 'clear', '{defendant_id}'::text[]),
    ('state_enterprises', 'reset', '{}'::text[]),
    ('stories', 'clear', '{user_id}'::text[]),
    ('support_ticket_messages', 'keep', '{}'::text[]),
    ('support_tickets', 'keep', '{}'::text[]),
    ('system_settings', 'reset', '{}'::text[]),
    ('trade_settlement_audit', 'clear', '{user_id}'::text[]),
    ('trade_settlement_locks', 'clear', '{user_id}'::text[]),
    ('trades', 'clear', '{user_id}'::text[]),
    ('transactions', 'clear', '{}'::text[]),
    ('trends', 'clear', '{}'::text[]),
    ('user_achievements', 'clear', '{user_id}'::text[]),
    ('user_activity_sessions', 'clear', '{user_id}'::text[]),
    ('user_inventory', 'clear', '{user_id}'::text[]),
    ('user_investments', 'clear', '{user_id}'::text[]),
    ('user_page_views', 'clear', '{user_id}'::text[]),
    ('user_services', 'clear', '{user_id}'::text[]),
    ('user_subscriptions', 'clear', '{user_id,seller_id}'::text[]),
    ('users', 'keep', '{}'::text[]),
    ('votes', 'clear', '{voter_id}'::text[]),
    ('warrants', 'clear', '{target_profile_id}'::text[]),
    ('x_conversation_participants', 'clear', '{user_id}'::text[]),
    ('x_conversations', 'clear', '{}'::text[]),
    ('x_messages', 'clear', '{sender_id}'::text[]),
    ('comment_likes', 'clear', '{user_id}'::text[]),
    ('marketplace_reports', 'clear', '{reporter_id}'::text[])
$function$
;
-- Only empty legacy images receive defaults. Managers' existing photos are preserved.
update public.products set image_url=case
 when residence_spec is not null then '/images/catalog/'||case when lower(name) like '%mans%' then 'mansion' when lower(name) like '%lux%' or (residence_spec->>'quality')::int=3 then 'house' when lower(name) like '%apart%' then 'apartment' else 'studio' end||'.webp'
 when lower(name) like '%água%' then '/images/catalog/water.webp'
 when lower(name) like '%arroz%' then '/images/catalog/rice.webp'
 when coalesce((consumable_effects->>'health')::numeric,0)<0 then '/images/catalog/beer.webp'
 when lower(name) like '%sabon%' then '/images/catalog/soap.webp'
 else image_url end where state_enterprise_id is not null and nullif(image_url,'') is null;

create table private.rp_launch_backups(id uuid primary key default gen_random_uuid(),request_id uuid unique not null references private.rp_reset_requests(id),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),admins jsonb not null,snapshot jsonb not null,digest text not null,downloaded_at timestamptz);
revoke all on private.rp_launch_backups from public,anon,authenticated;
create function public.admin_backup_rp_reset(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.assert_reset_admin();req private.rp_reset_requests%rowtype;b private.rp_launch_backups%rowtype;t record;rows jsonb;world jsonb:='{}';admins jsonb;
begin
 select * into req from private.rp_reset_requests where id=p_request_id and requested_by=actor and expires_at>clock_timestamp() and completed_at is null for update;
 if req.id is null then raise exception 'Revise uma prévia de reset válida antes do backup.';end if;
 select * into b from private.rp_launch_backups where request_id=req.id;if b.id is not null then return jsonb_build_object('id',b.id,'digest',b.digest,'created_at',b.created_at,'admins',b.admins,'snapshot',b.snapshot);end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'granted_at',p.granted_at,'auth_exists',exists(select 1 from auth.users u where u.id=p.user_id)) order by p.user_id),'[]') into admins from private.platform_admins p;
 if jsonb_array_length(admins)=0 or exists(select 1 from jsonb_array_elements(admins) a where (a->>'auth_exists')::boolean is not true) then raise exception 'Um administrador não possui identidade de autenticação íntegra. Corrija antes do reset.';end if;
 for t in select table_name from private.rp_reset_policy() order by table_name loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]'') from public.%I t',t.table_name) into rows;
  world:=world||jsonb_build_object('public.'||t.table_name,rows);
 end loop;
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname not in ('rp_launch_backups','rp_reset_requests') order by c.relname loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]'') from private.%I t',t.relname) into rows;
  world:=world||jsonb_build_object('private.'||t.relname,rows);
 end loop;
 insert into private.rp_launch_backups(request_id,created_by,admins,snapshot,digest) values(req.id,actor,admins,world,encode(extensions.digest(world::text,'sha256'),'hex')) returning * into b;
 return jsonb_build_object('id',b.id,'digest',b.digest,'created_at',b.created_at,'admins',admins,'snapshot',world);
end $$;
create function public.admin_confirm_reset_backup(p_request_id uuid,p_backup_id uuid,p_digest text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.assert_reset_admin();
begin
 update private.rp_launch_backups set downloaded_at=clock_timestamp() where id=p_backup_id and request_id=p_request_id and created_by=actor and digest=p_digest;
 if not found then raise exception 'O backup não corresponde à prévia revisada.';end if;
end $$;
-- The core executor already preserves Auth anchors and private.platform_admins.
alter function public.admin_execute_rp_reset(uuid,text) set schema private;
alter function private.admin_execute_rp_reset(uuid,text) rename to execute_rp_reset_core;
revoke all on function private.execute_rp_reset_core(uuid,text) from public,anon,authenticated;
create function public.admin_execute_rp_reset(p_request_id uuid,p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.assert_reset_admin();req private.rp_reset_requests%rowtype;b private.rp_launch_backups%rowtype;before_admins uuid[];after_admins uuid[];outcome jsonb;
begin
 perform pg_advisory_xact_lock(725104,1);
 select * into req from private.rp_reset_requests where id=p_request_id and requested_by=actor for update;
 if req.id is null then raise exception 'Solicitação de reset inválida.';end if;
 if req.completed_at is not null then return req.result;end if;
 select array_agg(user_id order by user_id) into before_admins from private.platform_admins;
 if req.scope='full_rp' then
  select * into b from private.rp_launch_backups where request_id=req.id and downloaded_at is not null;
  if b.id is null then raise exception 'Crie, baixe e confirme o backup desta prévia antes do reset completo.';end if;
  if before_admins is distinct from array(select (a->>'user_id')::uuid from jsonb_array_elements(b.admins) a order by a->>'user_id') then raise exception 'A lista de administradores mudou. Gere uma nova prévia e backup.';end if;
 end if;
 outcome:=private.execute_rp_reset_core(p_request_id,p_confirmation);
 select array_agg(user_id order by user_id) into after_admins from private.platform_admins;
 if before_admins is distinct from after_admins or exists(select 1 from unnest(before_admins) a where not exists(select 1 from auth.users where id=a) or not exists(select 1 from public.profiles where id=a and deleted_at is null)) then raise exception 'A verificação dos administradores falhou. Toda a operação foi revertida.';end if;
 outcome:=outcome||jsonb_build_object('preserved_admins',cardinality(after_admins),'auth_accounts_preserved',true,'backup_id',b.id);
 update private.rp_reset_requests set result=outcome where id=req.id;
 return outcome;
end $$;
revoke all on function public.admin_backup_rp_reset(uuid),public.admin_confirm_reset_backup(uuid,uuid,text),public.admin_execute_rp_reset(uuid,text) from public,anon;
grant execute on function public.admin_backup_rp_reset(uuid),public.admin_confirm_reset_backup(uuid,uuid,text),public.admin_execute_rp_reset(uuid,text) to authenticated;

commit;
