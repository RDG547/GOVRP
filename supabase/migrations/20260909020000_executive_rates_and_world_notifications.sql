begin;

create or replace function economy_private.update_activity_mix()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_active_players integer;
  v_transactions integer;
  v_businesses integer;
  v_participation integer;
  v_score numeric;
  v_level text;
  v_target numeric;
  v_current numeric; v_override numeric;
  v_player numeric;
begin
  select count(distinct session.user_id)::integer into v_active_players
  from public.user_activity_sessions session
  where session.last_seen_at>=clock_timestamp()-interval '7 days';
  select count(*)::integer into v_transactions from public.transactions
  where created_at>=clock_timestamp()-interval '7 days';
  select count(*)::integer into v_businesses from public.businesses
  where status='active' and updated_at>=clock_timestamp()-interval '14 days';
  select coalesce(sum(total),0)::integer into v_participation from (
    select count(*) total from public.posts where created_at>=clock_timestamp()-interval '7 days'
    union all select count(*) from public.votes where voted_at>=clock_timestamp()-interval '7 days'
    union all select count(*) from public.bill_votes where voted_at>=clock_timestamp()-interval '7 days'
    union all select count(*) from public.criminal_cases where created_at>=clock_timestamp()-interval '7 days'
  ) activity;
  v_score:=coalesce(v_active_players,0)*3+least(coalesce(v_transactions,0),300)*.15
    +coalesce(v_businesses,0)*4+least(coalesce(v_participation,0),200)*.35;
  v_level:=case when v_score<15 then 'very_low' when v_score<40 then 'low'
    when v_score<90 then 'medium' when v_score<180 then 'high' else 'very_high' end;
  v_target:=case v_level when 'very_low' then .25 when 'low' then .35
    when 'medium' then .50 when 'high' then .60 else .75 end;
  select player_share,(metadata->'activity_mix_override'->>'player_share')::numeric into v_current,v_override from public.economic_state where id=true for update;
  v_current:=coalesce(v_current,.25);
  v_player:=coalesce(v_override,round(least(v_current+.08,greatest(v_current-.08,v_current*.75+v_target*.25)),6));

  update public.economic_state
  set player_activity_level=v_level,player_share=v_player,simulated_share=1-v_player,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'activity_score',round(v_score,4),'active_players',v_active_players,
        'recent_transactions',v_transactions,'active_businesses',v_businesses,
        'participation_actions',v_participation,'influence_model',case when v_override is null then 'dynamic_smoothed' else 'admin_configured' end,
        'target_player_share',v_target,'player_share',v_player,'simulated_share',1-v_player
      ),updated_at=clock_timestamp()
  where id=true;
  update public.country_rp_states
  set player_share=v_player,simulated_share=1-v_player,
      economic_current=economic_current||jsonb_build_object('playerShare',v_player,'simulatedShare',1-v_player),
      updated_at=clock_timestamp()
  where is_playable;
  update public.government_popularity_state
  set player_activity_weight=v_player,simulation_weight=1-v_player,updated_at=clock_timestamp()
  where country_code='BR';
  return jsonb_build_object('level',v_level,'score',round(v_score,4),
    'target_player_share',v_target,'player_share',v_player,'simulated_share',1-v_player);
end;
$$;

create or replace function public.configure_economic_mix(p_player_share numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_state jsonb; result jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='Admin') then raise exception 'Somente a administração pode configurar os pesos.' using errcode='42501'; end if;
  if p_player_share is null or p_player_share<0 or p_player_share>1 then raise exception 'Os pesos precisam somar 100%%.'; end if;
  select to_jsonb(s) into before_state from public.economic_state s where id for update;
  update public.economic_state set metadata=jsonb_set(coalesce(metadata,'{}'),'{activity_mix_override}',jsonb_build_object('player_share',p_player_share,'actor_id',auth.uid(),'updated_at',clock_timestamp())) where id;
  result:=economy_private.update_activity_mix();
  perform economy_private.audit('economic_mix_configured','economic_state','true',before_state,result,'Pesos de cidadãos e sociedade simulada configurados.',auth.uid());
  return result;
end; $$;

insert into public.legal_authority_rules(capability,legislative_allowed,decree_allowed,decree_max_value,description)
values('executive_rate_adjustment',true,true,1000000,'Executivo pode ajustar somente o valor de tributos e tarifas vigentes. Criação, extinção, escopo e demais efeitos seguem o processo legislativo.') on conflict do nothing;
create or replace function public.adjust_existing_levy(p_rule_key text,p_value numeric,p_expected_version bigint)
returns public.government_rules language plpgsql security definer set search_path='' as $$
declare r public.government_rules%rowtype; actor uuid:=auth.uid(); d uuid; e uuid; explanation text; max_value numeric; effect jsonb;
begin
  if not exists(select 1 from public.profiles where id=actor and role in('Admin','Presidente')) then raise exception 'Somente o Presidente pode ajustar tributos vigentes.' using errcode='42501'; end if;
  perform public.process_due_legal_effects();
  select * into r from public.government_rules where rule_key=p_rule_key for update;
  if not found or r.rule_kind not in('tax','fee') or not r.is_active or r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp() then raise exception 'Selecione um imposto ou tarifa vigente. Criar ou extinguir exige o processo legislativo.'; end if;
  if p_expected_version is null or r.version<>p_expected_version then raise exception 'O valor foi atualizado por outra medida. Confira a nova alíquota antes de salvar.'; end if;
  select decree_max_value into max_value from public.legal_authority_rules where capability='executive_rate_adjustment' and decree_allowed;
  if max_value is null then raise exception 'O regime vigente não permite ajuste executivo de alíquotas.'; end if;
  if r.definition->>'nature'='percentage' then max_value:=1; end if;
  if p_value is null or p_value<0 or p_value>max_value then raise exception 'Informe um valor dentro dos limites permitidos.'; end if;
  if r.numeric_value=p_value then return r; end if;
  explanation:=r.description||': '||r.numeric_value||' → '||p_value||'. Ajuste executivo de valor, preservados escopo e vigência da norma.';
  insert into public.decrees(title,content,author_id,is_published) values('Ajuste de '||r.description,explanation,actor,false) returning id into d;
  effect:=jsonb_build_object('kind',r.rule_kind,'action','change','rule_key',r.rule_key,'name',r.description,'value',p_value,'definition',r.definition,'executive_rate_adjustment',true);
  -- This authorized operation cannot change any structural field, create or revoke a rule.
  insert into public.law_effects(source_kind,source_id,effect_key,operation,effect_value,explanation,status,configured_by,activated_at,effect_data,valid_from,valid_until,previous_snapshot)
  values('decree',d,r.rule_key,'set',p_value,explanation,'active',actor,clock_timestamp(),effect,clock_timestamp(),r.valid_until,to_jsonb(r)) returning id into e;
  update public.government_rules set numeric_value=p_value,source_kind='decree',source_id=d,active_effect_id=e,version=version+1,updated_at=clock_timestamp() where rule_key=r.rule_key;
  update public.decrees set is_published=true,published_at=clock_timestamp() where id=d;
  perform economy_private.audit('executive_levy_adjusted','government_rules',r.rule_key,to_jsonb(r),effect,explanation,actor);
  insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
  values('legal_effect_activated','government','law_effects',e,actor,effect,'legal-effect:'||e);
  select * into r from public.government_rules where rule_key=p_rule_key;
  return r;
end; $$;

create or replace function private.notify_party_activated()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not new.is_active or (tg_op='UPDATE' and old.is_active) then return new; end if;
  insert into public.notifications(user_id,type,content,link,metadata)
  select distinct id,'party_approved','O '||new.name||' ('||new.acronym||') foi aprovado e está oficialmente ativo no GOVRP.',
    '/services/political-parties/'||new.id,jsonb_build_object('party_id',new.id,'party_name',new.name,'acronym',new.acronym)
  from unnest(array[new.owner_id,new.president_id,new.vice_president_id]) ids(id) where id is not null;
  return new;
end; $$;
create trigger party_activation_notification after insert or update of is_active on public.political_parties for each row execute function private.notify_party_activated();
create or replace function public.acknowledge_party_welcome(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
  update public.notifications set metadata=jsonb_set(coalesce(metadata,'{}'),'{celebration_seen_at}',to_jsonb(clock_timestamp())),is_read=true
  where id=p_notification_id and user_id=auth.uid() and type in('party_membership_confirmed','party_approved') and metadata->>'celebration_seen_at' is null;
  return found;
end; $$;

create or replace function private.notify_invoice_closed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='open' and new.status in('closed','overdue') then
    insert into public.notifications(user_id,type,content,link,metadata)
    values(new.user_id,'bank_invoice_closed','Sua fatura fechou em R$ '||replace(to_char(new.amount,'FM999999990D00'),'.',',')||'. Vencimento: '||to_char(new.due_date,'DD/MM/YYYY')||'.','/services/bank',jsonb_build_object('invoice_id',new.id,'amount',new.amount,'due_date',new.due_date));
  end if;
  return new;
end; $$;
create trigger invoice_closed_notification after update of status on public.card_invoices for each row execute function private.notify_invoice_closed();

alter function economy_private.update_activity_mix() owner to postgres;
alter function public.configure_economic_mix(numeric) owner to postgres;
alter function public.adjust_existing_levy(text,numeric,bigint) owner to postgres;
alter function private.notify_party_activated() owner to postgres;
alter function public.acknowledge_party_welcome(uuid) owner to postgres;
alter function private.notify_invoice_closed() owner to postgres;
revoke all on function public.configure_economic_mix(numeric),public.adjust_existing_levy(text,numeric,bigint) from public,anon;
grant execute on function public.configure_economic_mix(numeric),public.adjust_existing_levy(text,numeric,bigint) to authenticated,service_role;
revoke all on function private.notify_party_activated(),private.notify_invoice_closed() from public,anon,authenticated;
commit;
