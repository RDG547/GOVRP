BEGIN;
CREATE OR REPLACE FUNCTION private.assign_candidate_electoral_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_digits integer; v_prefix text; v_min integer; v_max integer;
begin
  -- Deleting a closed party only detaches its FK; the ballot number is historical.
  if tg_op='UPDATE' and old.party_id is not null and new.party_id is null
    and new.party_snapshot->>'id'=old.party_id::text
    and new.election_id=old.election_id and new.electoral_number=old.electoral_number then return new; end if;
  v_digits:=private.election_number_digits(new.election_id);
  if v_digits is null then raise exception 'Eleição não encontrada.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('candidate-number:'||new.election_id::text,0));
  if tg_op='UPDATE' and new.electoral_number is distinct from old.electoral_number then
    if exists(select 1 from public.elections where archived_at is null
      and voting_start_date<=clock_timestamp() and voting_end_date>clock_timestamp()
      and lower(coalesce(status,'')) not in ('cancelled','canceled','cancelada'))
    then raise exception 'A numeração fica bloqueada enquanto existir votação eleitoral em andamento.' using errcode='55000'; end if;
    if exists(select 1 from public.elections where id=new.election_id
      and (status in ('Voting','Finished') or voting_start_date<=clock_timestamp()))
    then raise exception 'O número não pode mudar depois do início da votação.'; end if;
  end if;
  if new.party_id is not null then
    select electoral_number into v_prefix from public.political_parties where id=new.party_id;
  else
    v_prefix:=''; -- Independent ballots may use any available number of the office's length.
  end if;
  if v_prefix is null then raise exception 'O partido precisa de número eleitoral.'; end if;
  v_min:=(v_prefix||repeat('0',v_digits-length(v_prefix)))::integer;
  v_max:=(v_prefix||repeat('9',v_digits-length(v_prefix)))::integer;
  if new.electoral_number is null then
    select lpad(n::text,v_digits,'0') into new.electoral_number from generate_series(v_min,v_max) n where not exists(select 1 from public.candidates c where c.election_id=new.election_id and c.electoral_number=lpad(n::text,v_digits,'0') and c.id<>new.id and lower(coalesce(c.status,'')) not in ('rejected','rejeitado','cancelled','cancelado','cancelada','withdrawn')) order by n limit 1;
  end if;
  if not coalesce(new.electoral_number ~ ('^[0-9]{'||v_digits||'}$') and left(new.electoral_number,length(v_prefix))=v_prefix,false) then
    if new.party_id is null then raise exception 'Informe um número com % dígitos.',v_digits;
    else raise exception 'Use % dígitos começando por %.',v_digits,v_prefix; end if;
  end if;
  if exists(select 1 from public.candidates c where c.election_id=new.election_id and c.electoral_number=new.electoral_number and c.id<>new.id and lower(coalesce(c.status,'')) not in ('rejected','rejeitado','cancelled','cancelado','cancelada','withdrawn')) then raise exception 'Este número já está sendo utilizado nesta eleição.'; end if;
  return new;
end; $function$
;
COMMIT;