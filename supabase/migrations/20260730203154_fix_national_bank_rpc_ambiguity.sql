begin;

-- A chamada sem parâmetros era compatível com duas assinaturas porque a
-- versão UUID também possuía auth.uid() como valor padrão. O PostgreSQL não
-- permite remover esse default via CREATE OR REPLACE, então a implementação
-- é preservada com um nome interno e a assinatura pública é recriada sem
-- valor padrão, dentro da mesma transação.
alter function public.is_national_bank_manager(uuid)
rename to is_national_bank_manager_legacy;

create function public.is_national_bank_manager(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_national_bank_manager_legacy(p_user_id);
$$;

create or replace function public.is_national_bank_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_national_bank_manager((select auth.uid()));
$$;

revoke all on function public.is_national_bank_manager() from public, anon;
revoke all on function public.is_national_bank_manager(uuid) from public, anon;
revoke all on function public.is_national_bank_manager_legacy(uuid)
from public, anon, authenticated;
grant execute on function public.is_national_bank_manager()
to authenticated, service_role;
grant execute on function public.is_national_bank_manager(uuid)
to authenticated, service_role;
grant execute on function public.is_national_bank_manager_legacy(uuid)
to service_role;

notify pgrst, 'reload schema';

commit;
