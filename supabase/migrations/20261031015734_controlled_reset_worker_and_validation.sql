BEGIN;
CREATE FUNCTION private.reset_change_triggers(p_schema text,p_table text,p_restore jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE t record;result jsonb:='[]';BEGIN
 IF NOT private.reset_worker_context() THEN RAISE EXCEPTION 'Contexto de manutenção inválido.';END IF;
 SET CONSTRAINTS ALL IMMEDIATE;
 IF p_restore IS NULL THEN FOR t IN SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid=to_regclass(format('%I.%I',p_schema,p_table)) AND NOT tgisinternal AND tgenabled<>'D' LOOP result:=result||jsonb_build_array(to_jsonb(t));EXECUTE format('ALTER TABLE %I.%I DISABLE TRIGGER %I',p_schema,p_table,t.tgname);END LOOP;
 ELSE FOR t IN SELECT * FROM jsonb_to_recordset(p_restore) AS x(tgname text,tgenabled text) LOOP EXECUTE format('ALTER TABLE %I.%I %s TRIGGER %I',p_schema,p_table,CASE t.tgenabled WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'R' THEN 'ENABLE REPLICA' ELSE 'ENABLE' END,t.tgname);END LOOP;END IF;RETURN result;
END $$;
CREATE FUNCTION private.seed_reset_world(p_request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req private.rp_reset_requests%rowtype;t record;s jsonb;v_assignments text;v_brazil jsonb;v_selic numeric;v_monthly numeric;v_actor uuid;triggers jsonb:='{}';saved jsonb;BEGIN
 SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id;v_actor:=req.requested_by;
 FOR t IN SELECT * FROM private.reset_catalog() WHERE schema_name='public' AND (strategy='reset' OR table_name IN('products','government_rules','penal_code','investment_options','country_rp_economic_snapshots','country_rp_exchange_rates','economic_regions')) LOOP triggers:=triggers||jsonb_build_object(t.table_name,private.reset_change_triggers('public',t.table_name));END LOOP;
 UPDATE public.penal_code SET minimum_sentence_units=coalesce((legal_history->0->>'minimum')::numeric,minimum_sentence_units),maximum_sentence_units=coalesce((legal_history->0->>'maximum')::numeric,maximum_sentence_units),base_fine=coalesce((legal_history->0->>'fine')::numeric,base_fine),is_active=coalesce((legal_history->0->>'active')::boolean,is_active),legal_history='[]' WHERE jsonb_array_length(legal_history)>0;
 -- A dynamic penal amendment must not survive removal of its legal source.
 FOR s IN SELECT * FROM jsonb_array_elements(coalesce(req.preview->'penal_baseline','[]')) LOOP UPDATE public.penal_code SET minimum_sentence_units=(s->'definition'->>'minimum')::numeric,maximum_sentence_units=(s->'definition'->>'maximum')::numeric,base_fine=coalesce((s->'definition'->>'fine')::numeric,0),is_active=coalesce((s->>'is_active')::boolean,true),legal_history='[]' WHERE id=(s->'definition'->>'penal_code_id')::uuid;END LOOP;
    -- Reset mutable state to schema defaults; retain only catalog definitions.
    for t in select * from (values
      ('economic_state','{id}'::text[]),
      ('government_finances','{id}'::text[]),
      ('government_popularity_state','{country_code}'::text[]),
      ('country_population_segments','{country_code,segment_key,name,description,population_share}'::text[])
    ) x(table_name,keep_columns) loop
      select string_agg(format('%I=default',attname),',') into v_assignments
      from pg_catalog.pg_attribute where attrelid=to_regclass('public.'||t.table_name) and attnum>0 and not attisdropped
        and not attname=any(t.keep_columns);
      execute format('update public.%I set %s where %I is not null',t.table_name,v_assignments,t.keep_columns[1]);
    end loop;
    insert into public.economic_state(id) values(true) on conflict do nothing;
    insert into public.government_finances(id) values(1) on conflict do nothing;
    insert into public.government_popularity_state(country_code) values('BR') on conflict do nothing;
    update public.government_finances set treasury_balance=0,loans_balance=0,corporate_card_used=0 where id=1;
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind) values
      ('corporate_tax_rate',0.10,'ratio','Alíquota sobre receitas empresariais','system'),
      ('consumption_tax_rate',0.03,'ratio','Alíquota incidente sobre compras de produtos','system'),
      ('business_license_fee',250,'BRL','Taxa para abertura de empresa','system'),
      ('public_safety_policy_index',50,'index','Intensidade da política nacional de segurança','system'),
      ('social_welfare_policy_index',50,'index','Intensidade da política nacional de bem-estar','system');

    update public.government_rules set rule_kind='tax',definition=jsonb_build_object('basis','purchase','payer',case when rule_key='corporate_tax_rate' then 'seller' else 'buyer' end,'nature','percentage','audience',case when rule_key='corporate_tax_rate' then 'business' else 'all' end) where rule_key in('corporate_tax_rate','consumption_tax_rate');
    update public.government_rules set rule_kind='fee',definition='{"basis":"license","nature":"fixed","payer":"buyer","audience":"all"}' where rule_key='business_license_fee';
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition) values('transaction_tax',0,'ratio','Imposto sobre transferências','system','tax','{"basis":"transfer","nature":"percentage","payer":"buyer","audience":"all"}');
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition)
    select 'penalty_'||replace(id::text,'-',''),maximum_sentence_units,'years_rp',name,'system','penalty',jsonb_build_object('penal_code_id',id,'minimum',minimum_sentence_units,'maximum',maximum_sentence_units,'fine',base_fine) from public.penal_code;
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition)
    select 'license_'||id,registration_fee,'BRL','Licenciamento específico: '||name,'system','fee',
      jsonb_build_object('basis','license','payer','buyer','nature','fixed','audience','business','category',id)
    from public.business_types where is_active and registration_fee>0;
    update public.government_ministries set annual_budget=0,spent_budget=0,efficiency_score=default,public_impact=0,created_by=null where id is not null;
    update public.price_basket_items set current_price=base_price,updated_at=clock_timestamp() where id is not null;
    delete from public.state_enterprises where not is_system;
    update public.state_enterprises set is_privatized=false,privatization_status='none',privatization_price=null,
      privatization_buyer_id=null,privatized_at=null,created_by=null,market_value=default,health_score=default,is_active=true,operating_business_id=null,manager_id=null,commission_type='percentage',commission_value=0,publication_mode='automatic',fixed_sale_fee=default,active_listing_fee_enabled=default,active_listing_fee_amount=default,active_listing_fee_period=default,seller_fees=default,management_settings=default,last_fiscal_cycle_at=clock_timestamp() where is_system;
    update public.rp_time_settings set rp_epoch_real_at=clock_timestamp(),rp_epoch_game_at=clock_timestamp(),
      is_paused=false,paused_real_at=null,paused_rp_at=null,updated_by=v_actor,updated_at=clock_timestamp() where id=true;
    insert into public.rp_time_settings(id,rp_epoch_game_at) values(true,clock_timestamp()) on conflict do nothing;
    delete from public.system_settings where key in (
      'executive_governance','election_office_sync','government_budget','national_budget','government_balance',
      'economic_policy','bank_policy','tax_rates','transaction_tax','enterprise_costs','basic_service_prices','national_health_policy','stock_market_session','automatic_elections'
    );
    select value into v_brazil from jsonb_array_elements(req.country_snapshots) where value->>'country_code'='BR';
    v_selic:=(v_brazil->'economy'->>'selic')::numeric;
    v_monthly:=round((power(1+v_selic/100,1.0/12)-1)*100,2);
    update public.economic_state set current_selic=v_selic,exchange_rate=(v_brazil->'economy'->>'exchangeUsd')::numeric,
      base_monthly_gdp=(v_brazil->'economy'->>'gdp')::numeric*(v_brazil->'economy'->>'exchangeUsd')::numeric/12,
      simulated_share=0.5,player_share=0.5,metadata=jsonb_build_object('origin','real_baseline','reset_request_id',req.id) where id=true;
    insert into public.system_settings(key,value) values
      ('economic_policy',jsonb_build_object('selic_rate',v_selic)),
      ('bank_policy',jsonb_build_object('loan_interest_spread',1.66,'credit_card_revolving_spread',8.06,
        'government_debt_interest_spread',0.91,'loan_interest_rate',v_monthly+1.66,
        'credit_card_revolving_rate',v_monthly+8.06,'government_debt_interest_rate',v_monthly+0.91,'credit_card_default_limit',5000)),
      ('tax_rates','{"product_tax":0,"service_tax":0}'),
      ('transaction_tax','{"type":"percentage","value":0}'),
      ('government_budget','{"areas":[]}'),('national_budget','0'),
      ('national_health_policy','{"daily_budget":5000,"cost_per_visit":25,"recovery":20,"daily_capacity":200}'),
      ('stock_market_session','{"is_open":true,"quote_interval_seconds":60}');
    update public.investment_options set current_unit_price=coalesce(initial_unit_price,100),previous_close=coalesce(initial_unit_price,100),available_shares=floated_shares,price_updated_at=clock_timestamp(),annual_return_rate=round(greatest(0.5,
      v_selic*case risk_level when 'low' then .9 when 'high' then 1.2 when 'very-high' then 1.35 else 1.05 end
      +case risk_level when 'low' then -.4 when 'high' then 2.2 when 'very-high' then 4.5 else .8 end)/100,4) where id is not null;
    update public.country_rp_states set is_playable=false,economic_baseline='{}',economic_current='{}',
      political_current='{}',demographic_current='{}',economic_engine_cursor='{}',reference_snapshot_at=null,
      economy_influence=0,politics_influence=0,society_influence=0,revision=0,last_event_type=null,last_event_summary=null,
      started_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=v_actor where country_code is not null;
    for s in select * from jsonb_array_elements(req.country_snapshots) loop
      insert into public.country_rp_states(country_code,country_name,is_playable,economic_baseline,economic_current,
        political_current,demographic_current,economic_engine_cursor,reference_snapshot_at,started_at,updated_by)
      values(s->>'country_code',s->>'country_name',true,s->'economy',s->'economy',s->'politics',s->'demographics',
        jsonb_build_object('exchangeUsd',(s->'economy'->>'exchangeUsd')::numeric),clock_timestamp(),clock_timestamp(),v_actor)
      on conflict(country_code) do update set is_playable=true,economic_baseline=excluded.economic_baseline,
        economic_current=excluded.economic_current,political_current=excluded.political_current,
        demographic_current=excluded.demographic_current,economic_engine_cursor=excluded.economic_engine_cursor,
        reference_snapshot_at=excluded.reference_snapshot_at,started_at=excluded.started_at;
      insert into public.country_rp_economic_snapshots(country_code,revision,economic_state,event_type)
      values(s->>'country_code',0,s->'economy','rp_reference_snapshot');
    end loop;
    delete from public.country_population_segments where country_code is not null;
    insert into public.country_population_segments(country_code,segment_key,name,description,population_share,
      population_count,welfare_index,political_influence,economic_participation)
    select c.country_code,v.segment_key,v.name,v.description,v.share,
      round((c.demographic_current->>'population')::numeric*v.share)::bigint,v.welfare,v.influence,v.participation
    from public.country_rp_states c cross join (values
      ('urban_workers','Trabalhadores urbanos','Cidadãos empregados nos centros urbanos.',.34,55,62,82),
      ('rural_workers','Trabalhadores rurais','Cidadãos ligados à produção e às comunidades rurais.',.14,49,45,74),
      ('entrepreneurs','Empreendedores','Proprietários e gestores de negócios produtivos.',.08,66,70,91),
      ('public_servants','Servidores públicos','Profissionais das instituições e serviços do Estado.',.09,61,72,79),
      ('students','Estudantes','População em formação acadêmica ou profissional.',.16,58,48,28),
      ('retirees','Aposentados','Cidadãos fora da população economicamente ativa.',.11,54,58,12),
      ('unemployed','Desempregados','Cidadãos em busca ativa de ocupação.',.08,35,40,8)
    ) v(segment_key,name,description,share,welfare,influence,participation) where c.is_playable;
    -- Rebuild the exchange market from real quotes, with no old RP strength/trend.
    delete from public.currency_market_states where country_code is not null;
    insert into public.currency_market_states(country_code,currency_code,base_brl_per_unit,
      economic_strength,interest_factor,inflation_factor,risk_factor,stability_factor,trend,international_demand,volatility)
    select 'BR',d.currency_code,case when d.currency_code='BRL' then 1 else (v_brazil->'exchange_rates'->>d.currency_code)::numeric end,
      d.economic_strength,d.interest_factor,d.inflation_factor,d.risk_factor,d.stability_factor,d.trend,d.international_demand,d.volatility
    from private.currency_market_defaults() d;
    insert into public.country_rp_exchange_rates(country_code,currency_code,brl_per_unit,source)
    select 'BR',key,value::numeric,'real_baseline' from jsonb_each_text(v_brazil->'exchange_rates') where key in ('USD','EUR','GBP','JPY','CNY');
 -- Reset optional product state without leaving owner CHECKs temporarily invalid.
 SELECT string_agg(format('%I=DEFAULT',a.attname),',') INTO v_assignments FROM pg_attribute a WHERE a.attrelid='public.products'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND a.attname NOT IN('id','name','price','seller_id','state_enterprise_id');
 EXECUTE 'UPDATE public.products SET '||v_assignments||',seller_id=NULL,state_enterprise_id=CASE WHEN id::text LIKE ''f210%'' OR id=md5(''govrp:catalog:soap'')::uuid THEN (SELECT id FROM public.state_enterprises WHERE service_key=''national_market'' LIMIT 1) ELSE (SELECT id FROM public.state_enterprises WHERE service_key=''national_housing'' LIMIT 1) END WHERE private.is_reset_system_offer(id)';
 -- Recreate the existing official catalog, including offers removed during play.
insert into public.products(id,state_enterprise_id,name,description,price,category,stock,consumable_effects)
select ('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f2000000-0000-4000-8000-000000000001',name,
 'Produto essencial do Mercado Nacional. Consuma pelo inventário.',price,category,1000000,jsonb_build_object(need,points)
from (values
 (1,'Pão do dia',5,'Alimentos','hunger',15),(2,'Arroz com feijão',18,'Alimentos','hunger',40),(3,'Refeição completa',30,'Alimentos','hunger',60),
 (4,'Banana',6,'Alimentos','hunger',15),(5,'Maçã',7,'Alimentos','hunger',18),(6,'Sanduíche simples',14,'Alimentos','hunger',30),
 (7,'Sopa de legumes',16,'Alimentos','hunger',35),(8,'Salada da estação',15,'Alimentos','hunger',30),(9,'Biscoitos',8,'Alimentos','hunger',18),
 (10,'Tapioca',12,'Alimentos','hunger',25),(11,'Água mineral',4,'Bebidas','thirst',40),(12,'Suco de laranja',9,'Bebidas','thirst',35),
 (13,'Água de coco',10,'Bebidas','thirst',45),(14,'Chá gelado',7,'Bebidas','thirst',30),(15,'Leite',8,'Bebidas','thirst',25)
) catalog(n,name,price,category,need,points) ON CONFLICT(id) DO UPDATE SET state_enterprise_id=excluded.state_enterprise_id,name=excluded.name,description=excluded.description,price=excluded.price,category=excluded.category,stock=excluded.stock,consumable_effects=excluded.consumable_effects;
insert into public.products(id,state_enterprise_id,name,description,price,category,stock,residence_spec)
select ('f2200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f2000000-0000-4000-8000-000000000002',name,
 description,price,'Moradia',1000000,jsonb_build_object('city',city,'state',state,'area_sqm',area,'quality',quality,'type',kind)
from (values
 (1,'Kitnet Cidadã','Residência compacta com banheiro e espaço para descanso.',750,'Brasília','DF',24,1,'kitnet'),
 (2,'Apartamento Popular','Dois ambientes e todos os cuidados básicos do cidadão.',2500,'São Paulo','SP',42,1,'popular'),
 (3,'Apartamento Familiar','Mais espaço para sua vida civil.',7000,'Belo Horizonte','MG',70,2,'apartment'),
 (4,'Casa com Quintal','Uma casa com área externa e quartos confortáveis.',16000,'Curitiba','PR',100,2,'house'),
 (5,'Residência de Alto Padrão','Área ampla e acabamento superior, com as mesmas funções essenciais.',65000,'Rio de Janeiro','RJ',220,3,'luxury')
) catalog(n,name,description,price,city,state,area,quality,kind) ON CONFLICT(id) DO UPDATE SET state_enterprise_id=excluded.state_enterprise_id,name=excluded.name,description=excluded.description,price=excluded.price,category=excluded.category,stock=excluded.stock,residence_spec=excluded.residence_spec;
insert into public.products(id,state_enterprise_id,name,description,price,stock,category,residence_spec,consumable_effects)
select md5('govrp-housing:'||r.code||':'||tier)::uuid,e.id,case tier when 1 then 'Kitnet' when 2 then 'Apartamento familiar' else 'Casa ampla' end||' em '||r.capital,'Moradia do catálogo da Imobiliária Nacional, com cômodos e recuperação definidos no contrato de aquisição.',case tier when 1 then 850 when 2 then 7500 else 21000 end,100,'Moradia',jsonb_build_object('city',r.capital,'state',r.code,'type',case tier when 1 then 'kitnet' when 2 then 'apartment' else 'house' end,'quality',tier,'area_sqm',case tier when 1 then 28 when 2 then 72 else 140 end,'rooms',jsonb_build_object('bedrooms',tier,'bathrooms',case tier when 3 then 2 else 1 end,'living_rooms',1,'kitchens',1),'hygiene_recovery',case tier when 1 then 50 when 2 then 75 else 100 end,'sleep_minutes',case tier when 1 then 18 when 2 then 12 else 6 end,'rent_price',case tier when 1 then 30 when 2 then 150 else 420 end,'rent_period_days',7),'{}'::jsonb
from public.economic_regions r cross join generate_series(1,3) tier cross join public.state_enterprises e where e.service_key='national_housing'
ON CONFLICT(id) DO UPDATE SET state_enterprise_id=excluded.state_enterprise_id,name=excluded.name,description=excluded.description,price=excluded.price,stock=excluded.stock,category=excluded.category,residence_spec=excluded.residence_spec,consumable_effects=excluded.consumable_effects;
insert into public.products(id,state_enterprise_id,name,description,price,category,product_type,consumable_effects,metadata)
select v.id::uuid,s.id,v.name,v.description,v.price,'Bebidas','one-time','{"thirst":15,"social":8,"health":-3}'::jsonb,'{"market_group":"Bebidas alcoólicas"}'::jsonb
from public.state_enterprises s cross join(values
 ('f2100000-0000-4000-8000-000000000021','Cerveja','Bebida alcoólica: recupera sede e socialização, com redução moderada de saúde.',8.50),
 ('f2100000-0000-4000-8000-000000000022','Vinho','Vinho para consumo responsável no RP. Confira os efeitos antes de consumir.',38.00),
 ('f2100000-0000-4000-8000-000000000023','Destilado','Bebida destilada com os mesmos efeitos balanceados das demais bebidas alcoólicas.',52.00)
)v(id,name,description,price) where s.service_key='national_market'
ON CONFLICT(id) DO UPDATE SET state_enterprise_id=excluded.state_enterprise_id,name=excluded.name,description=excluded.description,price=excluded.price,category=excluded.category,product_type=excluded.product_type,consumable_effects=excluded.consumable_effects,metadata=excluded.metadata;
insert into public.products(id,state_enterprise_id,name,description,price,stock,category,image_url,consumable_effects)
 select md5('govrp:catalog:soap')::uuid,id,'Sabonete','Sabonete para a higiene do cidadão no universo fictício do GOVRP.',12,10000,'Higiene','/images/catalog/soap.webp','{"hygiene":20}'::jsonb from public.state_enterprises where service_key='national_market' ON CONFLICT(id) DO UPDATE SET state_enterprise_id=excluded.state_enterprise_id,name=excluded.name,description=excluded.description,price=excluded.price,stock=excluded.stock,category=excluded.category,image_url=excluded.image_url,consumable_effects=excluded.consumable_effects;
insert into public.products(id,state_enterprise_id,name,description,price,stock,category,image_url,residence_spec)
select md5('govrp:catalog:mansion:DF')::uuid,id,'Mansão Institucional DF','Imóvel de alto padrão no universo fictício do GOVRP. Imagem meramente representativa.',1000000,5,'Moradia','/images/catalog/mansion.webp','{"type":"mansion","state":"DF","city":"Brasília","area_sqm":550,"quality":3,"rooms":{"bedrooms":5,"bathrooms":4,"living_rooms":2,"kitchens":1},"hygiene_recovery":100,"sleep_minutes":8,"rent_price":2500,"rent_period_days":7,"sale_enabled":true,"rent_enabled":true}'::jsonb from public.state_enterprises where service_key='national_housing' ON CONFLICT(id) DO UPDATE SET state_enterprise_id=excluded.state_enterprise_id,name=excluded.name,description=excluded.description,price=excluded.price,stock=excluded.stock,category=excluded.category,image_url=excluded.image_url,residence_spec=excluded.residence_spec;
 UPDATE public.products SET seller_id=NULL,business_id=NULL,sales_count=0,subscribers_count=0,promotion_price=NULL,promotion_expires_at=NULL,stock_depleted_at=NULL,archived_at=NULL,moderation_status='approved',moderation_reason=NULL,moderated_by=NULL,moderated_at=NULL,listing_status='active',listing_paid_until=NULL,listing_fee_snapshot='{}',publication_request_key=NULL,publication_request_hash=NULL,
 stock=CASE WHEN id=md5('govrp:catalog:mansion:DF')::uuid THEN 5 WHEN id=md5('govrp:catalog:soap')::uuid THEN 10000 WHEN id::text LIKE 'f2100000-0000-4000-8000-00000000002%' THEN 100 WHEN id::text LIKE 'f210%' OR id::text LIKE 'f220%' THEN 1000000 ELSE 100 END,
 image_url='/images/catalog/'||CASE WHEN residence_spec IS NOT NULL THEN CASE WHEN id=md5('govrp:catalog:mansion:DF')::uuid THEN 'mansion' WHEN lower(name) LIKE 'casa%' OR residence_spec->>'quality'='3' THEN 'house' WHEN lower(name) LIKE '%apart%' THEN 'apartment' ELSE 'studio' END ELSE CASE name WHEN 'Pão do dia' THEN 'bread' WHEN 'Arroz com feijão' THEN 'meal' WHEN 'Refeição completa' THEN 'meal' WHEN 'Banana' THEN 'banana' WHEN 'Maçã' THEN 'apple' WHEN 'Sanduíche simples' THEN 'sandwich' WHEN 'Sopa de legumes' THEN 'soup' WHEN 'Salada da estação' THEN 'salad' WHEN 'Biscoitos' THEN 'cookies' WHEN 'Tapioca' THEN 'tapioca' WHEN 'Água mineral' THEN 'water' WHEN 'Suco de laranja' THEN 'juice' WHEN 'Água de coco' THEN 'coconut' WHEN 'Chá gelado' THEN 'tea' WHEN 'Leite' THEN 'milk' WHEN 'Cerveja' THEN 'beer' WHEN 'Vinho' THEN 'wine' WHEN 'Destilado' THEN 'whisky' ELSE 'soap' END END||'.webp'
 WHERE private.is_reset_system_offer(id);
 UPDATE public.products SET residence_spec=residence_spec||jsonb_build_object('rooms',jsonb_build_object('bedrooms',CASE WHEN (residence_spec->>'quality')::integer=3 THEN 4 WHEN price<1000 THEN 0 ELSE 2 END,'bathrooms',CASE WHEN (residence_spec->>'quality')::integer=3 THEN 3 ELSE 1 END,'living_rooms',1,'kitchens',1),'hygiene_recovery',CASE WHEN (residence_spec->>'quality')::integer=3 THEN 100 WHEN price<1000 THEN 50 ELSE 75 END,'sleep_minutes',CASE WHEN (residence_spec->>'quality')::integer=3 THEN 6 WHEN price<1000 THEN 18 ELSE 12 END,'rent_price',greatest(25,round(price*.02,2)),'rent_period_days',7) WHERE id::text LIKE 'f220%';
 PERFORM private.refresh_regional_infrastructure();
 FOR t IN SELECT key,value FROM jsonb_each(triggers) LOOP PERFORM private.reset_change_triggers('public',t.key,t.value);END LOOP;
END $$;
-- Nullable does not mean optional: account ownership and repost CHECKs also matter.
CREATE FUNCTION private.reset_fk_detachable(p_constraint oid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT bool_and(NOT a.attnotnull) FROM unnest(k.conkey)u(attnum) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.attnum)
 AND NOT EXISTS(SELECT 1 FROM pg_constraint guard WHERE guard.conrelid=k.conrelid AND guard.contype='c' AND guard.conkey && k.conkey
 AND NOT((guard.conrelid='public.economic_events'::regclass AND guard.conname='economic_events_reversal') OR (guard.conrelid='public.posts'::regclass AND guard.conname='posts_check')))
 FROM pg_constraint k WHERE k.oid=p_constraint AND k.contype='f'
$$;
CREATE FUNCTION private.plan_controlled_reset(p_request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer:=0;t record;fk record;cols text;predicate text;BEGIN
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,operation) VALUES(p_request_id,n,'draining','{}');n:=n+1;
 FOR t IN SELECT * FROM private.reset_catalog() WHERE backup AND to_regclass(format('%I.%I',schema_name,table_name)) IS NOT NULL ORDER BY schema_name,table_name LOOP
  INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,schema_name,table_name) VALUES(p_request_id,n,'backing_up',t.schema_name,t.table_name);n:=n+1;
 END LOOP;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,operation) VALUES(p_request_id,n,'backup_verification','{}');n:=n+1;
 -- Detach nullable references to disappearing records, not FK constraints themselves.
 FOR fk IN SELECT k.oid,k.conrelid,k.conkey,pn.nspname parent_schema,pc.relname parent_table,n.nspname child_schema,c.relname child_table,array_agg(a.attname ORDER BY u.ord) names FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class pc ON pc.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=pc.relnamespace JOIN private.reset_catalog()rp ON rp.schema_name=pn.nspname AND rp.table_name=pc.relname CROSS JOIN LATERAL unnest(k.conkey) WITH ORDINALITY u(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.attnum WHERE k.contype='f' AND rp.strategy IN('clear','mixed') AND n.nspname IN('public','private') GROUP BY k.oid,k.conrelid,k.conkey,pn.nspname,pc.relname,n.nspname,c.relname HAVING private.reset_fk_detachable(k.oid) ORDER BY n.nspname,c.relname,k.oid LOOP
  INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,schema_name,table_name,operation) VALUES(p_request_id,n,'detaching',fk.child_schema,fk.child_table,jsonb_build_object('columns',fk.names,'constraint_oid',fk.oid));n:=n+1;
 END LOOP;
 DROP TABLE IF EXISTS pg_temp.controlled_reset_order;
 CREATE TEMP TABLE controlled_reset_order(schema_name text,table_name text,strategy text,relation oid PRIMARY KEY) ON COMMIT DROP;
 INSERT INTO controlled_reset_order SELECT schema_name,table_name,strategy,to_regclass(format('%I.%I',schema_name,table_name)) FROM private.reset_catalog() WHERE strategy IN('clear','mixed');
 WHILE EXISTS(SELECT 1 FROM controlled_reset_order) LOOP
  cols:=NULL;
  FOR t IN SELECT r.* FROM controlled_reset_order r WHERE NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN controlled_reset_order child ON child.relation=k.conrelid WHERE k.contype='f' AND k.confrelid=r.relation AND NOT private.reset_fk_detachable(k.oid)) ORDER BY r.schema_name,r.table_name LOOP
   INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,schema_name,table_name,operation) VALUES(p_request_id,n,'clearing',t.schema_name,t.table_name,jsonb_build_object('predicate',private.reset_predicate(t.table_name),'truncate_safe',t.strategy='clear' AND NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid=t.relation AND conrelid<>confrelid)));n:=n+1;DELETE FROM controlled_reset_order WHERE relation=t.relation;cols:='progress';
  END LOOP;
  IF cols IS NULL THEN RAISE EXCEPTION 'Existe um ciclo de dependências não anuláveis que precisa ser revisado antes do reset.';END IF;
 END LOOP;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase) VALUES(p_request_id,n,'profiles');n:=n+1;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase) VALUES(p_request_id,n,'initializing');n:=n+1;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase) VALUES(p_request_id,n,'storage');n:=n+1;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase) VALUES(p_request_id,n,'accounts');n:=n+1;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,schema_name,table_name) SELECT p_request_id,n+row_number() OVER(ORDER BY schema_name,table_name)::integer,'validating',schema_name,table_name FROM private.reset_catalog() WHERE strategy IN('clear','mixed') OR (strategy='reset' AND table_name<>'profiles');
 SELECT coalesce(max(ordinal),0)+1 INTO n FROM private.rp_reset_steps WHERE request_id=p_request_id;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase,schema_name,table_name,operation)
 SELECT p_request_id,n+row_number() OVER(ORDER BY schema_name,table_name)::integer,'validating',schema_name,table_name,'{"preserve":true}'::jsonb FROM private.reset_catalog() WHERE backup AND strategy='keep' AND table_name NOT LIKE 'rp_reset_%';
 SELECT coalesce(max(ordinal),0)+1 INTO n FROM private.rp_reset_steps WHERE request_id=p_request_id;
 INSERT INTO private.rp_reset_steps(request_id,ordinal,phase) VALUES(p_request_id,n,'final_validation');
END $$;
CREATE FUNCTION public.admin_start_controlled_reset(p_request_id uuid,p_confirmation text,p_account_confirmation text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=private.assert_reset_operator(true);req private.rp_reset_requests%rowtype;audit jsonb;admins jsonb;BEGIN
 IF p_confirmation IS DISTINCT FROM 'RESETAR GOVRP' THEN RAISE EXCEPTION 'Digite RESETAR GOVRP para confirmar o escopo revisado.';END IF;
 IF NOT pg_try_advisory_xact_lock(725104,1) THEN RAISE EXCEPTION 'Já existe um Reset Geral em execução.';END IF;
 SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id FOR UPDATE;
 IF req.id IS NULL OR req.requested_by<>actor OR req.scope<>'full_rp' THEN RAISE EXCEPTION 'Prepare uma prévia válida para este administrador.';END IF;
 IF req.started_at IS NOT NULL THEN RETURN jsonb_build_object('accepted',true,'request_id',req.id,'status',req.status);END IF;
 IF req.status<>'draft' OR req.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'A prévia expirou. Analise novamente o reset.';END IF;
 IF EXISTS(SELECT 1 FROM private.rp_reset_runtime WHERE id AND maintenance) THEN RAISE EXCEPTION 'Já existe um Reset Geral em execução.';END IF;
 IF EXISTS(SELECT 1 FROM public.country_rp_states c WHERE c.is_playable AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(req.country_snapshots)x WHERE x->>'country_code'=c.country_code)) OR EXISTS(SELECT 1 FROM jsonb_array_elements(req.country_snapshots)x WHERE x->>'country_code'<>'BR' AND NOT EXISTS(SELECT 1 FROM public.country_rp_states c WHERE c.is_playable AND c.country_code=x->>'country_code')) THEN RAISE EXCEPTION 'A lista de países mudou. Consulte novamente as referências reais.';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(req.country_snapshots)x WHERE (x->>'fetched_at')::timestamptz<clock_timestamp()-interval '30 minutes') THEN RAISE EXCEPTION 'As referências iniciais expiraram. Prepare uma nova prévia.';END IF;
 IF req.remove_common_accounts AND (req.reset_mode<>'launch' OR p_account_confirmation IS DISTINCT FROM 'EXCLUIR CONTAS COMUNS') THEN RAISE EXCEPTION 'Confirme separadamente EXCLUIR CONTAS COMUNS para remover o acesso das contas de teste.';END IF;
 audit:=private.reset_audit();IF (audit->>'blocked')::boolean OR audit->>'schema_fingerprint' IS DISTINCT FROM req.preview->>'schema_fingerprint' THEN RAISE EXCEPTION 'O esquema mudou ou possui tabelas sem classificação. Analise novamente.';END IF;
 -- Existing trusted legacy Admin roles are converted to independent Auth grants.
 INSERT INTO private.platform_admins(user_id) SELECT id FROM public.profiles WHERE role='Admin' AND deleted_at IS NULL ON CONFLICT(user_id) DO NOTHING;
 SELECT jsonb_agg(to_jsonb(a) ORDER BY user_id) INTO admins FROM private.platform_admins a;
 IF coalesce(jsonb_array_length(admins),0)=0 OR EXISTS(SELECT 1 FROM private.platform_admins a LEFT JOIN auth.users u ON u.id=a.user_id LEFT JOIN public.profiles p ON p.id=a.user_id WHERE u.id IS NULL OR u.deleted_at IS NOT NULL OR p.id IS NULL OR p.deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'A identidade de um administrador precisa ser regularizada antes do reset.';END IF;
 UPDATE private.rp_reset_requests SET user_ids=(SELECT coalesce(array_agg(id ORDER BY id),'{}') FROM auth.users WHERE deleted_at IS NULL),status='draining',current_phase='draining',started_at=clock_timestamp(),generation_before=(SELECT generation_id FROM private.rp_reset_runtime WHERE id),generation_after=gen_random_uuid(),schema_fingerprint=private.reset_schema_fingerprint(),admin_snapshot=admins,worker_token=encode(extensions.gen_random_bytes(32),'hex'),preview=preview||jsonb_build_object('trigger_snapshot',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'trigger',g.tgname,'enabled',g.tgenabled) ORDER BY n.nspname,c.relname,g.tgname) FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT g.tgisinternal AND n.nspname IN('public','private','auth','storage')),'penal_baseline',(SELECT coalesce(jsonb_agg(v.previous_snapshot),'[]') FROM (SELECT DISTINCT ON(effect_key) previous_snapshot FROM public.law_effects WHERE previous_snapshot->>'rule_kind'='penalty' AND previous_snapshot->>'source_kind'='system' ORDER BY effect_key,activated_at NULLS LAST,created_at)v)) WHERE id=req.id;
 PERFORM set_config('govrp.reset_worker',req.id::text,true);
 INSERT INTO private.rp_reset_job_schedules SELECT req.id,jobid,jobname,command,schedule,active FROM cron.job WHERE jobname NOT IN('govrp-controlled-reset-worker','govrp-cron-history-prune');
 PERFORM cron.alter_job(job_id,active:=false) FROM private.rp_reset_job_schedules WHERE request_id=req.id AND was_active;
 UPDATE private.rp_reset_runtime SET maintenance=true,request_id=req.id,changed_at=clock_timestamp() WHERE id;
 INSERT INTO private.rp_launch_backups(request_id,created_by,admins,snapshot,digest) VALUES(req.id,actor,admins,jsonb_build_object('format','govrp-reset-v2','state','pending','schema_fingerprint',private.reset_schema_fingerprint(),'mode',req.reset_mode),'pending');

 PERFORM private.plan_controlled_reset(req.id);
 PERFORM cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';
 INSERT INTO private.rp_reset_job_events(request_id,kind,details) VALUES(req.id,'reset_confirmed',jsonb_build_object('actor',actor,'mode',req.reset_mode,'remove_common_accounts',req.remove_common_accounts));
 RETURN jsonb_build_object('accepted',true,'success',false,'request_id',req.id,'status','draining','message','Manutenção ativada. O backup será verificado antes de qualquer limpeza.');
END $$;
ALTER FUNCTION public.admin_execute_rp_reset(uuid,text) RENAME TO admin_execute_rp_reset_atomic;
ALTER FUNCTION public.admin_execute_rp_reset_atomic(uuid,text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.admin_execute_rp_reset_atomic(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.admin_execute_rp_reset(p_request_id uuid,p_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE req private.rp_reset_requests%rowtype;result jsonb;BEGIN SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id;IF req.scope='full_rp' THEN RETURN public.admin_start_controlled_reset(p_request_id,p_confirmation);END IF;IF EXISTS(SELECT 1 FROM private.rp_reset_runtime WHERE id AND maintenance) THEN RAISE EXCEPTION 'O universo está em manutenção. Aguarde o Reset Geral.';END IF;result:=private.admin_execute_rp_reset_atomic(p_request_id,p_confirmation);UPDATE private.rp_reset_requests SET status='completed' WHERE id=p_request_id AND completed_at IS NOT NULL;RETURN result;END $$;
REVOKE ALL ON FUNCTION public.admin_start_controlled_reset(uuid,text,text),public.admin_execute_rp_reset(uuid,text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.admin_start_controlled_reset(uuid,text,text),public.admin_execute_rp_reset(uuid,text) TO authenticated;
CREATE FUNCTION private.reset_chunk_packet(p_id bigint) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT jsonb_build_object('kind','backup_chunk','id',c.id,'schema',c.schema_name,'table',c.table_name,'payload_text',c.payload::text,'digest',c.digest,'row_count',c.row_count,'backup_name',c.request_id::text||'/database/'||c.schema_name||'/'||c.table_name||'/'||c.chunk_no::text||'.json','classification',p.classification,'strategy',p.strategy) FROM private.rp_reset_backup_chunks c JOIN private.reset_catalog()p ON p.schema_name=c.schema_name AND p.table_name=c.table_name WHERE c.id=p_id $$;
CREATE FUNCTION public.admin_get_controlled_reset(p_request_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE req private.rp_reset_requests%rowtype;BEGIN PERFORM private.assert_reset_operator();SELECT * INTO req FROM private.rp_reset_requests WHERE scope='full_rp' AND (p_request_id IS NULL OR id=p_request_id) ORDER BY started_at DESC NULLS LAST,created_at DESC LIMIT 1;IF req.id IS NULL THEN RETURN NULL;END IF;RETURN (to_jsonb(req)-'worker_token'-'country_snapshots'-'user_ids'-'last_error')||jsonb_build_object('last_error',req.last_error-'detail'-'context'-'sqlstate','steps',(SELECT coalesce(jsonb_agg((to_jsonb(s)-'cursor_value'-'operation'-'last_error')||jsonb_build_object('last_error',s.last_error-'detail'-'context'-'sqlstate') ORDER BY ordinal),'[]') FROM private.rp_reset_steps s WHERE request_id=req.id),'backup',(SELECT jsonb_build_object('id',id,'created_at',created_at,'digest',digest,'state',snapshot->>'state','verified_at',snapshot->>'verified_at','chunks',(SELECT count(*) FROM private.rp_reset_backup_chunks WHERE request_id=req.id),'records',(SELECT coalesce(sum(row_count),0) FROM private.rp_reset_backup_chunks WHERE request_id=req.id)) FROM private.rp_launch_backups WHERE request_id=req.id),'files',(SELECT jsonb_build_object('total',count(*),'archived',count(*) FILTER(WHERE status='archived'),'deleted',count(*) FILTER(WHERE status='deleted'),'retained',count(*) FILTER(WHERE status='retained')) FROM private.rp_reset_assets WHERE request_id=req.id),'events',(SELECT coalesce(jsonb_agg((to_jsonb(e)-'details')||jsonb_build_object('details',e.details-'detail'-'context'-'sqlstate')),'[]') FROM (SELECT * FROM private.rp_reset_job_events WHERE request_id=req.id ORDER BY id DESC LIMIT 30)e));END $$;
CREATE FUNCTION private.assert_reset_worker(p_request_id uuid,p_token text,p_lease uuid DEFAULT NULL) RETURNS private.rp_reset_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE req private.rp_reset_requests%rowtype;BEGIN SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id;IF req.id IS NULL OR p_token IS NULL OR length(p_token)<>64 OR extensions.digest(p_token,'sha256') IS DISTINCT FROM extensions.digest(req.worker_token,'sha256') OR req.status IN('draft','expired','completed','cancelled','validated','failed') OR NOT EXISTS(SELECT 1 FROM private.rp_reset_runtime WHERE id AND maintenance AND request_id=req.id) THEN RAISE EXCEPTION 'Execução de manutenção não autorizada.' USING errcode='42501';END IF;IF p_lease IS NOT NULL AND (req.lease_id IS DISTINCT FROM p_lease OR req.lease_until<=clock_timestamp()) THEN RAISE EXCEPTION 'A reserva desta execução expirou. O checkpoint permanece preservado.';END IF;RETURN req;END $$;
CREATE FUNCTION public.admin_claim_reset_worker(p_request_id uuid,p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE req private.rp_reset_requests%rowtype;lease uuid:=gen_random_uuid();BEGIN req:=private.assert_reset_worker(p_request_id,p_token);IF NOT pg_try_advisory_xact_lock(725104,3) THEN RETURN jsonb_build_object('busy',true);END IF;SELECT * INTO req FROM private.rp_reset_requests WHERE id=req.id FOR UPDATE;IF req.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('busy',true);END IF;IF req.lease_id IS NOT NULL THEN INSERT INTO private.rp_reset_job_events(request_id,kind,details) VALUES(req.id,'expired_worker_recovered',jsonb_build_object('phase',req.current_phase));END IF;UPDATE private.rp_reset_requests SET lease_id=lease,lease_until=clock_timestamp()+interval '45 seconds',attempts=attempts+1 WHERE id=req.id;RETURN jsonb_build_object('lease',lease,'generation',req.generation_before,'request_id',req.id);END $$;
CREATE FUNCTION public.admin_process_reset_batch(p_request_id uuid,p_token text,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req private.rp_reset_requests%rowtype;step private.rp_reset_steps%rowtype;t record;data jsonb;cursor_row jsonb;pk text[];key_expr text;cursor_expr text;order_expr text;q text;payload jsonb;rows_count bigint;chunk bigint;chunk_no integer;done boolean:=false;triggers jsonb;assignments text;predicate text;started timestamptz:=clock_timestamp();err_message text;err_detail text;err_context text;err_state text;asset private.rp_reset_assets%rowtype;target uuid;expected jsonb;actual text;BEGIN
 req:=private.assert_reset_worker(p_request_id,p_token,p_lease);
 IF NOT pg_try_advisory_xact_lock(725104,2) THEN RETURN jsonb_build_object('waiting',true,'phase','draining');END IF;
 PERFORM set_config('govrp.reset_worker',req.id::text,true);PERFORM set_config('lock_timeout','750ms',true);
 SELECT * INTO step FROM private.rp_reset_steps WHERE request_id=req.id AND status<>'completed' ORDER BY ordinal LIMIT 1 FOR UPDATE;
 IF step.id IS NULL THEN RAISE EXCEPTION 'A execução não possui etapa final de validação.';END IF;
 UPDATE private.rp_reset_requests SET current_phase=step.phase,status=CASE WHEN step.phase IN('backup_verification','backing_up') THEN 'backing_up' WHEN step.phase IN('profiles','initializing') THEN 'initializing' WHEN step.phase IN('validating','final_validation') THEN 'validating' ELSE step.phase END,lease_until=clock_timestamp()+interval '45 seconds' WHERE id=req.id;
 UPDATE private.rp_reset_steps SET status='running',started_at=coalesce(started_at,clock_timestamp()),attempts=attempts+1 WHERE id=step.id;
 BEGIN
  IF req.schema_fingerprint IS DISTINCT FROM private.reset_schema_fingerprint() THEN RAISE EXCEPTION 'O esquema do banco mudou durante a execução. A manutenção será mantida para revisão.';END IF;
  IF step.phase='draining' THEN
   UPDATE private.rp_reset_requests SET user_ids=(SELECT coalesce(array_agg(id ORDER BY id),'{}') FROM auth.users WHERE deleted_at IS NULL) WHERE id=req.id;
   INSERT INTO private.rp_reset_assets(request_id,bucket_id,object_name,original_metadata,status) SELECT req.id,bucket_id,name,to_jsonb(o),CASE WHEN bucket_id='support-attachments' THEN 'retained' WHEN bucket_id IN('product-images','profiles','x-avatars','headers','stories','post-images','post-videos','avatars','x-message-attachments') OR (bucket_id='public-assets' AND name~'^(campaign-photos|company-logos|party-headers|party-logos|catalog-photos)/') THEN 'candidate' ELSE 'unclassified' END FROM storage.objects o WHERE bucket_id<>'rp-reset-backups';
   done:=true;
  ELSIF step.phase='backing_up' THEN
   IF step.operation ? 'pending_chunk' THEN RETURN jsonb_build_object('task',private.reset_chunk_packet((step.operation->>'pending_chunk')::bigint));END IF;
   SELECT array_agg(a.attname ORDER BY k.ord) INTO pk FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE i.indrelid=to_regclass(format('%I.%I',step.schema_name,step.table_name)) AND i.indisprimary;
   cursor_row:=step.cursor_value::jsonb;
   IF pk IS NULL THEN
    q:=format('SELECT coalesce(jsonb_agg(v.payload),''[]''),(jsonb_agg(v.cursor)->-1) FROM (SELECT to_jsonb(r) payload,r.ctid::text cursor FROM %I.%I r WHERE ($1::text IS NULL OR r.ctid>($1::jsonb->>''ctid'')::tid) ORDER BY r.ctid LIMIT 500)v',step.schema_name,step.table_name);
    EXECUTE q INTO payload,data USING step.cursor_value;cursor_row:=jsonb_build_object('ctid',data);
   ELSE
    SELECT string_agg(format('r.%I',c),','),string_agg(format('(jsonb_populate_record(NULL::%I.%I,$1)).%I',step.schema_name,step.table_name,c),',') INTO key_expr,cursor_expr FROM unnest(pk)c;
    q:=format('SELECT coalesce(jsonb_agg(v.payload),''[]'') FROM (SELECT to_jsonb(r) payload FROM %I.%I r WHERE ($1::jsonb IS NULL OR ROW(%s)>ROW(%s)) ORDER BY %s LIMIT 500)v',step.schema_name,step.table_name,key_expr,cursor_expr,key_expr);
    EXECUTE q INTO payload USING cursor_row;cursor_row:=payload->-1;
   END IF;
   rows_count:=jsonb_array_length(payload);SELECT coalesce(max(c.chunk_no),0)+1 INTO chunk_no FROM private.rp_reset_backup_chunks c WHERE c.request_id=req.id AND c.schema_name=step.schema_name AND c.table_name=step.table_name;
   INSERT INTO private.rp_reset_backup_chunks(request_id,schema_name,table_name,chunk_no,payload,digest,row_count) VALUES(req.id,step.schema_name,step.table_name,chunk_no,payload,encode(extensions.digest(payload::text,'sha256'),'hex'),rows_count) RETURNING id INTO chunk;
   IF step.table_name IN('products','investment_options') AND step.schema_name='public' THEN INSERT INTO private.rp_reset_targets(request_id,schema_name,table_name,row_id) SELECT req.id,'public',step.table_name,(r->>'id')::uuid FROM jsonb_array_elements(payload)r WHERE (step.table_name='products' AND NOT private.is_reset_system_offer((r->>'id')::uuid)) OR (step.table_name='investment_options' AND r->>'business_id' IS NOT NULL) ON CONFLICT DO NOTHING;END IF;
   UPDATE private.rp_reset_steps SET operation=operation||jsonb_build_object('pending_chunk',chunk,'pending_cursor',cursor_row,'pending_count',rows_count) WHERE id=step.id;
   RETURN jsonb_build_object('task',private.reset_chunk_packet(chunk));
  ELSIF step.phase='backup_verification' THEN
   FOR t IN SELECT * FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND NOT verified ORDER BY id LIMIT 10 LOOP IF t.object_name IS NULL OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='rp-reset-backups' AND name=t.object_name) OR encode(extensions.digest(t.payload::text,'sha256'),'hex') IS DISTINCT FROM t.digest THEN RAISE EXCEPTION 'Um bloco de backup falhou na verificação de integridade.';END IF;UPDATE private.rp_reset_backup_chunks SET verified=true WHERE id=t.id;END LOOP;
   IF EXISTS(SELECT 1 FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND NOT verified) THEN RETURN jsonb_build_object('waiting',true,'phase',step.phase);END IF;
   UPDATE private.rp_reset_assets a SET status=CASE WHEN a.status='candidate' THEN 'pending' WHEN a.status='unclassified' AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=a.bucket_id AND o.name=a.object_name AND nullif(o.owner_id,'') IS NOT NULL) THEN 'pending' ELSE 'retained' END WHERE request_id=req.id AND status IN('candidate','unclassified');
   SELECT * INTO asset FROM private.rp_reset_assets WHERE request_id=req.id AND status='pending' ORDER BY id LIMIT 1;
   IF asset.id IS NOT NULL THEN RETURN jsonb_build_object('task',jsonb_build_object('kind','archive_asset','id',asset.id,'bucket',asset.bucket_id,'name',asset.object_name,'backup_name',req.id::text||'/'||asset.id::text));END IF;
   SELECT encode(extensions.digest(coalesce(string_agg(c.schema_name||'.'||c.table_name||':'||c.chunk_no||':'||c.digest,'|' ORDER BY c.schema_name,c.table_name,c.chunk_no),''),'sha256'),'hex') INTO actual FROM private.rp_reset_backup_chunks c WHERE request_id=req.id;
   UPDATE private.rp_launch_backups SET digest=actual,snapshot=snapshot||jsonb_build_object('state','verified','verified_at',clock_timestamp(),'chunks',(SELECT count(*) FROM private.rp_reset_backup_chunks WHERE request_id=req.id),'records',(SELECT sum(row_count) FROM private.rp_reset_backup_chunks WHERE request_id=req.id)) WHERE request_id=req.id;done:=true;
  ELSIF step.phase='detaching' THEN
   IF NOT EXISTS(SELECT 1 FROM private.rp_launch_backups WHERE request_id=req.id AND snapshot->>'state'='verified') THEN RAISE EXCEPTION 'O backup precisa estar verificado antes da limpeza.';END IF;
   SELECT string_agg(format('%I=NULL',c),','),string_agg(format('r.%I IS NOT NULL',c),' OR ') INTO assignments,predicate FROM jsonb_array_elements_text(step.operation->'columns')c;
   IF step.schema_name='public' AND step.table_name='posts' AND step.operation->'columns' ? 'original_post_id' THEN assignments:=assignments||',content=CASE WHEN content=''repost'' THEN ''[Republicação do universo anterior]'' ELSE content END';END IF;
   triggers:=private.reset_change_triggers(step.schema_name,step.table_name);
   EXECUTE format('WITH batch AS(SELECT r.ctid FROM %I.%I r WHERE %s LIMIT 2000 FOR UPDATE SKIP LOCKED) UPDATE %I.%I r SET %s FROM batch b WHERE r.ctid=b.ctid',step.schema_name,step.table_name,predicate,step.schema_name,step.table_name,assignments);GET DIAGNOSTICS rows_count=ROW_COUNT;
   PERFORM private.reset_change_triggers(step.schema_name,step.table_name,triggers);
   EXECUTE format('SELECT NOT EXISTS(SELECT 1 FROM %I.%I r WHERE %s)',step.schema_name,step.table_name,predicate) INTO done;
  ELSIF step.phase='clearing' THEN
   predicate:=CASE WHEN step.table_name IN('products','investment_options') AND step.schema_name='public' THEN format('EXISTS(SELECT 1 FROM private.rp_reset_targets chosen WHERE chosen.request_id=%L::uuid AND chosen.schema_name=%L AND chosen.table_name=%L AND chosen.row_id=r.id)',req.id,step.schema_name,step.table_name) ELSE 'true' END;
   triggers:=private.reset_change_triggers(step.schema_name,step.table_name);
   IF coalesce((step.operation->>'truncate_safe')::boolean,false) THEN EXECUTE format('TRUNCATE TABLE %I.%I RESTART IDENTITY RESTRICT',step.schema_name,step.table_name);done:=true;SELECT coalesce(sum(row_count),0) INTO rows_count FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND schema_name=step.schema_name AND table_name=step.table_name;
   ELSE EXECUTE format('WITH batch AS(SELECT r.ctid FROM %I.%I r WHERE %s LIMIT 2000 FOR UPDATE SKIP LOCKED) DELETE FROM %I.%I r USING batch b WHERE r.ctid=b.ctid',step.schema_name,step.table_name,predicate,step.schema_name,step.table_name);GET DIAGNOSTICS rows_count=ROW_COUNT;EXECUTE format('SELECT NOT EXISTS(SELECT 1 FROM %I.%I r WHERE %s)',step.schema_name,step.table_name,predicate) INTO done;END IF;
   IF done AND step.table_name NOT IN('products','investment_options') THEN
    FOR t IN SELECT pg_get_serial_sequence(format('%I.%I',step.schema_name,step.table_name),a.attname) seq FROM pg_attribute a WHERE a.attrelid=to_regclass(format('%I.%I',step.schema_name,step.table_name)) AND a.attnum>0 AND NOT a.attisdropped LOOP IF t.seq IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE %s RESTART',t.seq);END IF;END LOOP;
   END IF;
   PERFORM private.reset_change_triggers(step.schema_name,step.table_name,triggers);
  ELSIF step.phase='profiles' THEN
   SELECT coalesce(array_agg(p.id ORDER BY p.id),'{}') INTO pk FROM (SELECT id FROM public.profiles WHERE deleted_at IS NULL AND (step.cursor_value IS NULL OR id>step.cursor_value::uuid) ORDER BY id LIMIT 200)p;
   IF cardinality(pk)=0 THEN done:=true;ELSE
    SELECT string_agg(format('%I=DEFAULT',attname),',') INTO assignments FROM pg_attribute WHERE attrelid='public.profiles'::regclass AND attnum>0 AND NOT attisdropped AND attname NOT IN('id','created_at','role','username','username_is_generated','deleted_at','anonymized_at','deletion_reason','ui_preferences');triggers:=private.reset_change_triggers('public','profiles');
    EXECUTE 'UPDATE public.profiles r SET '||assignments||',username=''u_''||left(replace(gen_random_uuid()::text,''-'',''''),18),username_is_generated=true,role=CASE WHEN EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=r.id) THEN ''Admin'' ELSE ''Cidadão'' END WHERE r.id=ANY($1)' USING pk::uuid[];
    PERFORM private.reset_change_triggers('public','profiles',triggers);rows_count:=cardinality(pk);UPDATE private.rp_reset_steps SET cursor_value=pk[cardinality(pk)] WHERE id=step.id;
   END IF;
  ELSIF step.phase='initializing' THEN
   PERFORM private.seed_reset_world(req.id);
   expected:='{}';FOR t IN SELECT * FROM private.reset_catalog() WHERE table_name IN('government_rules','country_rp_economic_snapshots','country_rp_exchange_rates','products','investment_options','economic_state','government_finances','state_enterprises','government_ministries','government_popularity_state','price_basket_items','country_rp_states','country_population_segments','currency_market_states','economic_regions','penal_code','rp_time_settings','system_settings') AND schema_name='public' LOOP EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(to_jsonb(r)::text,'''' ORDER BY to_jsonb(r)::text),''''))) FROM public.%I r %s',t.table_name,CASE WHEN t.table_name='system_settings' THEN 'WHERE key<>''world_runtime''' ELSE '' END) INTO data;expected:=expected||jsonb_build_object(t.table_name,data);END LOOP;
   UPDATE private.rp_reset_requests SET preview=preview||jsonb_build_object('initialized_baseline',expected) WHERE id=req.id;done:=true;
  ELSIF step.phase='storage' THEN
   SELECT * INTO asset FROM private.rp_reset_assets WHERE request_id=req.id AND status='archived' ORDER BY id LIMIT 1;IF asset.id IS NOT NULL THEN RETURN jsonb_build_object('task',jsonb_build_object('kind','delete_asset','id',asset.id,'bucket',asset.bucket_id,'name',asset.object_name,'backup_name',asset.backup_name,'digest',asset.digest));END IF;done:=true;
  ELSIF step.phase='accounts' THEN
   IF req.remove_common_accounts THEN SELECT u.id INTO target FROM auth.users u WHERE u.id=ANY(req.user_ids) AND NOT EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM private.rp_reset_targets ack WHERE ack.request_id=req.id AND ack.schema_name='auth' AND ack.table_name='deleted_account_ack' AND ack.row_id=u.id) ORDER BY u.id LIMIT 1;IF target IS NOT NULL THEN RETURN jsonb_build_object('task',jsonb_build_object('kind','delete_account','id',target));END IF;END IF;done:=true;
  ELSIF step.phase='validating' THEN
   IF coalesce((step.operation->>'preserve')::boolean,false) AND NOT(step.schema_name='public' AND req.preview->'initialized_baseline' ? step.table_name) THEN
    SELECT * INTO t FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND schema_name=step.schema_name AND table_name=step.table_name AND (step.cursor_value IS NULL OR id>step.cursor_value::bigint) ORDER BY id LIMIT 1;
    IF t.id IS NULL THEN done:=true;
    ELSE
     SELECT string_agg(format('r.%I=b.%I',a.attname,a.attname),' AND ') INTO predicate FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey)u(attnum) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=u.attnum WHERE i.indrelid=to_regclass(format('%I.%I',step.schema_name,step.table_name)) AND i.indisprimary;
     IF predicate IS NULL THEN RAISE EXCEPTION 'A tabela protegida %.% precisa de chave para validar a recuperação.',step.schema_name,step.table_name;END IF;
     q:=format('SELECT count(*) FROM jsonb_populate_recordset(NULL::%I.%I,$1)b WHERE NOT EXISTS(SELECT 1 FROM %I.%I r WHERE %s)',step.schema_name,step.table_name,step.schema_name,step.table_name,predicate);
     IF req.remove_common_accounts AND step.table_name IN('account_identities','users') THEN q:=q||CASE WHEN step.schema_name='private' THEN ' AND EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=b.user_id)' ELSE ' AND EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=b.auth_user_id)' END;END IF;
     EXECUTE q INTO rows_count USING t.payload;IF rows_count<>0 THEN RAISE EXCEPTION 'Faltam registros protegidos em %.%.',step.schema_name,step.table_name;END IF;
     UPDATE private.rp_reset_steps SET cursor_value=t.id::text WHERE id=step.id;
    END IF;
   ELSIF req.preview->'initialized_baseline' ? step.table_name AND step.schema_name='public' THEN EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(to_jsonb(r)::text,'''' ORDER BY to_jsonb(r)::text),''''))) FROM public.%I r %s',step.table_name,CASE WHEN step.table_name='system_settings' THEN 'WHERE key<>''world_runtime''' ELSE '' END) INTO data;IF data IS DISTINCT FROM req.preview->'initialized_baseline'->step.table_name THEN RAISE EXCEPTION 'A inicialização de % não corresponde ao baseline verificado.',step.table_name;END IF;
   ELSE predicate:=CASE WHEN step.table_name IN('products','investment_options') AND step.schema_name='public' THEN format('EXISTS(SELECT 1 FROM private.rp_reset_targets chosen WHERE chosen.request_id=%L::uuid AND chosen.schema_name=%L AND chosen.table_name=%L AND chosen.row_id=r.id)',req.id,step.schema_name,step.table_name) ELSE 'true' END;EXECUTE format('SELECT count(*) FROM %I.%I r WHERE %s',step.schema_name,step.table_name,predicate) INTO rows_count;IF rows_count<>0 THEN RAISE EXCEPTION 'A verificação encontrou registros anteriores em %.%.',step.schema_name,step.table_name;END IF;END IF;done:=true;
  ELSIF step.phase='final_validation' THEN
   data:=private.validate_controlled_reset(req.id);IF NOT coalesce((data->>'valid')::boolean,false) THEN RAISE EXCEPTION 'A verificação final encontrou inconsistências. A manutenção será mantida.';END IF;
   UPDATE private.rp_reset_requests SET status='validated',validated_at=clock_timestamp(),result=data||jsonb_build_object('success',true,'request_id',req.id,'scope','full_rp','backup_id',(SELECT id FROM private.rp_launch_backups WHERE request_id=req.id)) WHERE id=req.id;
   UPDATE private.rp_reset_runtime SET generation_id=req.generation_after,generation_started_at=clock_timestamp(),changed_at=clock_timestamp(),enforce_generation=true WHERE id AND request_id=req.id;PERFORM cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';done:=true;
  END IF;
  UPDATE private.rp_reset_steps SET status=CASE WHEN done THEN 'completed' ELSE 'running' END,processed=processed+coalesce(rows_count,0),completed_at=CASE WHEN done THEN clock_timestamp() ELSE NULL END,elapsed_ms=elapsed_ms+extract(epoch FROM clock_timestamp()-started)*1000 WHERE id=step.id;
  RETURN jsonb_build_object('phase',step.phase,'step_completed',done,'validated',step.phase='final_validation' AND done);
 EXCEPTION WHEN query_canceled OR lock_not_available OR OTHERS THEN
  GET STACKED DIAGNOSTICS err_message=MESSAGE_TEXT,err_detail=PG_EXCEPTION_DETAIL,err_context=PG_EXCEPTION_CONTEXT,err_state=RETURNED_SQLSTATE;
  data:=jsonb_build_object('message',err_message,'detail',err_detail,'context',err_context,'sqlstate',err_state,'phase',step.phase,'table',step.schema_name||'.'||step.table_name,'at',clock_timestamp());UPDATE private.rp_reset_steps SET status='failed',last_error=data WHERE id=step.id;UPDATE private.rp_reset_requests SET status='failed',last_error=data,lease_until=NULL,lease_id=NULL WHERE id=req.id;INSERT INTO private.rp_reset_job_events(request_id,step_id,kind,details) VALUES(req.id,step.id,'step_failed',data);PERFORM cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';RETURN jsonb_build_object('failed',true,'message','A etapa foi interrompida. A manutenção e o checkpoint foram preservados.');
 END;
END $$;
CREATE FUNCTION public.admin_ack_reset_task(p_request_id uuid,p_token text,p_lease uuid,p_kind text,p_id text,p_data jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req private.rp_reset_requests%rowtype;step private.rp_reset_steps%rowtype;c private.rp_reset_backup_chunks%rowtype;ref jsonb;triggers jsonb;BEGIN
 req:=private.assert_reset_worker(p_request_id,p_token,p_lease);PERFORM set_config('govrp.reset_worker',req.id::text,true);
 SELECT * INTO step FROM private.rp_reset_steps WHERE request_id=req.id AND status<>'completed' ORDER BY ordinal LIMIT 1 FOR UPDATE;
 IF p_kind='backup_chunk' THEN
  SELECT * INTO c FROM private.rp_reset_backup_chunks WHERE id=p_id::bigint AND request_id=req.id;
  IF c.id IS NULL OR step.phase<>'backing_up' OR step.operation->>'pending_chunk' IS DISTINCT FROM p_id OR c.digest IS DISTINCT FROM p_data->>'digest' THEN RAISE EXCEPTION 'O checkpoint não corresponde ao bloco de backup.';END IF;
  IF p_data->>'backup_name' IS DISTINCT FROM c.request_id::text||'/database/'||c.schema_name||'/'||c.table_name||'/'||c.chunk_no::text||'.json' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='rp-reset-backups' AND name=p_data->>'backup_name') THEN RAISE EXCEPTION 'A cópia física do bloco de backup ainda não foi confirmada.';END IF;
  UPDATE private.rp_reset_backup_chunks SET object_name=p_data->>'backup_name' WHERE id=c.id;
  FOR ref IN SELECT * FROM jsonb_array_elements(coalesce(p_data->'referenced','[]')) LOOP UPDATE private.rp_reset_assets SET status='pending' WHERE request_id=req.id AND bucket_id=ref->>'bucket' AND object_name=ref->>'name' AND status IN('candidate','unclassified');END LOOP;
  FOR ref IN SELECT * FROM jsonb_array_elements(coalesce(p_data->'retained','[]')) LOOP UPDATE private.rp_reset_assets SET status='retained' WHERE request_id=req.id AND bucket_id=ref->>'bucket' AND object_name=ref->>'name';END LOOP;
  UPDATE private.rp_reset_steps SET status=CASE WHEN c.row_count=0 THEN 'completed' ELSE 'running' END,cursor_value=CASE WHEN c.row_count=0 THEN cursor_value ELSE (operation->'pending_cursor')::text END,operation=operation-'pending_chunk'-'pending_cursor'-'pending_count',processed=processed+c.row_count,completed_at=CASE WHEN c.row_count=0 THEN clock_timestamp() ELSE NULL END WHERE id=step.id;
 ELSIF p_kind='archive_asset' THEN
  IF step.phase<>'backup_verification' OR coalesce(p_data->>'digest','')!~'^[0-9a-f]{64}$' OR (p_data->>'bytes')::bigint<0 THEN RAISE EXCEPTION 'O arquivo não possui cópia íntegra confirmada.';END IF;
  UPDATE private.rp_reset_assets SET status='archived',backup_name=p_data->>'backup_name',digest=p_data->>'digest',bytes=(p_data->>'bytes')::bigint WHERE request_id=req.id AND id=p_id::bigint AND status='pending';
 ELSIF p_kind='delete_asset' THEN
  IF step.phase<>'storage' THEN RAISE EXCEPTION 'A limpeza de arquivos não está autorizada nesta etapa.';END IF;
  UPDATE private.rp_reset_assets a SET status='deleted' WHERE request_id=req.id AND id=p_id::bigint AND status='archived' AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=a.bucket_id AND o.name=a.object_name) AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='rp-reset-backups' AND o.name=a.backup_name);
  IF NOT FOUND THEN RAISE EXCEPTION 'A cópia ou a exclusão do arquivo ainda não foi confirmada.';END IF;
 ELSIF p_kind='delete_account' THEN
  IF step.phase<>'accounts' OR NOT req.remove_common_accounts OR p_id::uuid<>ALL(req.user_ids) OR EXISTS(SELECT 1 FROM private.platform_admins WHERE user_id=p_id::uuid) OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_id::uuid AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'A exclusão protegida desta conta não foi confirmada.';END IF;
  DELETE FROM auth.sessions WHERE user_id=p_id::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.donations WHERE donor_id=p_id::uuid) AND NOT EXISTS(SELECT 1 FROM public.support_tickets WHERE requester_id=p_id::uuid) THEN DELETE FROM private.account_identities WHERE user_id=p_id::uuid;DELETE FROM public.users WHERE auth_user_id=p_id::uuid;END IF;
  triggers:=private.reset_change_triggers('public','profiles');
  UPDATE public.profiles SET deleted_at=clock_timestamp(),anonymized_at=clock_timestamp(),deletion_reason='Conta comum removida no reset de lançamento.' WHERE id=p_id::uuid AND NOT EXISTS(SELECT 1 FROM private.platform_admins WHERE user_id=p_id::uuid);
  PERFORM private.reset_change_triggers('public','profiles',triggers);
  INSERT INTO private.rp_reset_targets(request_id,schema_name,table_name,row_id) VALUES(req.id,'auth','deleted_account_ack',p_id::uuid) ON CONFLICT DO NOTHING;
 ELSE RAISE EXCEPTION 'Tarefa de manutenção inválida.';END IF;
END $$;
CREATE FUNCTION private.validate_controlled_reset(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req private.rp_reset_requests%rowtype;admins jsonb;fk record;join_sql text;not_null_sql text;bad boolean;orphans jsonb:='[]';issues jsonb:='[]';baseline jsonb;BEGIN
 SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY user_id),'[]') INTO admins FROM private.platform_admins a;
 IF admins IS DISTINCT FROM req.admin_snapshot OR EXISTS(SELECT 1 FROM private.platform_admins a LEFT JOIN auth.users u ON u.id=a.user_id LEFT JOIN public.profiles p ON p.id=a.user_id WHERE u.id IS NULL OR u.deleted_at IS NOT NULL OR p.id IS NULL OR p.deleted_at IS NOT NULL OR p.role<>'Admin' OR NOT public.is_admin(a.user_id)) THEN issues:=issues||jsonb_build_array('As identidades e concessões administrativas não correspondem ao snapshot protegido.');END IF;
 IF EXISTS(SELECT 1 FROM public.profiles WHERE deleted_at IS NULL AND (role NOT IN('Admin','Cidadão') OR coalesce(array_length(titles,1),0)>0 OR onboarding_completed)) THEN issues:=issues||jsonb_build_array('Restaram cargos, personagens ou permissões institucionais anteriores.');END IF;
 IF EXISTS(SELECT 1 FROM private.rp_reset_backup_chunks b CROSS JOIN LATERAL jsonb_array_elements(b.payload)x JOIN public.profiles p ON p.id=(x->>'id')::uuid WHERE b.request_id=req.id AND b.schema_name='public' AND b.table_name='profiles' AND p.deleted_at IS NULL AND p.citizen_id=(x->>'citizen_id')::uuid) THEN issues:=issues||jsonb_build_array('Um identificador de personagem anterior permaneceu ativo.');END IF;
 IF NOT EXISTS(SELECT 1 FROM private.rp_launch_backups WHERE request_id=req.id AND snapshot->>'state'='verified') OR EXISTS(SELECT 1 FROM private.rp_reset_backup_chunks WHERE request_id=req.id AND (NOT verified OR object_name IS NULL OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='rp-reset-backups' AND o.name=object_name))) THEN issues:=issues||jsonb_build_array('O backup não está integralmente verificado.');END IF;
 IF EXISTS(SELECT 1 FROM private.rp_reset_assets WHERE request_id=req.id AND status NOT IN('retained','deleted')) THEN issues:=issues||jsonb_build_array('Há arquivos pendentes de preservação ou limpeza.');END IF;
 IF req.remove_common_accounts AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=ANY(req.user_ids) AND u.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=u.id)) THEN issues:=issues||jsonb_build_array('Há contas comuns que ainda possuem acesso.');END IF;
 IF req.remove_common_accounts AND EXISTS(SELECT 1 FROM unnest(req.user_ids)u(id) WHERE NOT EXISTS(SELECT 1 FROM private.platform_admins a WHERE a.user_id=u.id) AND (NOT EXISTS(SELECT 1 FROM private.rp_reset_targets ack WHERE ack.request_id=req.id AND ack.schema_name='auth' AND ack.table_name='deleted_account_ack' AND ack.row_id=u.id) OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=u.id AND p.deleted_at IS NULL) OR EXISTS(SELECT 1 FROM auth.sessions s WHERE s.user_id=u.id))) THEN issues:=issues||jsonb_build_array('Há contas com encerramento, sessões ou anonimização ainda pendentes.');END IF;
 IF EXISTS(SELECT 1 FROM cron.job j JOIN private.rp_reset_job_schedules s ON s.job_id=j.jobid WHERE s.request_id=req.id AND j.active) THEN issues:=issues||jsonb_build_array('Uma automação do mundo foi reativada antes da validação.');END IF;
 IF req.preview->'trigger_snapshot' IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'trigger',g.tgname,'enabled',g.tgenabled) ORDER BY n.nspname,c.relname,g.tgname) FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT g.tgisinternal AND n.nspname IN('public','private','auth','storage')) THEN issues:=issues||jsonb_build_array('Uma trigger não retornou ao estado original.');END IF;
 IF req.schema_fingerprint IS DISTINCT FROM private.reset_schema_fingerprint() OR (private.reset_audit()->>'blocked')::boolean THEN issues:=issues||jsonb_build_array('A cobertura do catálogo não corresponde ao esquema atual.');END IF;
 FOR fk IN SELECT k.oid,k.conrelid,k.confrelid,k.conkey,k.confkey,k.conname,n.nspname,c.relname,rn.nspname parent_schema,rc.relname parent_table FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class rc ON rc.oid=k.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE k.contype='f' AND n.nspname IN('public','private','economy_private') LOOP
  SELECT string_agg(format('c.%I=p.%I',ca.attname,pa.attname),' AND '),string_agg(format('c.%I IS NOT NULL',ca.attname),' AND ') INTO join_sql,not_null_sql FROM unnest(fk.conkey,fk.confkey)u(child_num,parent_num) JOIN pg_attribute ca ON ca.attrelid=fk.conrelid AND ca.attnum=u.child_num JOIN pg_attribute pa ON pa.attrelid=fk.confrelid AND pa.attnum=u.parent_num;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I c WHERE %s AND NOT EXISTS(SELECT 1 FROM %I.%I p WHERE %s))',fk.nspname,fk.relname,not_null_sql,fk.parent_schema,fk.parent_table,join_sql) INTO bad;
  IF bad THEN orphans:=orphans||jsonb_build_array(jsonb_build_object('schema',fk.nspname,'table',fk.relname,'constraint',fk.conname));END IF;
 END LOOP;
 IF jsonb_array_length(orphans)>0 THEN issues:=issues||jsonb_build_array('Foram encontradas referências órfãs.');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.business_types) OR NOT EXISTS(SELECT 1 FROM public.economic_resources) OR (SELECT count(*) FROM public.parliament_houses)<2 OR NOT EXISTS(SELECT 1 FROM public.penal_code) OR NOT EXISTS(SELECT 1 FROM public.state_enterprises WHERE is_system) OR NOT EXISTS(SELECT 1 FROM public.country_rp_states WHERE country_code='BR' AND is_playable) OR NOT EXISTS(SELECT 1 FROM public.system_settings WHERE key='bank_policy') OR NOT EXISTS(SELECT 1 FROM public.government_finances WHERE id=1 AND treasury_balance=0 AND loans_balance=0 AND corporate_card_used=0) THEN issues:=issues||jsonb_build_array('A inicialização dos catálogos, instituições ou da economia está incompleta.');END IF;
 RETURN jsonb_build_object('valid',jsonb_array_length(issues)=0,'issues',issues,'orphans',orphans,'preserved_admins',jsonb_array_length(admins),'admin_ids',(SELECT jsonb_agg(a->'user_id') FROM jsonb_array_elements(admins)a),'tables_verified',(SELECT count(*) FROM private.reset_catalog()),'modules_verified',(SELECT count(DISTINCT module) FROM private.reset_catalog()),'jobs_verified',(SELECT count(*) FROM private.rp_reset_job_schedules WHERE request_id=req.id),'auth_accounts_preserved',NOT req.remove_common_accounts,'validation_at',clock_timestamp());
END $$;
CREATE FUNCTION public.admin_validate_controlled_reset(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM private.assert_reset_operator();RETURN private.validate_controlled_reset(p_request_id);END $$;
CREATE FUNCTION public.admin_resume_controlled_reset(p_request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE actor uuid:=private.assert_reset_operator(true);req private.rp_reset_requests%rowtype;BEGIN SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id FOR UPDATE;IF req.status<>'failed' OR NOT EXISTS(SELECT 1 FROM private.rp_reset_runtime WHERE id AND maintenance AND request_id=req.id) THEN RAISE EXCEPTION 'Esta execução não está aguardando recuperação.';END IF;IF req.schema_fingerprint IS DISTINCT FROM private.reset_schema_fingerprint() THEN RAISE EXCEPTION 'Revise a alteração de esquema com o operador técnico antes de retomar.';END IF;UPDATE private.rp_reset_steps SET status='pending' WHERE request_id=req.id AND status='failed';UPDATE private.rp_reset_requests SET status='draining',lease_id=NULL,lease_until=NULL WHERE id=req.id;PERFORM cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';INSERT INTO private.rp_reset_job_events(request_id,kind,details) VALUES(req.id,'reset_resumed',jsonb_build_object('actor',actor));END $$;
CREATE FUNCTION public.admin_reopen_reset_world(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE actor uuid:=private.assert_reset_operator(true);req private.rp_reset_requests%rowtype;validation jsonb;s record;BEGIN SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id FOR UPDATE;IF req.status='completed' THEN RETURN req.result;END IF;IF req.status<>'validated' THEN RAISE EXCEPTION 'O mundo só pode ser reaberto após validação integral.';END IF;validation:=private.validate_controlled_reset(req.id);IF NOT (validation->>'valid')::boolean THEN RAISE EXCEPTION 'A validação atual exige revisão. A manutenção será mantida.';END IF;PERFORM set_config('govrp.reset_worker',req.id::text,true);UPDATE private.rp_reset_requests SET status='completed',completed_at=clock_timestamp(),reopened_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=req.id;UPDATE private.rp_reset_runtime SET maintenance=false,request_id=NULL,changed_at=clock_timestamp() WHERE id AND request_id=req.id;FOR s IN SELECT * FROM private.rp_reset_job_schedules WHERE request_id=req.id LOOP IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=s.job_id AND command=s.command AND schedule=s.schedule) THEN RAISE EXCEPTION 'Um agendamento mudou durante o reset. Revise antes de reabrir.';END IF;PERFORM cron.alter_job(s.job_id,active:=s.was_active);END LOOP;INSERT INTO private.rp_reset_job_events(request_id,kind,details) VALUES(req.id,'world_reopened',jsonb_build_object('actor',actor,'generation',req.generation_after));RETURN validation||jsonb_build_object('success',true,'request_id',req.id);END $$;
CREATE FUNCTION public.admin_finish_reset_worker(p_request_id uuid,p_token text,p_lease uuid,p_error text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE req private.rp_reset_requests%rowtype;BEGIN SELECT * INTO req FROM private.rp_reset_requests WHERE id=p_request_id FOR UPDATE;IF req.lease_id IS DISTINCT FROM p_lease OR extensions.digest(p_token,'sha256') IS DISTINCT FROM extensions.digest(req.worker_token,'sha256') THEN RETURN;END IF;IF p_error IS NOT NULL AND req.status NOT IN('failed','validated','completed') THEN UPDATE private.rp_reset_requests SET status='failed',last_error=jsonb_build_object('message',left(p_error,1500),'phase',current_phase,'at',clock_timestamp()) WHERE id=req.id;UPDATE private.rp_reset_steps SET status='failed',last_error=jsonb_build_object('message',left(p_error,1500)) WHERE id=(SELECT id FROM private.rp_reset_steps WHERE request_id=req.id AND status<>'completed' ORDER BY ordinal LIMIT 1);INSERT INTO private.rp_reset_job_events(request_id,kind,details) VALUES(req.id,'worker_interrupted',jsonb_build_object('message',left(p_error,1500)));PERFORM cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';END IF;UPDATE private.rp_reset_requests SET lease_id=NULL,lease_until=NULL WHERE id=req.id;END $$;
CREATE FUNCTION private.dispatch_reset_worker() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE req private.rp_reset_requests%rowtype;endpoint text;BEGIN SELECT r.* INTO req FROM private.rp_reset_requests r JOIN private.rp_reset_runtime s ON s.request_id=r.id AND s.id AND s.maintenance WHERE r.status NOT IN('draft','expired','failed','validated','completed','cancelled') AND (r.lease_until IS NULL OR r.lease_until<=clock_timestamp()) LIMIT 1;IF req.id IS NULL THEN RETURN;END IF;SELECT worker_endpoint INTO endpoint FROM private.rp_reset_runtime WHERE id;PERFORM net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-govrp-reset-token',req.worker_token),body:=jsonb_build_object('request_id',req.id),timeout_milliseconds:=8000);END $$;
SELECT cron.schedule('govrp-controlled-reset-worker','10 seconds','select private.dispatch_reset_worker();');
SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN('reset_change_triggers','reset_fk_detachable','seed_reset_world','plan_controlled_reset','reset_chunk_packet','assert_reset_worker','validate_controlled_reset','dispatch_reset_worker') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);END LOOP;END $$;
REVOKE ALL ON FUNCTION public.admin_get_controlled_reset(uuid),public.admin_validate_controlled_reset(uuid),public.admin_resume_controlled_reset(uuid),public.admin_reopen_reset_world(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_controlled_reset(uuid),public.admin_validate_controlled_reset(uuid),public.admin_resume_controlled_reset(uuid),public.admin_reopen_reset_world(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_claim_reset_worker(uuid,text),public.admin_process_reset_batch(uuid,text,uuid),public.admin_ack_reset_task(uuid,text,uuid,text,text,jsonb),public.admin_finish_reset_worker(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_claim_reset_worker(uuid,text),public.admin_process_reset_batch(uuid,text,uuid),public.admin_ack_reset_task(uuid,text,uuid,text,text,jsonb),public.admin_finish_reset_worker(uuid,text,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.admin_backup_rp_reset(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE actor uuid:=private.assert_reset_operator();b private.rp_launch_backups%rowtype;BEGIN SELECT * INTO b FROM private.rp_launch_backups WHERE request_id=p_request_id;IF b.id IS NULL THEN RETURN jsonb_build_object('ready',false,'message','O backup paginado será criado e verificado sob manutenção após a confirmação, antes da limpeza.');END IF;RETURN jsonb_build_object('id',b.id,'request_id',b.request_id,'created_at',b.created_at,'digest',b.digest,'state',b.snapshot->>'state','ready',b.snapshot->>'state'='verified','manifest',b.snapshot,'admins',b.admins,'chunks',(SELECT jsonb_agg(jsonb_build_object('schema',schema_name,'table',table_name,'number',chunk_no,'digest',digest,'rows',row_count,'object_name',object_name,'verified',verified) ORDER BY schema_name,table_name,chunk_no) FROM private.rp_reset_backup_chunks WHERE request_id=p_request_id),'assets',(SELECT coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'name',object_name,'backup_name',backup_name,'digest',digest,'bytes',bytes,'status',status) ORDER BY bucket_id,object_name),'[]') FROM private.rp_reset_assets WHERE request_id=p_request_id));END $$;
-- Catalog lint also found an obsolete finalizer name in the legislative transition.
CREATE OR REPLACE FUNCTION public.update_bill_status(p_bill_id uuid, p_new_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); bill public.bills%rowtype; voting public.parliament_votings%rowtype; finalized jsonb; qualified boolean; houses integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING errcode='42501'; END IF;
 SELECT * INTO bill FROM public.bills WHERE id=p_bill_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILL_NOT_FOUND'; END IF;
 IF bill.type='IMPEACHMENT' THEN RAISE EXCEPTION 'O impeachment é decidido pela votação institucional da Câmara.'; END IF;
 IF bill.type='PDL' AND bill.suspends_decree_id IS NOT NULL THEN RAISE EXCEPTION 'A sustação é decidida pela votação legislativa, sem sanção presidencial.'; END IF;
 qualified:=bill.type IN('PEC','Proposta de Emenda Constitucional');
 IF p_new_status IN('Aguardando sanção presidencial','Aguardando promulgação presidencial','Rejeitado') THEN
  IF NOT(public.is_parliament_governance_manager(actor,bill.house_id) OR public.get_active_parliament_member_id(actor,bill.house_id) IS NOT NULL) THEN RAISE EXCEPTION 'PARLIAMENT_AUTHORITY_REQUIRED' USING errcode='42501'; END IF;
  SELECT * INTO voting FROM public.parliament_votings WHERE related_id=bill.id AND type='bill' ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILL_VOTING_NOT_FOUND'; END IF;
  finalized:=private.finalize_bill_voting(voting.id);
  IF NOT coalesce((finalized->>'finalized')::boolean,false) THEN RAISE EXCEPTION 'BILL_VOTING_NOT_READY'; END IF;
  SELECT * INTO bill FROM public.bills WHERE id=p_bill_id;
  IF bill.status IS DISTINCT FROM p_new_status THEN RAISE EXCEPTION 'O resultado da votação não permite esta transição. Consulte a tramitação atual.'; END IF;
  RETURN;
 ELSIF p_new_status IN('Sancionado','Promulgado','Vetado integralmente','Vetado parcialmente') THEN
  SELECT * INTO bill FROM public.bills WHERE id=p_bill_id FOR UPDATE;
  IF NOT public.economic_has_role(ARRAY['Admin','Presidente']) THEN RAISE EXCEPTION 'EXECUTIVE_AUTHORITY_REQUIRED' USING errcode='42501'; END IF;
  IF bill.status=p_new_status THEN RETURN; END IF;
  IF bill.status NOT IN('Aguardando sanção presidencial','Aguardando promulgação presidencial','Aprovado') THEN RAISE EXCEPTION 'BILL_NOT_AWAITING_EXECUTIVE_DECISION'; END IF;
  IF qualified AND p_new_status<>'Promulgado' THEN RAISE EXCEPTION 'A proposta constitucional aprovada deve ser promulgada após deliberação nas duas Casas.'; END IF;
  IF NOT qualified AND p_new_status='Promulgado' THEN RAISE EXCEPTION 'Escolha sanção ou veto para este projeto de lei.'; END IF;
  SELECT count(DISTINCT house_id) INTO houses FROM public.parliament_votings WHERE related_id=bill.id AND type='bill' AND status='closed' AND coalesce((result->>'approved')::boolean,false);
  IF houses<(CASE WHEN qualified THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'A medida exige deliberação legislativa concluída e aprovada nas Casas competentes.'; END IF;
 ELSE RAISE EXCEPTION 'INVALID_BILL_STATUS'; END IF;
 UPDATE public.bills SET status=p_new_status,updated_at=clock_timestamp() WHERE id=bill.id;
 IF p_new_status IN('Sancionado','Promulgado') THEN
  INSERT INTO public.dou_entries(title,summary,content,published_at,type,source_id)
  SELECT bill.title,CASE WHEN p_new_status='Sancionado' THEN 'Lei sancionada pela Presidência da República.' ELSE 'Norma promulgada e publicada oficialmente.' END,coalesce(nullif(bill.full_text,''),bill.summary),clock_timestamp(),bill.type,bill.id
  WHERE NOT EXISTS(SELECT 1 FROM public.dou_entries WHERE source_id=bill.id);
 END IF;
END $function$
;
COMMIT;
