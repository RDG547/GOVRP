begin;
insert into public.economic_state(id) values(true) on conflict do nothing;
create or replace function public.official_role_capabilities(p_role text)
returns text[] language sql immutable set search_path='' as $$
 select case public.canonical_official_role(p_role)
 when 'Diretor-Geral de Polícia' then array['Diretor-Geral de Polícia','Policial','Delegado']
 when 'Comandante-Geral das Forças Armadas' then array['Comandante-Geral das Forças Armadas','Militar']
 when 'Comandante da Agência de Inteligência' then array['Comandante da Agência de Inteligência','Agente Secreto']
 else array[public.canonical_official_role(p_role)] end;
$$;
create or replace function public.justice_has_role(p_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p cross join lateral unnest(array[p.role]||coalesce(p.titles,'{}')) r
 cross join lateral unnest(public.official_role_capabilities(r)) cap
 where p.id=(select auth.uid()) and p.deleted_at is null and lower(cap)=any(select lower(unnest(p_roles))));
$$;
alter policy "AGIES members can manage their missions" on "public"."agies_missions" using ((get_user_role(auth.uid()) = ANY (ARRAY['Agente Secreto'::text, 'Comandante da Agência de Inteligência'::text, 'Admin'::text])));
alter policy "Admins and Agents can view all AGIES missions" on "public"."agies_missions" using ((get_user_role(auth.uid()) = ANY (ARRAY['Agente Secreto'::text, 'Comandante da Agência de Inteligência'::text, 'Admin'::text])));
alter policy "armed_enlistment_read" on "public"."armed_forces_enlistment" using (((user_id = ( SELECT auth.uid() AS uid)) OR (get_user_role(( SELECT auth.uid() AS uid)) = ANY (ARRAY['Admin'::text, 'Forças Armadas'::text, 'Militar'::text, 'Comandante-Geral das Forças Armadas'::text, 'Comandante das Forças Armadas'::text]))));
alter policy "armed_reports_read" on "public"."armed_forces_reports" using (((reporter_id = ( SELECT auth.uid() AS uid)) OR (get_user_role(( SELECT auth.uid() AS uid)) = ANY (ARRAY['Admin'::text, 'Forças Armadas'::text, 'Militar'::text, 'Comandante-Geral das Forças Armadas'::text, 'Comandante das Forças Armadas'::text]))));

-- Role capabilities are derived from persisted official roles, never from client input.
alter function public.official_role_capabilities(text) owner to postgres;
alter function public.justice_has_role(text[]) owner to postgres;
revoke all on function public.official_role_capabilities(text),public.justice_has_role(text[]) from public,anon;
grant execute on function public.official_role_capabilities(text),public.justice_has_role(text[]) to authenticated,service_role;
update public.products set image_url='/images/housing/'||(residence_spec->>'type')||'.svg' where state_enterprise_id='f2000000-0000-4000-8000-000000000002' and image_url is null;
commit;
