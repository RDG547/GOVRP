BEGIN;
ALTER TABLE public.executive_office_definitions ADD COLUMN government_bound boolean NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION private.end_government_appointments(p_government_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jsonb; item record; office public.executive_office_definitions%rowtype; restored_role text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 SELECT value INTO cfg FROM public.system_settings WHERE key='executive_governance' FOR UPDATE;
 IF cfg IS NULL THEN RETURN; END IF;
 FOR item IN SELECT key,value FROM jsonb_each(coalesce(cfg->'specialAppointments','{}')) LOOP
  SELECT * INTO office FROM public.executive_office_definitions WHERE office_key=item.key AND government_bound;
  IF office.office_key IS NULL OR item.value->>'government_id' IS DISTINCT FROM p_government_id::text THEN CONTINUE; END IF;
  restored_role:=CASE WHEN item.value->>'previous_role' IN ('Policial','Militar','Agente Secreto') THEN item.value->>'previous_role' ELSE 'Cidadão' END;
  UPDATE public.profiles SET role=restored_role,manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),
   titles=array_remove(coalesce(titles,'{}'),office.role_label)
   WHERE id=(item.value->>'user_id')::uuid AND role=office.role_label
    AND NOT(manual_role_override AND role_assigned_at>(item.value->>'appointed_at')::timestamptz+interval '1 second');
  cfg:=jsonb_set(cfg,'{specialAppointments}',(cfg->'specialAppointments')-item.key);
  INSERT INTO public.dou_entries(title,summary,content,type,source_id,legal_metadata)
  VALUES('Encerramento de nomeação: '||office.role_label,p_reason,p_reason,'Nomeacao e Exoneracao',gen_random_uuid(),jsonb_build_object('government_id',p_government_id,'office_key',item.key,'appointment',item.value));
  PERFORM economy_private.audit('executive_appointment_ended','government',p_government_id::text,item.value,NULL,p_reason,auth.uid());
 END LOOP;
 UPDATE public.system_settings SET value=cfg WHERE key='executive_governance';
END; $$;
REVOKE ALL ON FUNCTION private.end_government_appointments(uuid,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.manage_executive_appointment(p_office_key text, p_user_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb; office public.executive_office_definitions%rowtype; previous jsonb; target public.profiles%rowtype; entry jsonb; event_id uuid:=gen_random_uuid();
begin
 if coalesce(public.get_user_role(auth.uid()),'') not in ('Presidente','Admin') then raise exception 'A nomeação exige autoridade presidencial.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 select * into office from public.executive_office_definitions where office_key=p_office_key;
 if not found then raise exception 'Escolha um cargo executivo válido.'; end if;
 select coalesce(value,'{}') into cfg from public.system_settings where key='executive_governance' for update;
 cfg:=coalesce(cfg,'{}');previous:=cfg->'specialAppointments'->p_office_key;
 if p_user_id is not null then
   select * into target from public.profiles where id=p_user_id and (onboarding_completed or onboarding_mode='legacy_migration') and deleted_at is null for update;
   if not found or not private.is_executive_candidate(p_user_id,p_office_key) then raise exception 'Escolha um cidadão elegível para a nomeação.'; end if;
   if previous->>'user_id'=p_user_id::text then return previous; end if;
   if exists(select 1 from jsonb_each(coalesce(cfg->'specialAppointments','{}')) a where a.key<>p_office_key and a.value->>'user_id'=p_user_id::text) then raise exception 'Este cidadão já ocupa outra nomeação estratégica.'; end if;
 end if;
 if previous->>'user_id' is not null then
   update public.profiles set role=coalesce(previous->>'previous_role','Cidadão'),manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),updated_at=clock_timestamp() where id=(previous->>'user_id')::uuid and role=office.role_label;
 end if;
 if p_user_id is null then cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')-p_office_key);
 else
   entry:=jsonb_build_object('user_id',p_user_id,'appointed_at',clock_timestamp(),'appointed_by',auth.uid(),'previous_role',target.role,'note',p_note,'government_id',(select id from public.government_terms where ended_at is null));
   cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')||jsonb_build_object(p_office_key,entry));
   update public.profiles set role=office.role_label,manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),updated_at=clock_timestamp() where id=p_user_id;
 end if;
 insert into public.system_settings(key,value) values('executive_governance',cfg) on conflict(key) do update set value=excluded.value;
 insert into public.dou_entries(title,summary,content,type,source_id,legal_metadata)
 values(case when p_user_id is null then 'Exoneração: ' else 'Nomeação: ' end||office.role_label,
   case when p_user_id is null then 'O cargo foi desocupado.' else target.full_name||' assume o cargo.' end,
   coalesce(p_note,''),'Nomeacao e Exoneracao',event_id,jsonb_build_object('office_key',p_office_key,'actor_id',auth.uid(),'user_id',p_user_id,'previous',previous));
 perform economy_private.audit('executive_appointment_changed','system_settings',p_office_key,previous,entry,coalesce(p_note,'Nomeação executiva.'),auth.uid());
 return coalesce(entry,'{}');
end; $function$;
CREATE OR REPLACE FUNCTION public.promote_vice_president_when_presidency_empty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g public.government_terms%rowtype; a public.election_office_assignments%rowtype; successor uuid; cfg jsonb; reason text; new_start timestamptz; new_end timestamptz;
BEGIN
 IF current_setting('govrp.executive_transition',true)='replacing' THEN RETURN new; END IF;
 IF new.role<>'Presidente' AND old.role<>'Presidente' THEN RETURN new; END IF;
 IF new.role=old.role AND new.role_assigned_at IS NOT DISTINCT FROM old.role_assigned_at THEN RETURN new; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 SELECT * INTO g FROM public.government_terms WHERE ended_at IS NULL FOR UPDATE;
 IF new.role='Presidente' THEN
  IF current_setting('govrp.succession_head',true)=new.id::text THEN RETURN new; END IF;
  SELECT * INTO a FROM public.election_office_assignments WHERE NOT new.manual_role_override AND profile_id=new.id AND office_role='Presidente' AND status='active' AND term_ends_at>clock_timestamp() ORDER BY assigned_at DESC LIMIT 1;
  IF g.head_id=new.id AND g.election_id IS NOT DISTINCT FROM a.election_id AND NOT g.is_interim AND old.role='Presidente' AND NOT new.manual_role_override THEN RETURN new; END IF;
  PERFORM set_config('govrp.executive_transition','replacing',true);
  IF g.id IS NOT NULL THEN
   PERFORM private.end_government_cabinet(g.id,'Encerramento do gabinete pela posse de novo Governo.'); PERFORM private.end_government_appointments(g.id,'Encerramento do gabinete pela posse de novo Governo.');
   UPDATE public.government_terms SET ended_at=clock_timestamp() WHERE id=g.id;
   UPDATE public.presidential_formation SET ended_at=clock_timestamp(),status='invalidated' WHERE ended_at IS NULL AND government_id=g.id;
  ELSE PERFORM private.end_government_cabinet(NULL,'Encerramento do gabinete anterior à posse do novo Governo.'); PERFORM private.end_government_appointments(NULL,'Encerramento do gabinete anterior à posse do novo Governo.'); END IF;
  UPDATE public.election_office_assignments SET status='revoked',ended_at=clock_timestamp(),metadata=metadata||jsonb_build_object('reason','Posse de novo Governo')
   WHERE office_role IN ('Presidente','Vice-Presidente') AND status='active' AND profile_id<>new.id AND (a.election_id IS NULL OR election_id<>a.election_id);
  UPDATE public.profiles SET role='Cidadão',manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),
   titles=array_remove(array_remove(coalesce(titles,'{}'),'Presidente'),'Vice-Presidente')
   WHERE role IN ('Presidente','Vice-Presidente') AND id<>new.id AND deleted_at IS NULL;
  SELECT value INTO cfg FROM public.system_settings WHERE key='executive_transition_rules';
  new_start:=coalesce((select original.term_starts_at from public.elections e join public.government_terms original on original.id=e.government_id where e.id=a.election_id and e.extraordinary),a.term_starts_at,clock_timestamp());
  new_end:=coalesce(a.term_ends_at,new_start+make_interval(days=>greatest(1,coalesce((cfg->>'administrative_term_days')::integer,30))));
  INSERT INTO public.government_terms(original_president_id,head_id,election_id,term_starts_at,term_ends_at,source,leadership_history)
  VALUES(new.id,new.id,a.election_id,new_start,new_end,CASE WHEN a.id IS NULL THEN 'administrative' ELSE 'election' END,
   jsonb_build_array(jsonb_build_object('head_id',new.id,'at',clock_timestamp(),'actor_id',auth.uid(),'reason','Posse de novo Governo')));
  PERFORM set_config('govrp.executive_transition','',true);
 ELSE
  IF g.head_id IS DISTINCT FROM old.id THEN RETURN new; END IF;
  reason:=coalesce(nullif(current_setting('govrp.role_change_reason',true),''),'Vacância presidencial');
  UPDATE public.election_office_assignments SET status='revoked',ended_at=clock_timestamp(),metadata=metadata||jsonb_build_object('reason',reason)
   WHERE profile_id=old.id AND office_role='Presidente' AND status='active';
  IF g.term_ends_at<=clock_timestamp() THEN
   PERFORM private.end_government_cabinet(g.id,'Encerramento normal do mandato presidencial.'); PERFORM private.end_government_appointments(g.id,'Encerramento normal do mandato presidencial.');
   UPDATE public.government_terms SET ended_at=clock_timestamp() WHERE id=g.id;
   RETURN new;
  END IF;
  SELECT id INTO successor FROM public.profiles WHERE role='Vice-Presidente' AND deleted_at IS NULL AND id<>old.id ORDER BY role_assigned_at DESC NULLS LAST,id LIMIT 1 FOR UPDATE;
  IF successor IS NOT NULL THEN
   UPDATE public.government_terms SET head_id=successor,is_interim=false,source='vice_succession',cabinet_decision='pending',
    leadership_history=leadership_history||jsonb_build_array(jsonb_build_object('head_id',successor,'previous_head_id',old.id,'at',clock_timestamp(),'reason',reason)) WHERE id=g.id;
   UPDATE public.election_office_assignments SET status='revoked',ended_at=clock_timestamp() WHERE profile_id=successor AND status='active';
   IF g.election_id IS NOT NULL THEN
    INSERT INTO public.election_office_assignments(election_id,profile_id,office_role,votes_received,term_starts_at,term_ends_at,assigned_by,metadata)
    VALUES(g.election_id,successor,'Presidente',0,clock_timestamp(),g.term_ends_at,auth.uid(),jsonb_build_object('succession',true,'former_president_id',old.id))
    ON CONFLICT(election_id,profile_id,office_role) DO UPDATE SET status='active',ended_at=NULL,term_ends_at=excluded.term_ends_at,metadata=excluded.metadata;
   END IF;
   PERFORM set_config('govrp.succession_head',successor::text,true);
   UPDATE public.profiles SET role='Presidente',manual_role_override=(g.election_id IS NULL),role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),
    titles=array_remove(coalesce(titles,'{}'),'Vice-Presidente') WHERE id=successor;
   PERFORM set_config('govrp.succession_head','',true);
  ELSE PERFORM private.assign_interim_president(g.id,reason); END IF;
  PERFORM public.justice_write_audit('executive.succession','government',g.id,to_jsonb(g),jsonb_build_object('successor_id',successor),reason);
 END IF;
 PERFORM private.refresh_office_assignment_snapshot();
 RETURN new;
END; $function$;
CREATE OR REPLACE FUNCTION private.maintain_government_term()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g public.government_terms%rowtype;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 SELECT * INTO g FROM public.government_terms WHERE ended_at IS NULL FOR UPDATE;
 IF g.id IS NULL THEN RETURN; END IF;
 IF g.term_ends_at<=clock_timestamp() THEN
  PERFORM set_config('govrp.executive_transition','replacing',true);
  PERFORM private.end_government_cabinet(g.id,'Encerramento normal do Governo.'); PERFORM private.end_government_appointments(g.id,'Encerramento normal do Governo.');
  UPDATE public.government_terms SET ended_at=clock_timestamp() WHERE id=g.id;
  UPDATE public.profiles SET role='Cidadão',manual_role_override=false,role_assigned_at=clock_timestamp(),
   titles=array_remove(array_remove(coalesce(titles,'{}'),'Presidente'),'Vice-Presidente')
   WHERE (id=g.head_id AND role='Presidente') OR (role='Vice-Presidente' AND deleted_at IS NULL);
  UPDATE public.presidential_formation SET ended_at=clock_timestamp(),status='invalidated' WHERE government_id=g.id AND ended_at IS NULL;
  PERFORM set_config('govrp.executive_transition','',true);
 ELSIF g.is_interim AND NOT coalesce(public.is_acting_president(g.head_id),false) THEN
  PERFORM private.assign_interim_president(g.id,'Atualização da chefia interina após mudança na Presidência da Câmara.');
 END IF;
END; $function$;

CREATE OR REPLACE FUNCTION private.assign_interim_president(p_government_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g public.government_terms%rowtype; chair uuid; cfg jsonb; election_mode text; deadline_hours integer;
BEGIN
 SELECT * INTO g FROM public.government_terms WHERE id=p_government_id AND ended_at IS NULL FOR UPDATE;
 IF g.id IS NULL OR g.term_ends_at<=clock_timestamp() THEN RETURN; END IF;
 SELECT m.user_id INTO chair FROM public.parliament_members m JOIN public.parliament_houses h ON h.id=m.house_id
 WHERE lower(h.name) LIKE '%câmara%' AND private.is_house_president(m.user_id,h.id)
 ORDER BY m.term_end_date DESC,m.id LIMIT 1;
 SELECT value INTO cfg FROM public.system_settings WHERE key='executive_transition_rules';
 election_mode:=CASE WHEN coalesce(g.vacancy_at,clock_timestamp()) < g.term_starts_at+(g.term_ends_at-g.term_starts_at)/2 THEN 'direct' ELSE 'indirect' END;
 deadline_hours:=CASE WHEN election_mode='direct' THEN coalesce((cfg->>'direct_call_hours')::integer,72) ELSE coalesce((cfg->>'indirect_call_hours')::integer,24) END;
 IF g.head_id IS NOT DISTINCT FROM chair AND g.is_interim THEN RETURN; END IF;
 UPDATE public.government_terms SET head_id=chair,is_interim=true,source='double_vacancy',cabinet_decision='pending',
  vacancy_at=coalesce(vacancy_at,clock_timestamp()),extraordinary_mode=election_mode,
  call_deadline=coalesce(call_deadline,least(coalesce(g.vacancy_at,clock_timestamp())+make_interval(hours=>greatest(1,deadline_hours)),term_ends_at)),
  leadership_history=leadership_history||jsonb_build_array(jsonb_build_object('head_id',chair,'previous_head_id',g.head_id,'at',clock_timestamp(),'reason',p_reason,'interim',true)) WHERE id=g.id;
 IF chair IS NOT NULL THEN
  UPDATE public.presidential_formation SET ended_at=clock_timestamp(),status='invalidated' WHERE ended_at IS NULL AND user_id=chair;
  INSERT INTO public.presidential_formation(user_id,government_id) VALUES(chair,g.id);
  INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(chair,'institutional_result',
   'Você exerce interinamente a Presidência por dupla vacância, mantendo seu mandato e a Presidência da Câmara. Convoque a eleição extraordinária.',
   '/dashboard/president',jsonb_build_object('government_id',g.id,'popup_pending',true,'title','Presidência interina','election_mode',election_mode));
 END IF;
 PERFORM public.justice_write_audit('executive.interim','government',g.id,to_jsonb(g),jsonb_build_object('head_id',chair,'mode',election_mode),p_reason);
END; $function$;

-- Recover a known unfinished historical mandate without reinstating either former holder.
-- The existing Chamber chair exercises interim authority; all previous Admin role changes remain intact.
DO $bootstrap$
DECLARE a public.election_office_assignments%rowtype; g uuid; vacancy timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.government_terms WHERE ended_at IS NULL) AND
    NOT EXISTS(SELECT 1 FROM public.profiles WHERE role='Presidente' AND deleted_at IS NULL) THEN
  SELECT * INTO a FROM public.election_office_assignments WHERE office_role='Presidente'
   AND term_starts_at<=clock_timestamp() AND term_ends_at>clock_timestamp()
   ORDER BY term_starts_at DESC,assigned_at DESC LIMIT 1;
  IF a.id IS NOT NULL THEN
   SELECT coalesce((value->'officeVacancy'->>'since')::timestamptz,a.ended_at,clock_timestamp()) INTO vacancy FROM public.system_settings WHERE key='executive_governance';
   INSERT INTO public.government_terms(original_president_id,election_id,term_starts_at,term_ends_at,source,vacancy_at,leadership_history)
   VALUES(a.profile_id,a.election_id,a.term_starts_at,a.term_ends_at,'legacy_vacancy',greatest(a.term_starts_at,coalesce(vacancy,clock_timestamp())),
    jsonb_build_array(jsonb_build_object('reason','Vínculo do mandato histórico em dupla vacância','former_president_id',a.profile_id,'at',clock_timestamp()))) RETURNING id INTO g;
   UPDATE public.ministers SET government_id=g WHERE status='active' AND government_id IS NULL;
   PERFORM private.assign_interim_president(g,'Continuidade institucional do mandato em dupla vacância.');
  ELSE
   PERFORM private.end_government_cabinet(NULL,'Encerramento de gabinete legado sem mandato presidencial vigente.');
   PERFORM private.end_government_appointments(NULL,'Encerramento de vínculos executivos sem Governo vigente.');
  END IF;
 END IF;
 SELECT id INTO g FROM public.government_terms WHERE ended_at IS NULL;
 IF g IS NOT NULL THEN
  UPDATE public.system_settings SET value=jsonb_set(value,'{specialAppointments}',
   (SELECT coalesce(jsonb_object_agg(key,item||jsonb_build_object('government_id',g)),'{}') FROM jsonb_each(coalesce(value->'specialAppointments','{}')) pair(key,item)))
   WHERE key='executive_governance';
 END IF;
END $bootstrap$;
NOTIFY pgrst,'reload schema';
COMMIT;
