-- Citizens use the explicitly projected RPC below. Internal triage remains
-- available to authorized justice officers through the existing role policy.
drop policy if exists "Users can view their own occurrences" on public.police_occurrences;
revoke select on public.police_occurrences from anon;

create or replace function public.get_my_police_occurrences_page(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  page_size integer := least(100, greatest(1, coalesce(p_limit,20)));
  items jsonb;
  has_more boolean;
  last_item jsonb;
  active_count bigint;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGE_CURSOR';
  end if;
  select coalesce(jsonb_agg(row_data order by created_at desc,id desc),'[]'::jsonb)
  into items from (
    select o.created_at,o.id,jsonb_build_object(
      'id',o.id,'protocol_number',o.protocol_number,'title',o.title,
      'description',o.description,'details',o.details,'status',o.status,
      'priority',o.priority,'created_at',o.created_at,'updated_at',o.updated_at,
      'history',coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'content',case when a.action='occurrence.created' then 'Ocorrência recebida.'
          else 'Situação: '||coalesce(a.new_state->>'status','Atualizada')||'.' end,
        'created_at',a.created_at,'status',a.new_state->>'status') order by a.created_at,a.id)
        from public.justice_audit_log a where a.entity_type='police_occurrence' and a.entity_id=o.id
          and a.action in('occurrence.created','occurrence.status_changed')),'[]'::jsonb)
    ) row_data
    from public.police_occurrences o
    where (o.user_id=auth.uid() or o.reported_by=auth.uid() or exists(
      select 1 from public.justice_audit_log a where a.actor_id=auth.uid()
        and a.action='occurrence.created' and a.entity_type='police_occurrence' and a.entity_id=o.id
    )) and (p_before_created_at is null or (o.created_at,o.id)<(p_before_created_at,p_before_id))
    order by o.created_at desc,o.id desc limit page_size+1
  ) own_occurrences;
  has_more := jsonb_array_length(items)>page_size;
  if has_more then items := items - page_size; end if;
  last_item := items -> -1;
  select count(*) into active_count from public.police_occurrences o
  where o.status not in('Arquivada','Duplicada') and (o.user_id=auth.uid() or o.reported_by=auth.uid() or exists(
    select 1 from public.justice_audit_log a where a.actor_id=auth.uid()
      and a.action='occurrence.created' and a.entity_type='police_occurrence' and a.entity_id=o.id
  ));
  return jsonb_build_object('items',items,'active_count',active_count,'next_cursor',case when has_more then
    jsonb_build_object('created_at',last_item->>'created_at','id',last_item->>'id') else null end);
end; $$;
revoke all on function public.get_my_police_occurrences_page(integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_my_police_occurrences_page(integer,timestamptz,uuid) to authenticated;

create index if not exists police_occurrences_owner_page_idx on public.police_occurrences(user_id,created_at desc,id desc);
create index if not exists police_occurrences_reporter_page_idx on public.police_occurrences(reported_by,created_at desc,id desc);

do $$ declare t text; begin
  foreach t in array array['justice_deadlines','public_safety_campaigns'] loop
    if exists(select 1 from pg_publication where pubname='supabase_realtime')
      and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end; $$;

notify pgrst, 'reload schema';
