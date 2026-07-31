alter policy "loan_applications_select_own_or_bank"
on public.loan_applications
using (
  user_id = (select auth.uid())
  or public.is_national_bank_manager()
);

alter policy "loan_applications_update_own_or_bank"
on public.loan_applications
using (
  user_id = (select auth.uid())
  or public.is_national_bank_manager()
)
with check (
  user_id = (select auth.uid())
  or public.is_national_bank_manager()
);

notify pgrst, 'reload schema';
