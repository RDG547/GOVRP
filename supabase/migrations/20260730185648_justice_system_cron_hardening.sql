-- O processamento de prazos é interno e executado somente pelo pg_cron.
revoke execute on function public.close_completed_sentences()
from public, anon, authenticated;

revoke execute on function public.check_and_update_prisoner_status()
from public, anon, authenticated;
