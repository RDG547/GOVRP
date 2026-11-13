BEGIN;

-- Reuse the established unique indexes (active_party_name_unique,
-- active_party_acronym_unique, active_party_number_unique and
-- candidate_electoral_number_unique).
CREATE OR REPLACE FUNCTION private.assign_party_electoral_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended('party-electoral-number',0));
  if tg_op='UPDATE' and new.electoral_number is distinct from old.electoral_number then
    if auth.uid() is null or not (auth.uid()=old.owner_id or auth.uid()=old.founder_id or coalesce(public.is_admin(auth.uid()),false)) then
      raise exception 'Somente o dono do partido ou Admin pode mudar o número.' using errcode='42501';
    end if;
    if exists(select 1 from public.elections where archived_at is null
      and voting_start_date<=clock_timestamp() and voting_end_date>clock_timestamp()
      and lower(coalesce(status,'')) not in ('cancelled','canceled','cancelada')) then
      raise exception 'Não é permitido alterar números durante votação eleitoral.' using errcode='55000';
    end if;
  end if;
  if new.electoral_number is null then
    select n::text into new.electoral_number from generate_series(10,99) n where not exists(select 1 from public.political_parties p where p.status is distinct from 'Encerrado' and p.electoral_number=n::text) order by n limit 1;
  end if;
  if new.electoral_number is null then raise exception 'Não há número partidário disponível. Procure a administração eleitoral.'; end if;
  if new.electoral_number !~ '^[1-9][0-9]$' then raise exception 'O número partidário deve ter dois dígitos, de 10 a 99.'; end if;
  if exists(select 1 from public.political_parties p where p.status is distinct from 'Encerrado' and p.electoral_number=new.electoral_number and p.id<>new.id) then raise exception 'Este número já pertence a outro partido.'; end if;
  return new;
end; $function$
;

-- All number updates are atomic, authorized and conflict-checked by
-- the existing party trigger. An ongoing election locks all renumbering.
CREATE OR REPLACE FUNCTION public.set_party_electoral_number(p_party_id uuid,p_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_old public.political_parties%rowtype; v_new public.political_parties%rowtype;
BEGIN
 SELECT * INTO v_old FROM public.political_parties WHERE id=p_party_id FOR UPDATE;
 IF v_old.id IS NULL OR v_old.status='Encerrado' THEN
   RAISE EXCEPTION 'Partido não encontrado ou encerrado.';
 END IF;
 IF auth.uid() IS NULL OR NOT (auth.uid()=v_old.owner_id OR auth.uid()=v_old.founder_id OR coalesce(public.is_admin(auth.uid()),false)) THEN
   RAISE EXCEPTION 'Somente o dono do partido ou Admin pode mudar o número.' USING ERRCODE='42501';
 END IF;
 IF p_number IS NULL OR p_number !~ '^[1-9][0-9]$' THEN RAISE EXCEPTION 'Escolha um número de 10 a 99.' USING ERRCODE='22023'; END IF;
 IF p_number IS DISTINCT FROM v_old.electoral_number THEN
   UPDATE public.political_parties SET electoral_number=p_number WHERE id=p_party_id RETURNING * INTO v_new;
   INSERT INTO public.party_history(party_id,actor_id,event_type,summary,previous_state,current_state)
   VALUES(p_party_id,auth.uid(),'party_updated','Número eleitoral do partido atualizado.',to_jsonb(v_old),to_jsonb(v_new));
 ELSE v_new:=v_old; END IF;
 RETURN jsonb_build_object('success',true,'number',v_new.electoral_number);
END $$;
REVOKE ALL ON FUNCTION public.set_party_electoral_number(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_party_electoral_number(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.propagate_party_public_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.electoral_number IS DISTINCT FROM OLD.electoral_number THEN
    -- Historical ballots are immutable; only not-yet-started voting may update.
    UPDATE public.candidates c SET
      electoral_number=NEW.electoral_number||substring(c.electoral_number FROM 3),
      party_snapshot=coalesce(c.party_snapshot,'{}'::jsonb)
         ||jsonb_build_object('electoral_number',NEW.electoral_number,'name',NEW.name,'acronym',NEW.acronym)
    FROM public.elections e
    WHERE e.id=c.election_id AND c.party_id=NEW.id
      AND e.voting_start_date>clock_timestamp()
      AND c.electoral_number IS NOT NULL
      AND left(c.electoral_number,2)=OLD.electoral_number;
  ELSIF NEW.name IS DISTINCT FROM OLD.name OR NEW.acronym IS DISTINCT FROM OLD.acronym THEN
    UPDATE public.candidates c SET
      party_snapshot=coalesce(c.party_snapshot,'{}'::jsonb)
        ||jsonb_build_object('name',NEW.name,'acronym',NEW.acronym)
    FROM public.elections e
    WHERE e.id=c.election_id AND c.party_id=NEW.id
      AND e.voting_start_date>clock_timestamp()
      AND c.party_snapshot IS NOT NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS party_public_identity_to_upcoming_ballots ON public.political_parties;
CREATE TRIGGER party_public_identity_to_upcoming_ballots
AFTER UPDATE OF electoral_number,name,acronym ON public.political_parties
FOR EACH ROW EXECUTE FUNCTION private.propagate_party_public_identity();

-- Public party-number auto-assignment remains available to legacy callers,
-- while the founding form uses this explicit number variant.
CREATE OR REPLACE FUNCTION public.create_political_party_with_number(
  p_name text,p_acronym text,p_ideology text,p_logo_url text,
  p_statute text,p_description text,p_orientation public.political_orientation,
  p_color text,p_font_key text,p_header_url text,p_electoral_number text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result json;
BEGIN
 IF p_electoral_number IS NULL OR p_electoral_number !~ '^[1-9][0-9]$' THEN
   RAISE EXCEPTION 'Escolha um número de partido entre 10 e 99.' USING ERRCODE='22023';
 END IF;
 v_result:=public.create_political_party(p_name,p_acronym,p_ideology,p_logo_url,p_statute,p_description,p_orientation,p_color,p_font_key,p_header_url);
 IF coalesce((v_result->>'success')::boolean,false) THEN
   PERFORM public.set_party_electoral_number((v_result->>'party_id')::uuid,p_electoral_number);
 END IF;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.create_political_party_with_number(text,text,text,text,text,text,public.political_orientation,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_political_party_with_number(text,text,text,text,text,text,public.political_orientation,text,text,text,text) TO authenticated;

-- Avoid confusing candidates with identical public ballot names in the same race.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_ballot_name_unique
ON public.candidates(election_id,lower(btrim(political_name)))
WHERE removed_at IS NULL AND lower(coalesce(status,'')) NOT IN
 ('rejected','rejeitado','cancelled','cancelado','cancelada','withdrawn');

COMMIT;