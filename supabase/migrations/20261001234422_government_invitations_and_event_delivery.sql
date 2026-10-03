begin;
-- All records in the modal channel must be replicated; RLS remains authoritative.
alter publication supabase_realtime add table public.election_settlements;
create table public.election_result_receipts (
 user_id uuid not null references public.profiles(id) on delete cascade,
 election_id uuid not null references public.elections(id) on delete cascade,
 acknowledged_at timestamptz not null default now(), primary key(user_id,election_id)
);
alter table public.election_result_receipts enable row level security;
revoke all on public.election_result_receipts from public,anon;
revoke insert,update,delete,truncate,references,trigger on public.election_result_receipts from authenticated;
grant select on public.election_result_receipts to authenticated;
create policy own_receipts on public.election_result_receipts for select to authenticated using(user_id=(select auth.uid()));
insert into public.election_result_receipts(user_id,election_id,acknowledged_at)
 select n.user_id,e.id,min((n.metadata->>'popup_shown_at')::timestamptz) from public.notifications n join public.elections e on e.id::text=n.metadata->>'election_id'
 where n.type='election_result_published' and n.metadata->>'popup_shown_at' is not null group by n.user_id,e.id on conflict do nothing;
create or replace function private.preserve_election_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare seen timestamptz;
begin
 if new.type='election_result_published' then
  select acknowledged_at into seen from public.election_result_receipts where user_id=new.user_id and election_id::text=new.metadata->>'election_id';
  if seen is not null then new.metadata:=coalesce(new.metadata,'{}')||jsonb_build_object('popup_shown_at',seen,'popup_pending',false);end if;
 end if;return new;
end $$;
revoke all on function private.preserve_election_receipt() from public,anon,authenticated;
create trigger preserve_election_receipt before insert or update on public.notifications for each row execute function private.preserve_election_receipt();
create or replace function public.acknowledge_role_change(p_notification_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare n public.notifications%rowtype; ids uuid[]:=array[p_notification_id];
begin
 if auth.uid() is null then raise exception 'Entre na sua conta para confirmar a leitura.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:notification:'||auth.uid()::text));
 select * into n from public.notifications where id=p_notification_id and user_id=auth.uid() and type in('role_changed','office_awarded','election_candidacy_open','election_voting_open','election_result_published','institutional_result');
 if n.id is null then return false;end if;
 if n.type='election_result_published' then
  select array_agg(distinct id) into ids from (
   select p_notification_id as id union all select value::uuid from jsonb_array_elements_text(public.get_election_result_bundle(p_notification_id)->'notification_ids')
  )x;
  insert into public.election_result_receipts(user_id,election_id)
   select auth.uid(),e.id from public.notifications no join public.elections e on e.id::text=no.metadata->>'election_id'
    where no.id=any(ids) and no.user_id=auth.uid() on conflict do nothing;
 end if;
 update public.notifications set metadata=coalesce(metadata,'{}')||jsonb_build_object('popup_shown_at',coalesce(metadata->>'popup_shown_at',clock_timestamp()::text),'popup_pending',false),is_read=true
 where id=any(ids) and user_id=auth.uid();
 return true;
end $$;

-- Late or concurrent notification delivery must never reopen an acknowledged election.
create or replace function public.get_pending_office_notification() returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(pending) from (
  select n.id,n.content,n.link,n.created_at,n.type,n.metadata from public.notifications n
  where n.user_id=(select auth.uid()) and n.type in('role_changed','election_candidacy_open','election_voting_open','election_result_published','institutional_result')
   and n.metadata->>'popup_shown_at' is null
   and not (n.type='election_result_published' and exists(select 1 from public.election_result_receipts r where r.user_id=n.user_id and r.election_id::text=n.metadata->>'election_id'))
  order by n.created_at,n.id limit 1
 ) pending;
$$;
revoke all on function public.get_pending_office_notification() from public,anon;
grant execute on function public.get_pending_office_notification() to authenticated;

create table public.minister_invitations (
 id uuid primary key default gen_random_uuid(), government_id uuid not null references public.government_terms(id),
 ministry_id uuid not null references public.government_ministries(id), candidate_id uuid not null references public.profiles(id),
 invited_by uuid not null references public.profiles(id), status text not null default 'pending' check(status in('pending','accepted','declined','expired','cancelled')),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
 responded_at timestamptz, previous_role text, check(expires_at>created_at)
);
create unique index one_pending_ministry_invitation on public.minister_invitations(government_id,ministry_id) where status='pending';
create unique index one_pending_candidate_invitation on public.minister_invitations(candidate_id) where status='pending';
alter table public.minister_invitations enable row level security;
revoke all on public.minister_invitations from public,anon;
revoke insert,update,delete,truncate,references,trigger on public.minister_invitations from authenticated;
grant select on public.minister_invitations to authenticated;
create policy invitation_participants on public.minister_invitations for select to authenticated using(candidate_id=(select auth.uid()) or invited_by=(select auth.uid()) or exists(select 1 from public.government_terms g where g.id=government_id and g.head_id=(select auth.uid())) or public.is_admin(auth.uid()));
alter publication supabase_realtime add table public.minister_invitations;
-- Appointment writes now occur only through validated server actions, including legacy RPC callers.
drop policy if exists "President can manage ministers" on public.ministers;
revoke insert,update,delete on public.ministers from authenticated;
alter table public.ministers add column previous_role text not null default 'Cidadão';

create or replace function private.notify_minister_invitation() returns trigger language plpgsql security definer set search_path='' as $$
declare ministry text; candidate text; president text; head uuid;
begin
 select name into ministry from public.government_ministries where id=new.ministry_id;
 select full_name into candidate from public.profiles where id=new.candidate_id;
 select full_name into president from public.profiles where id=new.invited_by;
 select head_id into head from public.government_terms where id=new.government_id and ended_at is null;
 if tg_op='INSERT' then
  insert into public.notifications(user_id,sender_id,type,content,link,metadata) values(new.candidate_id,new.invited_by,'minister_invitation',
   'O Presidente '||president||' convidou você para assumir o '||ministry||'.','/dashboard',jsonb_build_object('invitation_id',new.id,'expires_at',new.expires_at));
 elsif new.status is distinct from old.status then
  if head is not null then
   insert into public.notifications(user_id,sender_id,type,content,link,metadata) values(head,auth.uid(),'minister_invitation_response',
    case new.status when 'accepted' then candidate||' aceitou o convite para o '||ministry||'.' when 'declined' then candidate||' recusou o convite para o '||ministry||'.' when 'expired' then 'O convite para '||candidate||' assumir o '||ministry||' expirou.' else 'O convite para o '||ministry||' foi cancelado.' end,
    '/dashboard/president',jsonb_build_object('invitation_id',new.id,'status',new.status));
  end if;
  if new.status in('declined','expired','cancelled') then
   update public.presidential_formation set completed_at=null,status='in_progress' where government_id=new.government_id and ended_at is null;
  end if;
 end if;
 perform economy_private.audit('minister_invitation_'||new.status,'minister_invitation',new.id::text,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),'Fluxo de convite ministerial.',auth.uid());
 return new;
end $$;
revoke all on function private.notify_minister_invitation() from public,anon,authenticated;
create trigger minister_invitation_event after insert or update of status on public.minister_invitations for each row execute function private.notify_minister_invitation();

create or replace function private.maintain_minister_invitations() returns void language plpgsql security definer set search_path='' as $$
begin
 update public.minister_invitations i set status=case when expires_at<=clock_timestamp() then 'expired' else 'cancelled' end,responded_at=clock_timestamp()
 where status='pending' and (expires_at<=clock_timestamp() or not exists(select 1 from public.government_terms g where g.id=i.government_id and g.ended_at is null and g.term_ends_at>clock_timestamp() and g.head_id=i.invited_by and public.get_user_role(g.head_id)='Presidente'));
end $$;
revoke all on function private.maintain_minister_invitations() from public,anon,authenticated;

create or replace function public.appoint_minister(p_user_id uuid,p_ministry text) returns json language plpgsql security definer set search_path='' as $$
declare g public.government_terms%rowtype; m public.government_ministries%rowtype; invitation public.minister_invitations%rowtype;
begin
 if auth.uid() is null or public.get_user_role(auth.uid()) is distinct from 'Presidente' then raise exception 'Somente o Presidente em exercício pode convidar ministros.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 perform private.maintain_minister_invitations();
 select * into g from public.government_terms where ended_at is null and term_ends_at>clock_timestamp() and head_id=auth.uid() for update;
 if g.id is null then raise exception 'Não há Governo vigente para este convite.';end if;
 select * into m from public.government_ministries where name=p_ministry and is_active for update;
 if m.id is null then raise exception 'Selecione um Ministério ativo.';end if;
 select * into invitation from public.minister_invitations where government_id=g.id and ministry_id=m.id and status='pending';
 if invitation.candidate_id=p_user_id then return json_build_object('success',true,'invitation',to_jsonb(invitation),'message','Este convite já está aguardando resposta.');end if;
 if not private.is_executive_candidate(p_user_id,'minister') then raise exception 'Este cidadão não está elegível para integrar o gabinete.';end if;
 if exists(select 1 from public.minister_invitations where candidate_id=p_user_id and status='pending') then raise exception 'Este cidadão já possui um convite pendente.';end if;
 update public.minister_invitations set status='cancelled',responded_at=clock_timestamp() where id=invitation.id;
 insert into public.minister_invitations(government_id,ministry_id,candidate_id,invited_by) values(g.id,m.id,p_user_id,auth.uid()) returning * into invitation;
 return json_build_object('success',true,'invitation',to_jsonb(invitation),'message','Convite enviado. O cargo será atribuído somente após o aceite.');
end $$;

create or replace function public.respond_minister_invitation(p_invitation_id uuid,p_accept boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.minister_invitations%rowtype; m public.government_ministries%rowtype; previous public.ministers%rowtype; target public.profiles%rowtype;
begin
 if auth.uid() is null or p_accept is null then raise exception 'Entre na sua conta para responder ao convite.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 select * into i from public.minister_invitations where id=p_invitation_id and candidate_id=auth.uid() for update;
 if i.id is null then raise exception 'Este convite não pertence à sua conta.' using errcode='42501';end if;
 if i.status<>'pending' then return jsonb_build_object('status',i.status,'success',i.status in('accepted','declined'),'message','Este convite já foi respondido ou encerrado.');end if;
 perform private.maintain_minister_invitations();
 select * into i from public.minister_invitations where id=p_invitation_id;
 if i.status<>'pending' then return jsonb_build_object('status',i.status,'success',false,'message','O convite expirou ou o Governo responsável foi encerrado.');end if;
 if not p_accept then update public.minister_invitations set status='declined',responded_at=clock_timestamp() where id=i.id;return jsonb_build_object('success',true,'status','declined','message','Convite recusado.');end if;
 select * into target from public.profiles where id=auth.uid() for update;
 if not private.is_executive_candidate(auth.uid(),'minister') then raise exception 'Sua situação institucional mudou. Você não pode assumir este Ministério.';end if;
 select * into m from public.government_ministries where id=i.ministry_id and is_active for update;
 if m.id is null then raise exception 'Este Ministério não está mais ativo.';end if;
 select * into previous from public.ministers where ministry_id=m.id and status='active' for update;
 if previous.id is not null then
  update public.ministers set status='dismissed',ended_at=clock_timestamp() where id=previous.id;
  update public.profiles set role=previous.previous_role,manual_role_override=false,titles=array_remove(coalesce(titles,'{}'),'Ministro'),role_assigned_at=clock_timestamp() where id=previous.user_id and role='Ministro';
  insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id) values(previous.user_id,m.id,'dismissed','Substituição após aceite do sucessor.',i.invited_by);
 end if;
 insert into public.ministers(user_id,ministry,ministry_id,appointed_by,status,appointed_at,ended_at,government_id,previous_role)
 values(target.id,m.name,m.id,i.invited_by,'active',clock_timestamp(),null,i.government_id,target.role)
 on conflict(user_id) do update set ministry=excluded.ministry,ministry_id=excluded.ministry_id,appointed_by=excluded.appointed_by,status='active',appointed_at=excluded.appointed_at,ended_at=null,government_id=excluded.government_id,previous_role=excluded.previous_role;
 perform set_config('govrp.role_change_reason','Aceite de convite para o '||m.name,true);
 update public.profiles set role='Ministro',manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=i.invited_by where id=target.id;
 insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id,metadata) values(target.id,m.id,'appointed','Nomeação efetiva após aceite do convite.',target.id,jsonb_build_object('invitation_id',i.id,'government_id',i.government_id,'previous_role',target.role));
 update public.minister_invitations set status='accepted',responded_at=clock_timestamp(),previous_role=target.role where id=i.id;
 insert into public.dou_entries(title,summary,content,type,source_id,legal_metadata) values('Nomeação: '||m.name,target.full_name||' aceitou integrar o Governo.',target.full_name||' assumiu o '||m.name||' após aceitar o convite presidencial.','Nomeacao e Exoneracao',i.id,jsonb_build_object('government_id',i.government_id,'invitation_id',i.id));
 return jsonb_build_object('success',true,'status','accepted','message','Convite aceito. Você assumiu o Ministério.');
end $$;
revoke all on function public.respond_minister_invitation(uuid,boolean) from public,anon;
grant execute on function public.respond_minister_invitation(uuid,boolean) to authenticated;
create or replace function public.cancel_minister_invitation(p_invitation_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.minister_invitations i join public.government_terms g on g.id=i.government_id where i.id=p_invitation_id and g.head_id=auth.uid() and g.ended_at is null and public.get_user_role(auth.uid())='Presidente') then raise exception 'Somente a Presidência responsável pode cancelar este convite.' using errcode='42501';end if;
 update public.minister_invitations set status='cancelled',responded_at=clock_timestamp() where id=p_invitation_id and status='pending';
end $$;
revoke all on function public.cancel_minister_invitation(uuid) from public,anon;
grant execute on function public.cancel_minister_invitation(uuid) to authenticated;

-- Evaluate the final government state after succession, preserving a valid successor's cabinet.
create or replace function private.enforce_government_cabinet() returns trigger language plpgsql security definer set search_path='' as $$
declare g record;
begin
 for g in select distinct m.government_id from public.ministers m where m.status='active' and not exists(
  select 1 from public.government_terms t where t.id=m.government_id and t.ended_at is null and t.term_ends_at>clock_timestamp() and t.head_id is not null and public.get_user_role(t.head_id)='Presidente'
 ) loop perform private.end_government_cabinet(g.government_id,'Encerramento ministerial: não há Presidência em exercício neste Governo.');end loop;
 perform private.maintain_minister_invitations();return null;
end $$;
revoke all on function private.enforce_government_cabinet() from public,anon,authenticated;
create constraint trigger government_cabinet_integrity after insert or update on public.government_terms deferrable initially deferred for each row execute function private.enforce_government_cabinet();
create constraint trigger minister_government_integrity after insert or update on public.ministers deferrable initially deferred for each row execute function private.enforce_government_cabinet();
select cron.schedule('govrp-minister-invitations','* * * * *','select private.maintain_minister_invitations()');

CREATE OR REPLACE FUNCTION public.get_election_result_bundle(p_notification_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.notifications%rowtype;e public.elections%rowtype;sections jsonb;ids jsonb;
begin
 select * into n from public.notifications where id=p_notification_id and user_id=auth.uid() and type='election_result_published';
 if n.id is null then raise exception 'Resultado não disponível para esta conta.' using errcode='42501';end if;
 select * into e from public.elections where id::text=n.metadata->>'election_id';
 select coalesce(jsonb_agg(jsonb_build_object('id',el.id,'name',el.name,'office',coalesce(st.office_role,t.name),'status',st.status,
  'winners',coalesce((select jsonb_agg(coalesce(case when w->>'office_role'='Vice-Presidente' then c.vice_identity_snapshot else c.identity_snapshot end,'{}')||jsonb_build_object('ticket_id',c.id,'office_role',w->>'office_role','votes',w->'votes','percentage',case when st.total_valid_votes>0 then round((w->>'votes')::numeric/st.total_valid_votes*100,2) else 0 end,'electoral_number',c.electoral_number)) from jsonb_array_elements(st.result) w join public.candidates c on c.id=(w->>'candidate_id')::uuid),'[]'::jsonb)) order by case when coalesce(st.office_role,t.name)='Presidente' then 0 when coalesce(st.office_role,t.name)='Senador' then 1 else 2 end),'[]'::jsonb) into sections
 from public.elections el join public.election_types t on t.id=el.election_type_id left join public.election_settlements st on st.election_id=el.id
 where (el.id=e.id or (st.election_id is not null and el.voting_start_date=e.voting_start_date and el.voting_end_date=e.voting_end_date and el.extraordinary=e.extraordinary));
 select coalesce(jsonb_agg(no.id),'[]'::jsonb) into ids from public.notifications no where no.user_id=auth.uid() and no.type='election_result_published' and (no.id=n.id or no.metadata->>'election_id'=n.metadata->>'election_id' or no.metadata->>'election_id' in(select s->>'id' from jsonb_array_elements(sections)s));
 return jsonb_build_object('sections',sections,'notification_ids',ids);
end $function$;
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
 select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('appointment',cfg->'specialAppointments'->o.office_key) order by sort_order),'[]') into offices from public.executive_office_definitions o where required_for_formation;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'holder_id',a.user_id,'invitation',(select to_jsonb(i) from public.minister_invitations i where i.government_id=f.government_id and i.ministry_id=m.id order by created_at desc limit 1)) order by m.name),'[]') into ministries
 from public.government_ministries m left join lateral (select user_id from public.ministers where ministry_id=m.id and status='active' order by appointed_at desc limit 1) a on true where m.is_active;
 select count(*) into remaining from jsonb_array_elements(offices) o where o->'appointment'->>'user_id' is null;
 remaining:=remaining+(select count(*) from jsonb_array_elements(ministries) m where m->>'holder_id' is null);
 if f.status='pending' then update public.presidential_formation set status='in_progress' where id=f.id returning * into f; end if;
 return to_jsonb(f)||jsonb_build_object('offices',offices,'ministries',ministries,'remaining',remaining,'awaiting',(select count(*) from public.minister_invitations where government_id=f.government_id and status='pending' and expires_at>clock_timestamp()),'revision',(select max(coalesce(responded_at,created_at)) from public.minister_invitations where government_id=f.government_id),'government',(select to_jsonb(g) from public.government_terms g where g.ended_at is null and g.head_id=auth.uid()));
end; $function$;
CREATE OR REPLACE FUNCTION private.end_government_cabinet(p_government_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.ministers%rowtype;
BEGIN
 FOR m IN SELECT * FROM public.ministers WHERE status='active' AND (government_id=p_government_id OR (government_id IS NULL AND p_government_id IS NULL)) FOR UPDATE LOOP
  UPDATE public.ministers SET status='dismissed',ended_at=clock_timestamp() WHERE id=m.id;
  UPDATE public.profiles SET role=case when m.previous_role in('Policial','Militar','Agente Secreto') then m.previous_role else 'Cidadão' end,manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),
   titles=array_remove(coalesce(titles,'{}'),'Ministro') WHERE id=m.user_id AND role='Ministro';
  INSERT INTO public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id,metadata)
  VALUES(m.user_id,m.ministry_id,'dismissed',p_reason,auth.uid(),jsonb_build_object('government_id',m.government_id,'appointment',to_jsonb(m)));
  INSERT INTO public.dou_entries(title,summary,content,type,source_id,legal_metadata)
  VALUES('Encerramento ministerial: '||m.ministry,p_reason,p_reason,'Nomeacao e Exoneracao',gen_random_uuid(),jsonb_build_object('government_id',m.government_id,'minister_id',m.user_id));
 END LOOP;
END; $function$;
CREATE OR REPLACE FUNCTION private.rp_reset_policy()
 RETURNS TABLE(table_name text, reset_mode text, owner_columns text[])
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  values
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
$function$;

do $$ declare g record; begin for g in select distinct government_id from public.ministers m where status='active' and not exists(select 1 from public.government_terms t where t.id=m.government_id and t.ended_at is null and t.term_ends_at>clock_timestamp() and t.head_id is not null and public.get_user_role(t.head_id)='Presidente') loop perform private.end_government_cabinet(g.government_id,'Regularização de gabinete sem Presidência em exercício.');end loop;end $$;
notify pgrst,'reload schema';
commit;
