-- Remove as dependências restantes da função bancária legada.
--
-- A normalização anterior eliminou a ambiguidade das assinaturas públicas,
-- mas as políticas de cartões e configurações bancárias continuaram chamando
-- diretamente a implementação legada, cuja execução é corretamente vedada
-- ao papel authenticated. Todas as autorizações passam agora pela função
-- canônica sem parâmetros, que resolve o usuário pela sessão autenticada.

create or replace function public.is_national_bank_manager(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null
    and (
      exists (
        select 1
        from public.profiles as profile
        where profile.id = p_user_id
          and profile.role in (
            'Admin',
            'Presidente',
            'Presidente do Banco Nacional'
          )
      )
      or exists (
        select 1
        from public.system_settings as setting
        where setting.key = 'executive_governance'
          and setting.value
            -> 'specialAppointments'
            -> 'national_bank_president'
            ->> 'user_id' = p_user_id::text
      )
    );
$function$;

revoke all on function public.is_national_bank_manager(uuid)
from public, anon;
grant execute on function public.is_national_bank_manager(uuid)
to authenticated, service_role;

alter policy "credit_card_applications_select_own_or_bank"
on public.credit_card_applications
using (
  user_id = (select auth.uid())
  or public.is_national_bank_manager()
);

alter policy "credit_card_applications_update_bank"
on public.credit_card_applications
using (public.is_national_bank_manager())
with check (public.is_national_bank_manager());

alter policy "bank_policy_manage_bank"
on public.system_settings
using (
  key = 'bank_policy'
  and public.is_national_bank_manager()
)
with check (
  key = 'bank_policy'
  and public.is_national_bank_manager()
);

alter policy "bank_policy_select_authenticated"
on public.system_settings
using (
  key = 'bank_policy'
  or public.is_national_bank_manager()
);

drop function public.is_national_bank_manager_legacy(uuid);

notify pgrst, 'reload schema';
