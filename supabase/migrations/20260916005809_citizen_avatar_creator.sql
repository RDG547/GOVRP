begin;
alter table public.profiles add column if not exists avatar_config jsonb;
create or replace function private.validate_citizen_avatar(p_config jsonb) returns void language plpgsql set search_path='' as $$
begin
  if p_config is null then return; end if;
  if jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>2048 then raise exception 'Configuração de avatar inválida.'; end if;
    if not coalesce(p_config->>'hair' = any(array['short','long','curly','side','bald']),false) then raise exception 'Configuração de avatar inválida: Cabelo.'; end if;
    if not coalesce(p_config->>'hairColor' = any(array['#211c19','#603c28','#d9ae60','#a64c2b','#c5c5c5','#6b4f9d']),false) then raise exception 'Configuração de avatar inválida: Cor do cabelo.'; end if;
    if not coalesce(p_config->>'skin' = any(array['#f8dcc2','#e8bb96','#c88c61','#a76d49','#754a34','#4b3027']),false) then raise exception 'Configuração de avatar inválida: Pele.'; end if;
    if not coalesce(p_config->>'brows' = any(array['soft','straight','arched']),false) then raise exception 'Configuração de avatar inválida: Sobrancelha.'; end if;
    if not coalesce(p_config->>'eyes' = any(array['round','almond','narrow']),false) then raise exception 'Configuração de avatar inválida: Olhos.'; end if;
    if not coalesce(p_config->>'eyeColor' = any(array['#493126','#20262b','#56889c','#6a885b','#a99a61']),false) then raise exception 'Configuração de avatar inválida: Cor dos olhos.'; end if;
    if not coalesce(p_config->>'nose' = any(array['small','wide','straight']),false) then raise exception 'Configuração de avatar inválida: Nariz.'; end if;
    if not coalesce(p_config->>'mouth' = any(array['smile','calm','full']),false) then raise exception 'Configuração de avatar inválida: Boca.'; end if;
    if not coalesce(p_config->>'beard' = any(array['none','stubble','full','goatee']),false) then raise exception 'Configuração de avatar inválida: Barba.'; end if;
    if not coalesce(p_config->>'makeup' = any(array['none','soft','bold']),false) then raise exception 'Configuração de avatar inválida: Maquiagem.'; end if;
  if exists(select 1 from jsonb_object_keys(p_config) k where k <> all(array['hair','hairColor','skin','brows','eyes','eyeColor','nose','mouth','beard','makeup'])) then raise exception 'Configuração de avatar inválida.'; end if;
end; $$;
revoke all on function private.validate_citizen_avatar(jsonb) from public,anon,authenticated;
create or replace function public.save_citizen_identity(p_full_name text,p_username text,p_date_of_birth date,p_character_bio text,p_avatar_url text,p_character_gender text,p_avatar_config jsonb)
returns public.profiles language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para continuar.'; end if;
  perform private.validate_citizen_avatar(p_avatar_config);
  v_profile:=public.save_citizen_identity(p_full_name,p_username,p_date_of_birth,p_character_bio,p_avatar_url,p_character_gender);
  update public.profiles set avatar_config=p_avatar_config where id=auth.uid() returning * into v_profile;
  return v_profile;
end; $$;
revoke all on function public.save_citizen_identity(text,text,date,text,text,text,jsonb) from public,anon;
grant execute on function public.save_citizen_identity(text,text,date,text,text,text,jsonb) to authenticated;
commit;
