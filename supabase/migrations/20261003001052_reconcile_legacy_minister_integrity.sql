begin;
create or replace function private.reconcile_government_cabinet() returns void language plpgsql security definer set search_path='' as $$
declare g record; p public.profiles%rowtype; m public.ministers%rowtype;
begin
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 for g in select distinct minister.government_id from public.ministers minister where minister.status='active' and not exists(
  select 1 from public.government_terms t where t.id=minister.government_id and t.ended_at is null and t.term_ends_at>clock_timestamp() and t.head_id is not null and public.get_user_role(t.head_id)='Presidente'
 ) loop perform private.end_government_cabinet(g.government_id,'Encerramento ministerial: não há Presidência em exercício neste Governo.');end loop;
 -- Older dismissals left manually assigned profile roles behind. Preserve other current offices.
 if not exists(select 1 from public.government_terms t where t.ended_at is null and t.term_ends_at>clock_timestamp() and t.head_id is not null and public.get_user_role(t.head_id)='Presidente') then
  for p in select * from public.profiles where role='Ministro' and deleted_at is null for update loop
   select * into m from public.ministers where user_id=p.id order by appointed_at desc nulls last limit 1;
   update public.profiles set role=private.minister_return_role(m.previous_role),manual_role_override=false,
    role_assigned_at=clock_timestamp(),titles=array_remove(coalesce(titles,'{}'),'Ministro') where id=p.id and role='Ministro';
   perform economy_private.audit('minister_legacy_role_closed','profile',p.id::text,to_jsonb(p),jsonb_build_object('role',private.minister_return_role(m.previous_role)),'Correção de vínculo ministerial encerrado sem Governo vigente.',null);
   if m.id is not null then
    insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,metadata)
    values(p.id,m.ministry_id,'dismissed','Correção do cargo remanescente: não há Governo vigente.',jsonb_build_object('legacy_role_reconciled',true,'government_id',m.government_id));
   end if;
  end loop;
 end if;
 perform private.maintain_minister_invitations();
end $$;
revoke all on function private.reconcile_government_cabinet() from public,anon,authenticated;
create or replace function private.enforce_government_cabinet() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.reconcile_government_cabinet();return null;end $$;
create or replace function private.require_minister_appointment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role='Ministro' and (tg_op='INSERT' or old.role is distinct from new.role) and not exists(
  select 1 from public.ministers m join public.government_terms g on g.id=m.government_id
  where m.user_id=new.id and m.status='active' and g.ended_at is null and g.term_ends_at>clock_timestamp() and public.get_user_role(g.head_id)='Presidente'
 ) then raise exception 'O cargo de Ministro exige um Governo vigente e o aceite de um convite ministerial.' using errcode='42501';end if;
 return new;
end $$;
revoke all on function private.require_minister_appointment() from public,anon,authenticated;
create trigger require_minister_appointment before insert or update of role on public.profiles for each row execute function private.require_minister_appointment();
select cron.schedule('govrp-minister-invitations','* * * * *','select private.reconcile_government_cabinet()');
select private.reconcile_government_cabinet();
notify pgrst,'reload schema';
commit;
