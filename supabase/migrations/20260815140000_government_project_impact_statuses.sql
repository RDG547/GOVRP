-- Alinha as consequências de projetos aos estados efetivamente aceitos pelo motor econômico.

create or replace function public.record_government_project_impact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  impact numeric := 0;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  impact := case lower(new.status)
    when 'approved' then 0.2
    when 'funded' then 0.1
    when 'completed' then least(4, greatest(0.5, coalesce(new.quality_score, 50) / 30))
    when 'paused' then -0.6
    when 'delayed' then -1
    when 'cancelled' then -1.5
    when 'under_investigation' then -1.2
    else 0
  end;

  if impact <> 0 then
    perform public.apply_government_impact(
      'infrastructure',
      'government_project_' || lower(new.status),
      'Projeto público "' || new.name || '": ' || new.status || '.',
      impact,
      0,
      'government_projects',
      new.id::text,
      jsonb_build_object(
        'quality', new.quality_score,
        'budget', new.approved_budget,
        'spent', new.spent_amount,
        'progress', new.progress,
        'previousStatus', old.status,
        'status', new.status
      )
    );
  end if;

  return new;
end;
$$;
