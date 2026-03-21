create extension if not exists pgcrypto;

create or replace function public.reject_plebiscite(
  p_plebiscite_id uuid,
  p_house_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.reject_plebiscite(p_plebiscite_id);
end;
$$;

create or replace function public.create_minister_dou_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_ministry text;
begin
  select full_name
    into v_full_name
  from public.profiles
  where id = coalesce(new.user_id, old.user_id);

  v_ministry := coalesce(new.ministry, old.ministry, 'Ministério');

  if tg_op = 'INSERT' then
    insert into public.dou_entries (
      title,
      summary,
      content,
      published_at,
      type,
      source_id
    )
    values (
      format('Nomeação ministerial: %s', coalesce(v_full_name, 'Ministro')),
      format('%s foi nomeado para %s.', coalesce(v_full_name, 'O cidadão indicado'), v_ministry),
      format('%s assumiu oficialmente o cargo de %s.', coalesce(v_full_name, 'O cidadão indicado'), v_ministry),
      now(),
      'Nomeação e Exoneração',
      gen_random_uuid()
    );

    return new;
  end if;

  insert into public.dou_entries (
    title,
    summary,
    content,
    published_at,
    type,
    source_id
  )
  values (
    format('Exoneração ministerial: %s', coalesce(v_full_name, 'Ministro')),
    format('%s deixou o cargo de %s.', coalesce(v_full_name, 'O ministro'), v_ministry),
    format('%s foi exonerado do cargo de %s.', coalesce(v_full_name, 'O ministro'), v_ministry),
    now(),
    'Nomeação e Exoneração',
    gen_random_uuid()
  );

  return old;
end;
$$;

drop trigger if exists trg_ministers_insert_dou on public.ministers;
create trigger trg_ministers_insert_dou
after insert on public.ministers
for each row
execute function public.create_minister_dou_entry();

drop trigger if exists trg_ministers_delete_dou on public.ministers;
create trigger trg_ministers_delete_dou
after delete on public.ministers
for each row
execute function public.create_minister_dou_entry();
