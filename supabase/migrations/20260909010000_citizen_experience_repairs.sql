begin;

-- Reissue without destroying the historical document or violating the one-valid-document index.
create or replace function public.issue_criminal_clearance_certificate()
returns public.documents language plpgsql security definer set search_path='' as $$
declare result public.documents%rowtype; has_record boolean; certificate_number text; actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
  perform 1 from public.profiles where id=actor and onboarding_completed for update;
  if not found then raise exception 'Conclua sua cidadania para emitir o atestado.'; end if;
  select exists(select 1 from public.criminal_records where user_id=actor and is_active and record_status='conviction') into has_record;
  select * into result from public.documents where user_id=actor and type='Atestado de Antecedentes' and is_valid
    and expires_at>clock_timestamp() and issued_at>clock_timestamp()-interval '1 minute'
    and metadata->>'result'=case when has_record then 'positive' else 'nothing_found' end;
  if found then return result; end if;
  update public.documents set is_valid=false where user_id=actor and type='Atestado de Antecedentes' and is_valid;
  certificate_number:='AAC-'||to_char(public.rp_now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into public.documents(user_id,type,document_number,issued_at,expires_at,is_valid,metadata,qr_code_data,full_name)
  select id,'Atestado de Antecedentes',certificate_number,clock_timestamp(),clock_timestamp()+interval '90 days',true,
    jsonb_build_object('result',case when has_record then 'positive' else 'nothing_found' end,'generatedAt',clock_timestamp(),'rule','active_convictions_only'),
    'GOVRP:AAC:'||certificate_number,full_name from public.profiles where id=actor returning * into result;
  return result;
end; $$;

-- The reference is the price carried into the RP day, not today's first changed price.
alter table public.country_rp_exchange_rates add column rp_day date, add column day_open_rate numeric;
alter table public.country_rp_exchange_history add column recorded_at_rp timestamptz default public.rp_now();
update public.country_rp_exchange_rates set rp_day=(public.rp_now() at time zone 'UTC')::date,day_open_rate=brl_per_unit;
create or replace function private.capture_exchange_day_open()
returns trigger language plpgsql security definer set search_path='' as $$
declare today date:=(public.rp_now() at time zone 'UTC')::date;
begin
  if tg_op='INSERT' then new.rp_day:=today; new.day_open_rate:=new.brl_per_unit;
  elsif old.rp_day is distinct from today then new.rp_day:=today; new.day_open_rate:=old.brl_per_unit;
  else new.rp_day:=old.rp_day; new.day_open_rate:=old.day_open_rate; end if;
  return new;
end; $$;
create trigger capture_exchange_day_open before insert or update on public.country_rp_exchange_rates
for each row execute function private.capture_exchange_day_open();
create or replace function public.get_rp_exchange_quotes(p_country_code text default 'BR')
returns table(currency_code text,brl_per_unit numeric,day_open_rate numeric,change_percent numeric,rp_day date,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
  select r.currency_code,r.brl_per_unit,
    case when r.rp_day=(public.rp_now() at time zone 'UTC')::date then r.day_open_rate else r.brl_per_unit end,
    case when r.rp_day=(public.rp_now() at time zone 'UTC')::date and r.day_open_rate>0 then round((r.brl_per_unit/r.day_open_rate-1)*100,6) else 0 end,
    (public.rp_now() at time zone 'UTC')::date,r.updated_at
  from public.country_rp_exchange_rates r where r.country_code=case when exists(select 1 from public.country_rp_exchange_rates where country_code=upper(p_country_code)) then upper(p_country_code) else 'BR' end;
$$;

create or replace function public.update_post(p_post_id uuid,p_new_content text)
returns json language plpgsql security definer set search_path='' as $$
declare post public.posts%rowtype;
begin
  select * into post from public.posts where id=p_post_id for update;
  if not found then raise exception 'Esta publicação foi removida.'; end if;
  if auth.uid() is null or post.user_id<>auth.uid() then raise exception 'Você só pode editar suas próprias publicações.' using errcode='42501'; end if;
  if p_new_content is null or length(p_new_content)>10000 or (post.original_post_id is null and length(btrim(p_new_content))=0) then raise exception 'Informe um texto válido para a publicação.'; end if;
  update public.posts set content=case when post.original_post_id is null then p_new_content else content end,
    quote_content=case when post.original_post_id is not null then nullif(btrim(p_new_content),'') else quote_content end,updated_at=clock_timestamp() where id=post.id;
  return json_build_object('success',true,'message','Publicação atualizada.');
end; $$;

create or replace function private.validate_comment_thread()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.parent_comment_id is not null and not exists(select 1 from public.comments where id=new.parent_comment_id and post_id=new.post_id and id<>new.id) then raise exception 'A resposta precisa pertencer à mesma publicação.'; end if;
  if tg_op='UPDATE' and (new.parent_comment_id is distinct from old.parent_comment_id or new.post_id<>old.post_id or new.user_id<>old.user_id) then raise exception 'Não é possível mover um comentário para outra conversa.'; end if;
  return new;
end; $$;
create trigger validate_comment_thread before insert or update on public.comments for each row execute function private.validate_comment_thread();
create or replace function private.record_comment_thread()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent_id uuid; author_name text;
begin
  if tg_op='DELETE' then
    update public.comments set replies_count=greatest(0,replies_count-1) where id=old.parent_comment_id;
    return old;
  end if;
  update public.comments set replies_count=coalesce(replies_count,0)+1 where id=new.parent_comment_id;
  select user_id into parent_id from public.comments where id=new.parent_comment_id;
  select coalesce(x_username,full_name,username) into author_name from public.profiles where id=new.user_id;
  insert into public.notifications(user_id,type,content,link,metadata)
  select distinct recipient,'x_reply',author_name||case when recipient=parent_id then ' respondeu ao seu comentário.' else ' mencionou você em um comentário.' end,
    '/services/x/post/'||new.post_id,jsonb_build_object('comment_id',new.id,'parent_comment_id',new.parent_comment_id)
  from (
    select parent_id recipient
    union select p.id from regexp_matches(new.content,'@([[:alnum:]_]+)','g') m join public.profiles p on lower(coalesce(p.x_handle,p.username))=lower(m[1])
  ) recipients where recipient is not null and recipient<>new.user_id;
  return new;
end; $$;
create trigger record_comment_thread after insert or delete on public.comments for each row execute function private.record_comment_thread();
update public.comments c set replies_count=(select count(*) from public.comments r where r.parent_comment_id=c.id);
create or replace function public.create_comment_reply(p_post_id uuid,p_parent_comment_id uuid,p_content text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
  insert into public.comments(post_id,user_id,content,parent_comment_id) values(p_post_id,auth.uid(),p_content,p_parent_comment_id);
end; $$;

alter function public.issue_criminal_clearance_certificate() owner to postgres;
alter function public.get_rp_exchange_quotes(text) owner to postgres;
alter function public.update_post(uuid,text) owner to postgres;
alter function public.create_comment_reply(uuid,uuid,text) owner to postgres;
alter function private.capture_exchange_day_open() owner to postgres;
alter function private.validate_comment_thread() owner to postgres;
alter function private.record_comment_thread() owner to postgres;
revoke all on function public.issue_criminal_clearance_certificate(),public.update_post(uuid,text),public.create_comment_reply(uuid,uuid,text) from public,anon;
grant execute on function public.issue_criminal_clearance_certificate(),public.update_post(uuid,text),public.create_comment_reply(uuid,uuid,text) to authenticated,service_role;
revoke all on function private.capture_exchange_day_open(),private.validate_comment_thread(),private.record_comment_thread() from public,anon,authenticated;
revoke all on function public.get_rp_exchange_quotes(text) from public;
grant execute on function public.get_rp_exchange_quotes(text) to anon,authenticated,service_role;
commit;
