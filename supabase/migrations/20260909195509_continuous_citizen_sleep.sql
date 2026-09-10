begin;
alter table public.citizen_needs add column sleep_started_at timestamptz, add column sleep_due_at timestamptz,
 add column sleep_start_value numeric, add column sleep_residence_id uuid;
alter table public.citizen_needs add constraint citizen_sleep_session check (
 (sleep_started_at is null and sleep_due_at is null and sleep_start_value is null and sleep_residence_id is null)
 or (sleep_started_at is not null and sleep_due_at>sleep_started_at and sleep_start_value between 0 and 100 and sleep_residence_id is not null));
update public.system_settings set value=(value-'offline_decay_cap')||jsonb_build_object('offline_floor',5,'sleep_duration_real_minutes',15) where key='citizen_needs';


CREATE OR REPLACE FUNCTION private.refresh_citizen_needs(p_user_id uuid)
 RETURNS citizen_needs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.citizen_needs%rowtype; cfg jsonb; elapsed numeric; completed_sleep_at timestamptz; sleep_elapsed numeric; day_rp timestamptz:=public.rp_now(); values_json jsonb; k text; v numeric; loss numeric; band integer; alerts jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_user_id and onboarding_completed) then return null; end if;
 select value into cfg from public.system_settings where key='citizen_needs';
 insert into public.citizen_needs(user_id,grace_until_rp) values(p_user_id,day_rp+make_interval(days=>coalesce((cfg->>'grace_rp_days')::integer,2))) on conflict do nothing;
 select * into n from public.citizen_needs where user_id=p_user_id for update;
 elapsed:=greatest(0,extract(epoch from (day_rp-greatest(n.updated_at_rp,n.grace_until_rp)))/86400);
 if n.sleep_started_at is not null then
   if clock_timestamp()>=n.sleep_due_at then
     completed_sleep_at:=n.sleep_due_at;
     n.sleep:=100;n.sleep_started_at:=null;n.sleep_due_at:=null;n.sleep_start_value:=null;n.sleep_residence_id:=null;
   else
     n.sleep:=least(100,n.sleep_start_value+(100-n.sleep_start_value)*extract(epoch from(clock_timestamp()-n.sleep_started_at))/extract(epoch from(n.sleep_due_at-n.sleep_started_at)));
   end if;
 end if;
 values_json:=to_jsonb(n); alerts:=n.alert_bands;
 foreach k in array array['hunger','thirst','hygiene','social','sleep'] loop
   loss:=elapsed*coalesce((cfg->'decay_per_rp_day'->>k)::numeric,2);
   if k='sleep' and n.sleep_started_at is not null then loss:=0;
   elsif k='sleep' and completed_sleep_at is not null then loss:=greatest(0,extract(epoch from(day_rp-public.real_date_to_rp_date(completed_sleep_at)))/86400)*coalesce((cfg->'decay_per_rp_day'->>'sleep')::numeric,2); end if;
   v:=greatest(least((values_json->>k)::numeric,coalesce((cfg->>'offline_floor')::numeric,5)),(values_json->>k)::numeric-loss);
   values_json:=jsonb_set(values_json,array[k],to_jsonb(round(v,2)));
   band:=case when v<=15 then 15 when v<=30 then 30 else 0 end;
   if band>0 and (coalesce((alerts->>k)::integer,100)>band) then
     insert into public.notifications(user_id,type,content,link,metadata) values(p_user_id,'citizen_need_alert',
       case k when 'hunger' then 'Sua fome está baixa. Consuma um alimento do inventário.' when 'thirst' then 'Sua sede está baixa. Consuma uma bebida.' when 'hygiene' then 'É hora de cuidar da higiene. Tome banho em sua residência.' when 'sleep' then 'Seu cidadão está cansado. Descanse em sua residência.' else 'Seu cidadão precisa socializar. Participe da Rede X.' end,
       case when k='social' then '/services/x' when k in('hygiene','sleep') then '/services/national-housing' else '/services/inventory' end,jsonb_build_object('need',k,'threshold',band));
     alerts:=jsonb_set(alerts,array[k],to_jsonb(band));
   elsif v>=40 then alerts:=alerts-k; end if;
 end loop;
 if least(n.hunger,n.thirst,n.hygiene,n.sleep)<20 then n.health:=greatest(25,n.health-least(5,elapsed*.5));
 elsif least(n.hunger,n.thirst,n.hygiene,n.sleep)>=50 then n.health:=least(100,n.health+least(5,elapsed)); end if;
 update public.citizen_needs set health=round(n.health,2),hunger=(values_json->>'hunger')::numeric,thirst=(values_json->>'thirst')::numeric,
 hygiene=(values_json->>'hygiene')::numeric,social=(values_json->>'social')::numeric,sleep=(values_json->>'sleep')::numeric,
 sleep_started_at=n.sleep_started_at,sleep_due_at=n.sleep_due_at,sleep_start_value=n.sleep_start_value,sleep_residence_id=n.sleep_residence_id,
 updated_at=clock_timestamp(),updated_at_rp=day_rp,alert_bands=alerts where user_id=p_user_id returning * into n;
 return n;
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
   if effects is null or effects='{}' then raise exception 'Este produto não é consumível.'; end if;
   if (coalesce((effects->>'hunger')::numeric,0)=0 or n.hunger>=100) and (coalesce((effects->>'thirst')::numeric,0)=0 or n.thirst>=100) then raise exception 'Suas necessidades de alimentação e bebida já estão completas.'; end if;
   update public.user_inventory set quantity=quantity-1 where id=item.id;
   n.hunger:=least(100,n.hunger+coalesce((effects->>'hunger')::numeric,0));n.thirst:=least(100,n.thirst+coalesce((effects->>'thirst')::numeric,0));
 elsif p_action in('bath','sleep') then
   perform private.assert_citizen_service('/services/national-housing');
   select * into residence from public.citizen_residences where id=p_reference_id and owner_id=auth.uid() and status='owned';
   if not found then raise exception 'Você precisa possuir esta residência para usá-la.' using errcode='42501'; end if;
   if p_action='bath' then
     if n.last_bath_rp+make_interval(hours=>coalesce((cfg->>'bath_cooldown_rp_hours')::integer,8))>public.rp_now() then raise exception 'Você já tomou banho recentemente. Aguarde o intervalo do RP.'; end if;
     n.hygiene:=100;n.last_bath_rp:=public.rp_now();
   else
     if n.last_sleep_rp+make_interval(hours=>coalesce((cfg->>'sleep_cooldown_rp_hours')::integer,12))>public.rp_now() then raise exception 'Você já descansou recentemente. Aguarde o intervalo do RP.'; end if;
     if n.sleep>=100 then raise exception 'Seu cidadão já está descansado.'; end if;
     n.last_sleep_rp:=public.rp_now();n.sleep_started_at:=clock_timestamp();n.sleep_start_value:=n.sleep;n.sleep_residence_id:=residence.id;
     n.sleep_due_at:=n.sleep_started_at+make_interval(secs=>greatest(1,coalesce((cfg->>'sleep_duration_real_minutes')::numeric,15)*60*(100-n.sleep)/100)::double precision);
   end if;
 else raise exception 'Escolha consumir, tomar banho ou dormir.'; end if;
 update public.citizen_needs set hunger=n.hunger,thirst=n.thirst,hygiene=n.hygiene,sleep=n.sleep,last_bath_rp=n.last_bath_rp,last_sleep_rp=n.last_sleep_rp,sleep_started_at=n.sleep_started_at,sleep_due_at=n.sleep_due_at,sleep_start_value=n.sleep_start_value,sleep_residence_id=n.sleep_residence_id,updated_at=clock_timestamp(),alert_bands=(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(n.alert_bands) where coalesce((to_jsonb(n)->>key)::numeric,0)<40) where user_id=auth.uid() returning * into n;
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
 if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
 n:=private.refresh_citizen_needs(auth.uid());
 if n.user_id is null then return null; end if;
 select extract(year from age(public.rp_now(),date_of_birth))::integer into age_rp from public.profiles where id=auth.uid();
 return to_jsonb(n)||jsonb_build_object('age_rp',greatest(0,age_rp),'rp_now',public.rp_now(),'server_now',clock_timestamp());
end; $function$

;

create or replace function public.configure_citizen_needs(p_config jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_cfg jsonb; k text; v numeric;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='Admin') then raise exception 'Somente a administração pode configurar as necessidades.' using errcode='42501'; end if;
 if jsonb_typeof(p_config) is distinct from 'object' or jsonb_typeof(p_config->'decay_per_rp_day') is distinct from 'object' then raise exception 'Informe uma configuração válida.'; end if;
 if (p_config-array['decay_per_rp_day','sleep_duration_real_minutes','offline_floor','grace_rp_days','bath_cooldown_rp_hours','sleep_cooldown_rp_hours','social_daily_cap'])<>'{}'
   or ((p_config->'decay_per_rp_day')-array['hunger','thirst','hygiene','social','sleep'])<>'{}' then raise exception 'Há uma configuração de necessidade desconhecida.'; end if;
 foreach k in array array['hunger','thirst','hygiene','social','sleep'] loop
   v:=(p_config->'decay_per_rp_day'->>k)::numeric;
   if v is null or v::text in('NaN','Infinity','-Infinity') or v<0 or v>10 then raise exception 'O decaimento diário deve ficar entre zero e dez pontos RP.'; end if;
 end loop;
 foreach k in array array['sleep_duration_real_minutes','offline_floor','grace_rp_days','bath_cooldown_rp_hours','sleep_cooldown_rp_hours','social_daily_cap'] loop
   v:=(p_config->>k)::numeric;
   if v is null or v::text in('NaN','Infinity','-Infinity') or v<>trunc(v) or v<0 or v>100 then raise exception 'Use valores inteiros de zero a cem.'; end if;
 end loop;
 if (p_config->>'sleep_duration_real_minutes')::numeric not between 1 and 100 or (p_config->>'offline_floor')::numeric not between 0 and 20 or (p_config->>'grace_rp_days')::numeric<1
   or (p_config->>'bath_cooldown_rp_hours')::numeric<1 or (p_config->>'sleep_cooldown_rp_hours')::numeric<1 or (p_config->>'social_daily_cap')::numeric>20
 then raise exception 'Preserve a carência, o piso recuperável e os limites de descanso.'; end if;
 select value into old_cfg from public.system_settings where key='citizen_needs' for update;
 update public.system_settings set value=p_config where key='citizen_needs';
 perform economy_private.audit('citizen_needs_configured','system_settings','citizen_needs',old_cfg,p_config,'Configuração das necessidades do cidadão.',auth.uid());
 return p_config;
end; $$;


create or replace function private.finish_citizen_sleep()
returns integer language plpgsql security definer set search_path='' as $$
declare row public.citizen_needs%rowtype; total integer:=0;
begin
 for row in select * from public.citizen_needs where sleep_due_at<=clock_timestamp() for update skip locked loop
  perform private.refresh_citizen_needs(row.user_id);total:=total+1;
 end loop;
 return total;
end; $$;
alter function private.finish_citizen_sleep() owner to postgres;
revoke all on function private.finish_citizen_sleep() from public,anon,authenticated;
select cron.schedule('govrp-citizen-sleep-completion','* * * * *','select private.finish_citizen_sleep();');
commit;