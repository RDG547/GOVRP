-- A função check_and_update_prisoner_status() é chamada pelo frontend autenticado
-- (AuthContext e PenalSystemPanel) para encerrar penas já cumpridas. O snapshot remoto
-- só concedia EXECUTE ao service_role, causando 403 (42501) para usuários autenticados.
-- Como é SECURITY DEFINER e não recebe parâmetros, o grant para authenticated é seguro.

grant execute on function public.check_and_update_prisoner_status() to authenticated;
