begin;
-- Restore the technical Admin branch of existing authorization policies.
-- Separate authenticated policies preserve anonymous reads and existing grants.
-- No blanket table access or canonical RP role changes are introduced.
do $migration$
declare p record; policy_id text; command text;
begin
 for p in select * from pg_policies where schemaname in ('public','storage')
 and (coalesce(qual,'')||coalesce(with_check,'')) like '%''Admin''%'
 and (coalesce(qual,'')||coalesce(with_check,'')) ~ '(get_user_role|profiles|[.]role)'
 and (coalesce(qual,'')||coalesce(with_check,'')) not like '%is_admin(%'
 loop
  policy_id:='technical_admin_'||md5(p.schemaname||'.'||p.tablename||'.'||p.policyname);
  execute format('drop policy if exists %I on %I.%I',policy_id,p.schemaname,p.tablename);
  command:=format('create policy %I on %I.%I for %s to authenticated',policy_id,p.schemaname,p.tablename,p.cmd);
  if p.cmd<>'INSERT' then command:=command||' using ((select public.is_admin()))';end if;
  if p.cmd in ('ALL','UPDATE','INSERT') then command:=command||' with check ((select public.is_admin()))';end if;
  execute command;
 end loop;
end $migration$;

-- Administrative execution delegates to the current government; it never
-- appoints the administrator President or changes the actual head of state.
create or replace function public.has_full_admin_access() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.is_admin() and exists(
  select 1 from private.admin_development_modes where user_id=auth.uid() and mode='total');
$$;
revoke all on function public.has_full_admin_access() from public,anon;
grant execute on function public.has_full_admin_access() to authenticated;
CREATE OR REPLACE FUNCTION public.cancel_minister_invitation(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.minister_invitations i join public.government_terms g on g.id=i.government_id where i.id=p_invitation_id and g.ended_at is null and ((g.head_id=auth.uid() and public.get_user_role(auth.uid())='Presidente') or public.has_full_admin_access())) then raise exception 'Somente a Presidência responsável pode cancelar este convite.' using errcode='42501';end if;
 update public.minister_invitations set status='cancelled',responded_at=clock_timestamp() where id=p_invitation_id and status='pending';
end $function$
;
CREATE OR REPLACE FUNCTION public.appoint_minister(p_user_id uuid, p_ministry text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.government_terms%rowtype; m public.government_ministries%rowtype; invitation public.minister_invitations%rowtype;
begin
 if auth.uid() is null or (public.get_user_role(auth.uid()) is distinct from 'Presidente' and not public.has_full_admin_access()) then raise exception 'Somente o Presidente em exercício pode convidar ministros.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 perform private.maintain_minister_invitations();
 select * into g from public.government_terms where ended_at is null and term_ends_at>clock_timestamp() and (head_id=auth.uid() or public.has_full_admin_access()) order by term_starts_at desc limit 1 for update;
 if g.id is null then raise exception 'Não há Governo vigente para este convite.';end if;
 select * into m from public.government_ministries where name=p_ministry and is_active for update;
 if m.id is null then raise exception 'Selecione um Ministério ativo.';end if;
 select * into invitation from public.minister_invitations where government_id=g.id and ministry_id=m.id and status='pending';
 if invitation.candidate_id=p_user_id then return json_build_object('success',true,'invitation',to_jsonb(invitation),'message','Este convite já está aguardando resposta.');end if;
 if not private.is_executive_candidate(p_user_id,'minister') then raise exception 'Este cidadão não está elegível para integrar o gabinete.';end if;
 if exists(select 1 from public.minister_invitations where candidate_id=p_user_id and status='pending') then raise exception 'Este cidadão já possui um convite pendente.';end if;
 update public.minister_invitations set status='cancelled',responded_at=clock_timestamp() where id=invitation.id;
 insert into public.minister_invitations(government_id,ministry_id,candidate_id,invited_by) values(g.id,m.id,p_user_id,g.head_id) returning * into invitation;
 return json_build_object('success',true,'invitation',to_jsonb(invitation),'message','Convite enviado. O cargo será atribuído somente após o aceite.');
end $function$
;
CREATE OR REPLACE FUNCTION public.choose_government_cabinet(p_choice text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g public.government_terms%rowtype;
BEGIN
 IF auth.uid() IS NULL OR (coalesce(public.get_user_role(auth.uid()),'')<>'Presidente' and not public.has_full_admin_access()) THEN RAISE EXCEPTION 'Somente a chefia do Governo pode escolher a equipe.' USING errcode='42501'; END IF;
 IF p_choice NOT IN ('keep','reform') OR p_choice IS NULL THEN RAISE EXCEPTION 'Escolha manter a equipe ou formar uma nova.'; END IF;
 SELECT * INTO g FROM public.government_terms WHERE ended_at IS NULL AND (head_id=auth.uid() OR public.has_full_admin_access()) ORDER BY term_starts_at DESC LIMIT 1 FOR UPDATE;
 IF g.id IS NULL THEN RAISE EXCEPTION 'Não há Governo ativo sob sua chefia.'; END IF;
 IF g.cabinet_decision<>'pending' THEN RETURN to_jsonb(g); END IF;
 IF p_choice='reform' THEN PERFORM private.end_government_cabinet(g.id,'Reforma ministerial decidida pela nova chefia do Governo.');
 ELSE
  INSERT INTO public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id,metadata)
  SELECT user_id,ministry_id,'retained','Equipe mantida após sucessão presidencial.',auth.uid(),jsonb_build_object('government_id',g.id,'head_id',g.head_id)
  FROM public.ministers WHERE government_id=g.id AND status='active';
  UPDATE public.presidential_formation SET status='completed',completed_at=clock_timestamp() WHERE government_id=g.id AND user_id=g.head_id AND ended_at IS NULL;
 END IF;
 UPDATE public.government_terms SET cabinet_decision=CASE WHEN p_choice='keep' THEN 'kept' ELSE 'reformed' END WHERE id=g.id RETURNING * INTO g;
 PERFORM public.justice_write_audit('executive.cabinet_choice','government',g.id,NULL,to_jsonb(g),'Escolha ministerial após sucessão.');
 RETURN to_jsonb(g);
END; $function$
;


-- A preview may read the citizen snapshot but must not advance gameplay clocks.
create or replace function public.get_citizen_needs() returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.citizen_needs%rowtype; age_rp integer;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501';end if;
 if public.is_admin() and exists(select 1 from private.admin_development_modes where user_id=auth.uid() and mode<>'normal' and not execute_real) then
  select * into n from public.citizen_needs where user_id=auth.uid();
 else n:=private.refresh_citizen_needs(auth.uid());end if;
 if n.user_id is null then return null;end if;
 select extract(year from age(public.rp_now(),date_of_birth))::integer into age_rp from public.profiles where id=auth.uid();
 return to_jsonb(n)||jsonb_build_object('age_rp',greatest(0,age_rp),'rp_now',public.rp_now(),'server_now',clock_timestamp());
end;$$;
notify pgrst,'reload schema';
commit;
