begin;
-- Privatization revokes governmental edits even when clients bypass the management dialog.
alter policy state_enterprises_authority_update on public.state_enterprises using(public.is_admin(auth.uid()) or (not is_privatized and public.get_user_role(auth.uid())='Presidente'));
create or replace function private.guard_enterprise_operational_settings() returns trigger language plpgsql security definer set search_path='' as $$
declare entry record; e public.state_enterprises%rowtype; before_value jsonb;
begin
 if auth.uid() is null or public.is_admin(auth.uid()) then return new;end if;
 if new.key='stock_market_session' then raise exception 'A sessão da Bolsa exige administração institucional autorizada.' using errcode='42501';end if;
 if new.key not in('basic_service_prices','enterprise_costs') then return new;end if;
 before_value:=case when tg_op='UPDATE' then old.value else '{}'::jsonb end;
 for entry in select key from jsonb_each(coalesce(new.value,'{}')||coalesce(before_value,'{}')) loop
  if new.value->entry.key is not distinct from before_value->entry.key then continue;end if;
  if new.key='enterprise_costs' then select * into e from public.state_enterprises where id::text=entry.key;
  else select * into e from public.state_enterprises where sector=split_part(entry.key,'_',1) order by created_at limit 1;end if;
  if e.id is null or not coalesce(public.can_manage_state_enterprise(e.id),false) then raise exception 'Você não tem permissão para alterar as configurações desta empresa.' using errcode='42501';end if;
 end loop;
 return new;
end $$;
revoke all on function private.guard_enterprise_operational_settings() from public,anon,authenticated;
create trigger guard_enterprise_operational_settings before insert or update on public.system_settings for each row execute function private.guard_enterprise_operational_settings();
-- General corporate updates cannot bypass the dedicated housing/price RPC.
create or replace function private.guard_housing_management_settings() returns trigger language plpgsql set search_path='' as $$
begin
 if new.management_settings is distinct from old.management_settings and current_user not in('postgres','supabase_admin','service_role') then raise exception 'Use o gerenciamento autorizado da Imobiliária.' using errcode='42501';end if;
 return new;
end $$;
revoke all on function private.guard_housing_management_settings() from public,anon,authenticated;
create trigger guard_housing_management_settings before update on public.state_enterprises for each row execute function private.guard_housing_management_settings();
notify pgrst,'reload schema';
commit;
