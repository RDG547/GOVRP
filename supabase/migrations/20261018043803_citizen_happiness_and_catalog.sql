begin;
alter table public.citizen_needs add column happiness numeric not null default 65 check(happiness between 0 and 100),
 add column happiness_low_since timestamptz,add column happiness_recovery_since timestamptz,add column rp_depression_since timestamptz;
insert into public.system_settings(key,value,description) values('citizen_happiness','{"low_threshold":25,"low_hours":24,"recovery_threshold":75,"recovery_hours":48,"social_daily_cap":8,"social_cooldown_seconds":300,"election_win":50,"election_loss":-50,"property_purchase":15,"professional_achievement":3,"alcohol_happiness":8,"alcohol_thirst":15,"alcohol_health":-3,"productivity_factor":0.9}','Felicidade e condição exclusivamente ficcional do RP. Tempos em horas reais.') on conflict do nothing;
create table public.citizen_happiness_events(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,event_key text not null,source_key text not null,delta numeric not null,before_value numeric not null,after_value numeric not null,created_at timestamptz not null default clock_timestamp(),unique(user_id,source_key));
alter table public.citizen_happiness_events enable row level security;
revoke all on public.citizen_happiness_events from public,anon,authenticated;
grant select on public.citizen_happiness_events to authenticated;
create policy happiness_owner_read on public.citizen_happiness_events for select to authenticated using(user_id=(select auth.uid()) or (select public.is_admin()));
create index happiness_events_user_time on public.citizen_happiness_events(user_id,created_at desc);

create function private.happiness_condition() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg jsonb;
begin
 select value into cfg from public.system_settings where key='citizen_happiness';
 if new.happiness<(cfg->>'low_threshold')::numeric then
  new.happiness_low_since:=coalesce(old.happiness_low_since,clock_timestamp());
  if new.rp_depression_since is null and new.happiness_low_since+make_interval(hours=>(cfg->>'low_hours')::integer)<=clock_timestamp() then new.rp_depression_since:=clock_timestamp();end if;
 else new.happiness_low_since:=null;end if;
 if new.rp_depression_since is not null and new.happiness>(cfg->>'recovery_threshold')::numeric then
  new.happiness_recovery_since:=coalesce(old.happiness_recovery_since,clock_timestamp());
  if new.happiness_recovery_since+make_interval(hours=>(cfg->>'recovery_hours')::integer)<=clock_timestamp() then new.rp_depression_since:=null;new.happiness_recovery_since:=null;end if;
 else new.happiness_recovery_since:=null;end if;
 return new;
end $$;
create trigger happiness_condition before update on public.citizen_needs for each row execute function private.happiness_condition();
revoke all on function private.happiness_condition() from public,anon,authenticated;

create function private.apply_happiness(p_user_id uuid,p_event_key text,p_source_key text,p_delta numeric default null) returns void language plpgsql security definer set search_path='' as $$
declare n public.citizen_needs%rowtype;cfg jsonb;d numeric;earned numeric;last_event timestamptz;
begin
 if not exists(select 1 from public.profiles where id=p_user_id and onboarding_completed and deleted_at is null) then return;end if;
 select value into cfg from public.system_settings where key='citizen_happiness';
 n:=private.refresh_citizen_needs(p_user_id);
 if exists(select 1 from public.citizen_happiness_events where user_id=p_user_id and source_key=p_source_key) then return;end if;
 d:=coalesce(p_delta,(cfg->>p_event_key)::numeric,0);
 if p_event_key='social' then
  select coalesce(sum(greatest(delta,0)),0),max(created_at) into earned,last_event from public.citizen_happiness_events where user_id=p_user_id and event_key='social' and created_at>=date_trunc('day',clock_timestamp() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  if last_event+make_interval(secs=>(cfg->>'social_cooldown_seconds')::integer)>clock_timestamp() then return;end if;
  d:=least(1,greatest(0,(cfg->>'social_daily_cap')::numeric-earned));
 end if;
 if d=0 then return;end if;
 update public.citizen_needs set happiness=greatest(0,least(100,happiness+d)),updated_at=clock_timestamp() where user_id=p_user_id;
 insert into public.citizen_happiness_events(user_id,event_key,source_key,delta,before_value,after_value) values(p_user_id,p_event_key,p_source_key,d,n.happiness,greatest(0,least(100,n.happiness+d)));
end $$;
revoke all on function private.apply_happiness(uuid,text,text,numeric) from public,anon,authenticated;

create function private.happiness_world_event() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid;item jsonb:=to_jsonb(new);c record;won boolean;event text;uid uuid;
begin
 if tg_table_name='election_settlements' then
  if new.status<>'settled' then return new;end if;
  for c in select user_id,vice_candidate_id,id from public.candidates where election_id=new.election_id and status='Approved' loop
   won:=exists(select 1 from jsonb_array_elements(new.result) w where w->>'candidate_id'=c.id::text);
   event:=case when won then 'election_win' else 'election_loss' end;
   foreach uid in array array[c.user_id,c.vice_candidate_id] loop if uid is not null then perform private.apply_happiness(uid,event,'election:'||new.election_id);end if;end loop;
  end loop;
 elsif tg_table_name='citizen_residences' then
  actor:=(item->>'owner_id')::uuid;
  if actor is not null and (tg_op='INSERT' or new.owner_id is distinct from old.owner_id) then perform private.apply_happiness(actor,'property_purchase','property:first:residence');end if;
 elsif tg_table_name='professional_work_sessions' then
  if new.status='completed' and old.status<>'completed' and new.score>=80 then perform private.apply_happiness(new.user_id,'professional_achievement','professional:'||new.business_id||':'||(clock_timestamp() at time zone 'America/Sao_Paulo')::date);end if;
 else
  actor:=coalesce((item->>'user_id')::uuid,(item->>'sender_id')::uuid);
  if tg_table_name in ('posts','comments','messages') and length(btrim(coalesce(item->>'content','')))<10 then return new;end if;
  if tg_table_name='likes' and exists(select 1 from public.posts where id=(item->>'post_id')::uuid and user_id=actor) then return new;end if;
  if actor is not null then perform private.apply_happiness(actor,'social',tg_table_name||':'||coalesce(item->>'id',item->>'post_id')||':'||actor);end if;
 end if;
 return new;
end $$;
revoke all on function private.happiness_world_event() from public,anon,authenticated;
create trigger happiness_election after insert on public.election_settlements for each row execute function private.happiness_world_event();
create trigger happiness_residence after insert or update of owner_id on public.citizen_residences for each row execute function private.happiness_world_event();
create trigger happiness_work after update of status on public.professional_work_sessions for each row execute function private.happiness_world_event();
create trigger happiness_posts after insert on public.posts for each row execute function private.happiness_world_event();
create trigger happiness_comments after insert on public.comments for each row execute function private.happiness_world_event();
create trigger happiness_likes after insert on public.likes for each row execute function private.happiness_world_event();

create function public.configure_citizen_happiness(p_config jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare k text;v numeric;previous jsonb;
begin
 if not public.is_admin() then raise exception 'Somente a administração pode configurar a felicidade.' using errcode='42501';end if;
 select value into previous from public.system_settings where key='citizen_happiness' for update;
 if jsonb_typeof(p_config) is distinct from 'object' or (p_config-array(select jsonb_object_keys(previous)))<>'{}' or (previous-array(select jsonb_object_keys(p_config)))<>'{}' then raise exception 'Informe todas as opções de felicidade.';end if;
 for k,v in select key,value::numeric from jsonb_each_text(p_config) loop
  if v is null or v::text in ('NaN','Infinity','-Infinity') or v not between -100 and 604800 then raise exception 'Configuração inválida.';end if;
 end loop;
 if (p_config->>'low_threshold')::numeric not between 0 and 50 or (p_config->>'recovery_threshold')::numeric not between 51 and 99 or (p_config->>'low_hours')::int not between 1 and 720 or (p_config->>'recovery_hours')::int not between 1 and 720 or (p_config->>'social_daily_cap')::numeric not between 0 and 20 or (p_config->>'social_cooldown_seconds')::int not between 60 and 86400 or (p_config->>'productivity_factor')::numeric not between .75 and 1 then raise exception 'Preserve os limites de tempo, recuperação e produtividade.';end if;
 update public.system_settings set value=p_config where key='citizen_happiness';
 perform economy_private.audit('happiness_configured','system_settings','citizen_happiness',previous,p_config,'Balanceamento da felicidade ficcional.',auth.uid());
 return p_config;
end $$;
revoke all on function public.configure_citizen_happiness(jsonb) from public,anon;
grant execute on function public.configure_citizen_happiness(jsonb) to authenticated;

create function private.maintain_happiness() returns void language sql security definer set search_path='' as $$
 update public.citizen_needs set updated_at=clock_timestamp() where happiness_low_since is not null or happiness_recovery_since is not null;
$$;
revoke all on function private.maintain_happiness() from public,anon,authenticated;
select cron.schedule('govrp-happiness-condition','*/5 * * * *','select private.maintain_happiness()');
alter publication supabase_realtime add table public.citizen_happiness_events;

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
   if (coalesce((effects->>'hunger')::numeric,0)=0 or n.hunger>=100) and (coalesce((effects->>'thirst')::numeric,0)=0 or n.thirst>=100) and (coalesce((effects->>'social')::numeric,0)=0 or n.social>=100) and (coalesce((effects->>'happiness')::numeric,0)=0 or n.happiness>=100) then raise exception 'Suas necessidades de alimentação e bebida já estão completas.'; end if;
   if coalesce((effects->>'health')::numeric,0)<0 and n.health+(effects->>'health')::numeric<25 then raise exception 'Sua saúde está muito baixa para esta bebida. Procure atendimento no SNS antes de consumir.';end if;
   update public.user_inventory set quantity=quantity-1 where id=item.id;
   n.hunger:=greatest(0,least(100,n.hunger+coalesce((effects->>'hunger')::numeric,0)));n.thirst:=greatest(0,least(100,n.thirst+coalesce((effects->>'thirst')::numeric,0)));
   n.happiness:=greatest(0,least(100,n.happiness+coalesce((effects->>'happiness')::numeric,0)));
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
CREATE OR REPLACE FUNCTION private.validate_citizen_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare k text; v jsonb;
begin
 if current_user not in('postgres','supabase_admin','service_role') and (new.state_enterprise_id is not null or new.residence_spec is not null) then raise exception 'Somente a gestão autorizada pode cadastrar ofertas estatais e imóveis.' using errcode='42501'; end if;
 if jsonb_typeof(new.consumable_effects)<>'object' then raise exception 'Defina os efeitos do consumível corretamente.'; end if;
 if new.consumable_effects ?| array['health','social','happiness'] then
   if new.category<>'Bebidas' or new.product_type<>'one-time' or new.consumable_effects<>'{"thirst":15,"happiness":8,"health":-3}'::jsonb then raise exception 'Bebidas alcoólicas usam os efeitos balanceados: sede +15, felicidade +8 e saúde -3.' using errcode='22023';end if;
   return new;
 end if;
 for k,v in select * from jsonb_each(new.consumable_effects) loop
   if k not in('hunger','thirst') or jsonb_typeof(v)<>'number' or v::numeric<=0 or v::numeric>60 then raise exception 'Consumíveis podem recuperar até 60 pontos de fome ou sede.'; end if;
 end loop;
 if new.consumable_effects<>'{}' and (new.product_type<>'one-time' or new.category not in('Alimentos','Bebidas')) then raise exception 'Consumíveis devem ser produtos de alimentos ou bebidas com quantidade em estoque.'; end if;
 return new;
end; $function$
;
update public.products set consumable_effects=(consumable_effects-'social')||jsonb_build_object('happiness',8) where coalesce((consumable_effects->>'health')::numeric,0)<0;
commit;
