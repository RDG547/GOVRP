create or replace function public.resolve_parliament_leadership_position_label(
  p_house_name text,
  p_position text
)
returns text
language sql
stable
as $$
  select case
    when p_position = 'president' then
      case
        when coalesce(p_house_name, '') ilike '%senado%' then 'Presidente do Senado'
        else 'Presidente da Câmara dos Deputados'
      end
    when p_position = 'vice_president' then
      case
        when coalesce(p_house_name, '') ilike '%senado%' then 'Vice-Presidente do Senado Federal'
        else 'Vice-Presidente da Câmara dos Deputados'
      end
    else coalesce(nullif(p_position, ''), 'Cargo da Mesa Diretora')
  end;
$$;

create or replace function public.publish_parliament_leadership_term_gazette()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_house_name text;
  v_profile_name text;
  v_position_label text;
  v_election_title text;
  v_start_source_id text := format('parliament-leadership-term-start-%s', new.id);
  v_end_source_id text := format('parliament-leadership-term-end-%s', new.id);
begin
  select
    h.name,
    p.full_name,
    public.resolve_parliament_leadership_position_label(h.name, new.position)
  into
    v_house_name,
    v_profile_name,
    v_position_label
  from public.parliament_houses h
  join public.parliament_members pm on pm.id = new.member_id
  join public.profiles p on p.id = pm.user_id
  where h.id = new.house_id;

  if v_profile_name is null then
    return new;
  end if;

  select election.title
  into v_election_title
  from public.parliament_leadership_elections election
  where election.id = new.elected_by_election_id;

  if new.status = 'active' then
    insert into public.dou_entries (title, summary, content, type, source_id, published_at)
    select
      format('Posse na Mesa Diretora: %s', v_profile_name),
      format('%s assumiu o posto de %s.', v_profile_name, v_position_label),
      format(
        '%s assumiu o posto de %s na %s%s Início do exercício: %s.%s',
        v_profile_name,
        v_position_label,
        coalesce(v_house_name, 'Casa Legislativa'),
        case
          when v_election_title is not null then format(', após a eleição interna "%s".', v_election_title)
          else '.'
        end,
        coalesce(to_char(new.term_start_date, 'DD/MM/YYYY'), 'data indefinida'),
        case
          when new.term_end_date is not null then format(' Término previsto: %s.', to_char(new.term_end_date, 'DD/MM/YYYY'))
          else ''
        end
      ),
      'Nomeacao e Exoneracao',
      v_start_source_id,
      coalesce(new.created_at, new.updated_at, now())
    where not exists (
      select 1
      from public.dou_entries existing_entry
      where existing_entry.source_id = v_start_source_id
    );
  end if;

  if new.status = 'concluded' or new.concluded_at is not null then
    insert into public.dou_entries (title, summary, content, type, source_id, published_at)
    select
      format('Encerramento na Mesa Diretora: %s', v_profile_name),
      format('%s deixou o posto de %s.', v_profile_name, v_position_label),
      format(
        '%s encerrou o exercício de %s na %s.%s',
        v_profile_name,
        v_position_label,
        coalesce(v_house_name, 'Casa Legislativa'),
        case
          when coalesce(new.concluded_at::text, '') <> '' then format(' Encerramento registrado em %s.', to_char(coalesce(new.concluded_at, now()), 'DD/MM/YYYY'))
          when new.term_end_date is not null then format(' Término registrado para %s.', to_char(new.term_end_date, 'DD/MM/YYYY'))
          else ''
        end
      ),
      'Nomeacao e Exoneracao',
      v_end_source_id,
      coalesce(new.concluded_at, new.updated_at, now())
    where not exists (
      select 1
      from public.dou_entries existing_entry
      where existing_entry.source_id = v_end_source_id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_publish_parliament_leadership_term_gazette on public.parliament_leadership_terms;

create trigger trg_publish_parliament_leadership_term_gazette
after insert or update of status, term_start_date, term_end_date, concluded_at
on public.parliament_leadership_terms
for each row
execute function public.publish_parliament_leadership_term_gazette();

with leadership_terms as (
  select
    t.id,
    t.status,
    t.term_start_date,
    t.term_end_date,
    t.concluded_at,
    t.created_at,
    t.updated_at,
    h.name as house_name,
    p.full_name as profile_name,
    public.resolve_parliament_leadership_position_label(h.name, t.position) as position_label,
    e.title as election_title
  from public.parliament_leadership_terms t
  join public.parliament_houses h on h.id = t.house_id
  join public.parliament_members pm on pm.id = t.member_id
  join public.profiles p on p.id = pm.user_id
  left join public.parliament_leadership_elections e on e.id = t.elected_by_election_id
)
insert into public.dou_entries (title, summary, content, type, source_id, published_at)
select
  format('Posse na Mesa Diretora: %s', lt.profile_name),
  format('%s assumiu o posto de %s.', lt.profile_name, lt.position_label),
  format(
    '%s assumiu o posto de %s na %s%s Início do exercício: %s.%s',
    lt.profile_name,
    lt.position_label,
    coalesce(lt.house_name, 'Casa Legislativa'),
    case
      when lt.election_title is not null then format(', após a eleição interna "%s".', lt.election_title)
      else '.'
    end,
    coalesce(to_char(lt.term_start_date, 'DD/MM/YYYY'), 'data indefinida'),
    case
      when lt.term_end_date is not null then format(' Término previsto: %s.', to_char(lt.term_end_date, 'DD/MM/YYYY'))
      else ''
    end
  ),
  'Nomeacao e Exoneracao',
  format('parliament-leadership-term-start-%s', lt.id),
  coalesce(lt.created_at, lt.updated_at, now())
from leadership_terms lt
where lt.status = 'active'
  and not exists (
    select 1
    from public.dou_entries existing_entry
    where existing_entry.source_id = format('parliament-leadership-term-start-%s', lt.id)
  );

with leadership_terms as (
  select
    t.id,
    t.status,
    t.term_end_date,
    t.concluded_at,
    t.created_at,
    t.updated_at,
    h.name as house_name,
    p.full_name as profile_name,
    public.resolve_parliament_leadership_position_label(h.name, t.position) as position_label
  from public.parliament_leadership_terms t
  join public.parliament_houses h on h.id = t.house_id
  join public.parliament_members pm on pm.id = t.member_id
  join public.profiles p on p.id = pm.user_id
)
insert into public.dou_entries (title, summary, content, type, source_id, published_at)
select
  format('Encerramento na Mesa Diretora: %s', lt.profile_name),
  format('%s deixou o posto de %s.', lt.profile_name, lt.position_label),
  format(
    '%s encerrou o exercício de %s na %s.%s',
    lt.profile_name,
    lt.position_label,
    coalesce(lt.house_name, 'Casa Legislativa'),
    case
      when lt.concluded_at is not null then format(' Encerramento registrado em %s.', to_char(lt.concluded_at, 'DD/MM/YYYY'))
      when lt.term_end_date is not null then format(' Término registrado para %s.', to_char(lt.term_end_date, 'DD/MM/YYYY'))
      else ''
    end
  ),
  'Nomeacao e Exoneracao',
  format('parliament-leadership-term-end-%s', lt.id),
  coalesce(lt.concluded_at, lt.updated_at, now())
from leadership_terms lt
where (lt.status = 'concluded' or lt.concluded_at is not null)
  and not exists (
    select 1
    from public.dou_entries existing_entry
    where existing_entry.source_id = format('parliament-leadership-term-end-%s', lt.id)
  );