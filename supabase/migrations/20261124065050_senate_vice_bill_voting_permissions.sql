-- Narrow additional authority for active Senate vice-presidents, only for PL/PEC votes.
CREATE OR REPLACE FUNCTION private.is_senate_vice_bill_voting_authority(p_actor uuid, p_house_id uuid, p_bill_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.parliament_leadership_terms t
    JOIN public.parliament_members m ON m.id = t.member_id AND m.house_id = t.house_id
    JOIN public.parliament_houses h ON h.id = t.house_id
    JOIN public.bills b ON b.id = p_bill_id
    WHERE m.user_id = p_actor
      AND t.house_id = p_house_id
      AND h.name IN ('Senado', 'Senado Federal')
      AND t.position = 'vice_president'
      AND t.status = 'active'
      AND t.term_start_date <= current_date
      AND t.term_end_date >= current_date
      AND m.id = public.get_active_parliament_member_id(p_actor, p_house_id)
      AND b.type IN ('PL', 'PEC', 'Proposta de Emenda Constitucional')
      AND (b.house_id = p_house_id OR b.type IN ('PEC', 'Proposta de Emenda Constitucional') OR coalesce((b.institutional_data->>'requires_bicameral')::boolean,false))
  );
$function$;
REVOKE ALL ON FUNCTION private.is_senate_vice_bill_voting_authority(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.schedule_parliament_bill_voting(p_bill_id uuid, p_house_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_bill public.bills%rowtype; v public.parliament_voting_schedules%rowtype;
BEGIN
 IF auth.uid() IS NULL OR (NOT private.is_house_president(auth.uid(),p_house_id) AND NOT public.has_full_admin_access() AND NOT private.is_senate_vice_bill_voting_authority(auth.uid(),p_house_id,p_bill_id))
   THEN RAISE EXCEPTION 'Somente a Presidência da Casa pode agendar votações.' USING errcode='42501'; END IF;
 IF p_starts_at IS NULL OR p_ends_at IS NULL
    OR p_starts_at < clock_timestamp()+interval '1 minute'
    OR p_starts_at > clock_timestamp()+interval '30 days'
    OR p_ends_at <= p_starts_at+interval '4 minutes'
    OR p_ends_at > p_starts_at+interval '72 hours'
   THEN RAISE EXCEPTION 'Agende de 1 minuto a 30 dias antes; a votação deve durar entre 5 minutos e 72 horas.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('parliament:schedule:'||p_bill_id::text||':'||p_house_id::text));
 SELECT * INTO v_bill FROM public.bills WHERE id=p_bill_id FOR UPDATE;
 IF v_bill.id IS NULL THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;
 IF v_bill.house_id<>p_house_id AND v_bill.type NOT IN ('PEC','Proposta de Emenda Constitucional')
   AND NOT coalesce((v_bill.institutional_data->>'requires_bicameral')::boolean,false)
   THEN RAISE EXCEPTION 'Este projeto não pertence à sua Casa.'; END IF;
 IF v_bill.status NOT IN ('Em tramitação','Em votação (2ª Casa)','Protocolado')
   OR (v_bill.status='Protocolado' AND v_bill.type<>'IMPEACHMENT') THEN
   RAISE EXCEPTION 'Este projeto não está disponível para agendamento.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.parliament_votings p
 WHERE p.related_id=p_bill_id AND p.house_id=p_house_id AND p.status='active' AND p.type='bill')
 THEN RAISE EXCEPTION 'Já existe uma votação em andamento.'; END IF;
 IF EXISTS(SELECT 1 FROM public.parliament_voting_schedules s
 WHERE s.bill_id=p_bill_id AND s.house_id=p_house_id AND s.status='scheduled')
 THEN RAISE EXCEPTION 'Este projeto já possui uma votação agendada nesta Casa.'; END IF;
 INSERT INTO public.parliament_voting_schedules(bill_id,house_id,scheduled_by,title,description,starts_at,ends_at)
 VALUES(p_bill_id,p_house_id,auth.uid(),v_bill.title,v_bill.summary,p_starts_at,p_ends_at)
 RETURNING * INTO v;
 RETURN jsonb_build_object('success',true,'schedule_id',v.id,'starts_at',v.starts_at,'ends_at',v.ends_at);
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_parliament_bill_schedule(p_schedule_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.parliament_voting_schedules%rowtype;
BEGIN
 SELECT * INTO s FROM public.parliament_voting_schedules WHERE id=p_schedule_id FOR UPDATE;
 IF s.id IS NULL OR s.status<>'scheduled' THEN RAISE EXCEPTION 'Agendamento não está pendente.'; END IF;
 IF auth.uid() IS NULL OR (NOT private.is_house_president(auth.uid(),s.house_id) AND NOT public.has_full_admin_access() AND NOT private.is_senate_vice_bill_voting_authority(auth.uid(),s.house_id,s.bill_id))
 THEN RAISE EXCEPTION 'Somente a Presidência da Casa pode cancelar o agendamento.' USING errcode='42501'; END IF;
 UPDATE public.parliament_voting_schedules SET status='cancelled',changed_at=clock_timestamp() WHERE id=s.id;
 RETURN jsonb_build_object('success',true);
END $function$;

CREATE OR REPLACE FUNCTION private.activate_due_parliament_votes()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.parliament_voting_schedules%rowtype; v public.parliament_votings%rowtype; old_actor text;
BEGIN
 old_actor:=current_setting('request.jwt.claim.sub',true);
 FOR s IN
   SELECT * FROM public.parliament_voting_schedules WHERE status='scheduled' AND starts_at<=clock_timestamp()
   ORDER BY starts_at,id FOR UPDATE SKIP LOCKED
 LOOP
  IF s.ends_at<=clock_timestamp() THEN
   UPDATE public.parliament_voting_schedules SET status='expired',changed_at=clock_timestamp() WHERE id=s.id;
   CONTINUE;
  END IF;
  BEGIN
   IF NOT (private.is_house_president(s.scheduled_by,s.house_id)
      OR public.is_admin(s.scheduled_by)
      OR private.is_senate_vice_bill_voting_authority(s.scheduled_by,s.house_id,s.bill_id))
   THEN RAISE EXCEPTION 'Autoridade da Casa não está mais vigente.'; END IF;
   PERFORM set_config('request.jwt.claim.sub',s.scheduled_by::text,true);
   PERFORM set_config('govrp.parliament_schedule_id',s.id::text,true);
   PERFORM set_config('govrp.parliament_schedule_end',s.ends_at::text,true);
   v:=public.start_parliament_bill_voting(s.bill_id,s.house_id,s.title,s.description);
   UPDATE public.parliament_voting_schedules SET status='started',voting_id=v.id,
     changed_at=clock_timestamp() WHERE id=s.id;
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'Agendamento % não abriu: %',s.id,SQLERRM;
   UPDATE public.parliament_voting_schedules SET status='cancelled',
     changed_at=clock_timestamp() WHERE id=s.id;
  END;
  PERFORM set_config('request.jwt.claim.sub',coalesce(old_actor,''),true);
  PERFORM set_config('govrp.parliament_schedule_id','',true);
  PERFORM set_config('govrp.parliament_schedule_end','',true);
 END LOOP;
END $function$;
