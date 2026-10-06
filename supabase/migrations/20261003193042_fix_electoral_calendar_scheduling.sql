begin;

create or replace function public.manage_electoral_calendar(p_election_id uuid,p_data jsonb)
returns public.elections language plpgsql security definer set search_path='' as $$
declare
 old_row public.elections%rowtype;
 result public.elections%rowtype;
 d public.elections%rowtype;
begin
 perform private.assert_electoral_management();
 if jsonb_typeof(p_data) is distinct from 'object'
  or p_data-array['name','description','election_type_id','candidacy_start_date','candidacy_end_date','voting_start_date','voting_end_date']<>'{}' then
  raise exception 'Informe apenas os dados do calendário eleitoral.' using errcode='22023';
 end if;
 if length(btrim(coalesce(p_data->>'name','')))<5 then
  raise exception 'Informe um nome de eleição com pelo menos 5 caracteres.' using errcode='22023';
 end if;
 if nullif(p_data->>'election_type_id','') is null then
  raise exception 'Selecione o tipo de eleição.' using errcode='22023';
 end if;
 begin
  d.election_type_id:=(p_data->>'election_type_id')::uuid;
 exception when invalid_text_representation then
  raise exception 'Selecione um tipo de eleição válido.' using errcode='22023';
 end;
 if not exists(select 1 from public.election_types where id=d.election_type_id) then
  raise exception 'O tipo de eleição selecionado não está mais disponível. Selecione outro tipo.' using errcode='22023';
 end if;
 begin
  d:=jsonb_populate_record(null::public.elections,p_data);
 exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
  raise exception 'Informe datas e horários válidos para todas as etapas, no horário de Brasília.' using errcode='22023';
 end;
 d.name:=btrim(d.name);
 if d.candidacy_start_date is null or d.candidacy_end_date is null or d.voting_start_date is null or d.voting_end_date is null
  or not isfinite(d.candidacy_start_date) or not isfinite(d.candidacy_end_date)
  or not isfinite(d.voting_start_date) or not isfinite(d.voting_end_date) then
  raise exception 'Preencha as quatro datas e horários do calendário eleitoral.' using errcode='22023';
 end if;
 if d.candidacy_start_date<=clock_timestamp() then
  raise exception 'O início das candidaturas deve estar no futuro, no horário de Brasília.' using errcode='22023';
 end if;
 if d.candidacy_end_date<=d.candidacy_start_date then
  raise exception 'O fim das candidaturas deve ser posterior ao início das candidaturas.' using errcode='22023';
 end if;
 -- Adjacent phases are valid: candidacy closes exactly when voting opens.
 -- The existing phase trigger already treats the candidacy end as exclusive.
 if d.voting_start_date<d.candidacy_end_date then
  raise exception 'A votação deve começar no mesmo horário ou depois do fim das candidaturas.' using errcode='22023';
 end if;
 if d.voting_end_date<=d.voting_start_date then
  raise exception 'O fim da votação deve ser posterior ao início da votação.' using errcode='22023';
 end if;
 if p_election_id is not null then
  select * into old_row from public.elections where id=p_election_id for update;
  if not found or old_row.archived_at is not null then
   raise exception 'Esta eleição não está mais disponível para edição.' using errcode='22023';
  end if;
  if old_row.candidacy_start_date<=clock_timestamp()
   or exists(select 1 from public.candidates where election_id=p_election_id)
   or exists(select 1 from public.votes where election_id=p_election_id) then
   raise exception 'O calendário de uma eleição iniciada ou com candidaturas não pode ser alterado por esta ação.' using errcode='22023';
  end if;
  update public.elections set name=d.name,description=d.description,election_type_id=d.election_type_id,
   candidacy_start_date=d.candidacy_start_date,candidacy_end_date=d.candidacy_end_date,
   voting_start_date=d.voting_start_date,voting_end_date=d.voting_end_date
   where id=p_election_id returning * into result;
 else
  insert into public.elections(name,description,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,status)
   values(d.name,d.description,d.election_type_id,d.candidacy_start_date,d.candidacy_end_date,d.voting_start_date,d.voting_end_date,'Scheduled') returning * into result;
 end if;
 perform economy_private.audit('electoral_calendar_managed','elections',result.id::text,to_jsonb(old_row),to_jsonb(result),'Organização institucional do calendário eleitoral.',auth.uid());
 return result;
end; $$;
revoke all on function public.manage_electoral_calendar(uuid,jsonb) from public,anon;
grant execute on function public.manage_electoral_calendar(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
