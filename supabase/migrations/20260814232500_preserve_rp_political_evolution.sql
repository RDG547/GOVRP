-- A sincronização de ocupantes e partidos não pode desfazer mudanças de
-- regime ou forma de governo realizadas posteriormente dentro do RP.

create or replace function public.refresh_brazil_rp_political_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  president_id uuid;
  president_name text;
  party_name text;
  party_ideology text;
  political_snapshot jsonb;
begin
  select
    profile.id,
    coalesce(nullif(profile.full_name, ''), profile.username),
    case
      when party.id is null then 'Sem filiação partidária no GOV.RP'
      else party.name || case
        when nullif(party.acronym, '') is null then ''
        else format(' (%s)', party.acronym)
      end
    end,
    coalesce(
      nullif(party.ideology::text, ''),
      nullif(party.orientation::text, ''),
      'Não definida pelo partido no GOV.RP'
    )
  into president_id, president_name, party_name, party_ideology
  from public.profiles profile
  left join lateral (
    select candidate_party.*
    from public.political_parties candidate_party
    where candidate_party.id = profile.party_affiliation
       or exists (
         select 1
         from public.party_members membership
         where membership.user_id = profile.id
           and membership.party_id = candidate_party.id
       )
    order by
      (candidate_party.id = profile.party_affiliation) desc,
      candidate_party.is_active desc,
      candidate_party.created_at desc
    limit 1
  ) party on true
  where profile.role = 'Presidente'
  order by profile.role_assigned_at desc nulls last, profile.updated_at desc
  limit 1;

  political_snapshot := jsonb_build_object(
    'leader', coalesce(president_name, 'Cargo vago'),
    'leaderProfileId', president_id,
    'office', 'Presidência da República no GOV.RP',
    'party', coalesce(party_name, 'Não se aplica'),
    'ideology', coalesce(party_ideology, 'Não definida no GOV.RP'),
    'source', 'GOV.RP — governo em exercício',
    'playerInfluence', 0.5,
    'simulationInfluence', 0.5
  );

  update public.country_rp_states state
  set political_current = state.political_current || political_snapshot,
      last_event_type = 'government_state_updated',
      last_event_summary = 'O governo em exercício do Brasil foi sincronizado com o GOV.RP.'
  where state.country_code = 'BR'
    and state.is_playable
    and state.political_current is distinct from state.political_current || political_snapshot;

  return political_snapshot;
end;
$$;

select public.refresh_brazil_rp_political_state();

-- Decisões do painel presidencial passam pelo estado nacional. As configurações
-- continuam atendendo seus consumidores específicos, enquanto o panorama recebe
-- a mesma decisão e o orçamento alimenta o motor macroeconômico.
create or replace function public.sync_presidential_setting_to_country_rp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_budget numeric := 0;
  current_budget numeric := 0;
  budget_delta numeric := 0;
begin
  if new.key not in (
    'government_budget',
    'tax_rates',
    'basic_service_prices',
    'enterprise_costs',
    'base_tariffs',
    'economic_policy',
    'bank_policy'
  ) then
    return new;
  end if;

  if old.value is not distinct from new.value then
    return new;
  end if;

  update public.country_rp_states state
  set economic_current = state.economic_current || jsonb_build_object(
        'lastPresidentialDecision', jsonb_build_object(
          'setting', new.key,
          'value', new.value,
          'changedAt', now(),
          'actorId', auth.uid()
        )
      ),
      last_event_type = 'presidential_setting_updated',
      last_event_summary = format(
        'A Presidência alterou %s e a decisão foi propagada na plataforma.',
        new.key
      ),
      updated_by = auth.uid()
  where state.country_code = 'BR'
    and state.is_playable;

  if new.key = 'government_budget' then
    select coalesce(sum(coalesce(nullif(area->>'allocated_value', '')::numeric, 0)), 0)
      into previous_budget
    from jsonb_array_elements(coalesce(old.value->'areas', '[]'::jsonb)) area;

    select coalesce(sum(coalesce(nullif(area->>'allocated_value', '')::numeric, 0)), 0)
      into current_budget
    from jsonb_array_elements(coalesce(new.value->'areas', '[]'::jsonb)) area;

    budget_delta := current_budget - previous_budget;
    if budget_delta <> 0 then
      perform economy_private.record_event(
        'presidential_budget_updated',
        'government_spending',
        'system_settings',
        format('government_budget:%s', txid_current()),
        budget_delta,
        auth.uid(),
        null,
        null,
        null,
        null,
        null,
        0,
        0,
        now(),
        public.rp_now(),
        false,
        0.5,
        jsonb_build_object(
          'previous_budget', previous_budget,
          'current_budget', current_budget,
          'source', 'presidential_dashboard'
        ),
        'presidential_budget',
        null
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists system_settings_syncs_presidential_rp on public.system_settings;
create trigger system_settings_syncs_presidential_rp
after update of value on public.system_settings
for each row execute function public.sync_presidential_setting_to_country_rp();
