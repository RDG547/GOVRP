BEGIN;
CREATE TABLE public.government_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_president_id uuid REFERENCES public.profiles(id),
  head_id uuid REFERENCES public.profiles(id),
  election_id uuid REFERENCES public.elections(id),
  term_starts_at timestamptz NOT NULL,
  term_ends_at timestamptz NOT NULL,
  ended_at timestamptz,
  is_interim boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'administrative',
  cabinet_decision text NOT NULL DEFAULT 'new' CHECK (cabinet_decision IN ('new','pending','kept','reformed')),
  vacancy_at timestamptz,
  extraordinary_mode text CHECK (extraordinary_mode IN ('direct','indirect')),
  call_deadline timestamptz,
  extraordinary_election_id uuid REFERENCES public.elections(id),
  leadership_history jsonb NOT NULL DEFAULT '[]',
  CHECK (term_ends_at > term_starts_at)
);
CREATE UNIQUE INDEX government_one_active_idx ON public.government_terms ((true)) WHERE ended_at IS NULL;
ALTER TABLE public.government_terms ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.government_terms TO authenticated;
CREATE POLICY government_public_history ON public.government_terms FOR SELECT TO authenticated USING (true);
ALTER TABLE public.ministers ADD COLUMN government_id uuid REFERENCES public.government_terms(id);
ALTER TABLE public.presidential_formation ADD COLUMN government_id uuid REFERENCES public.government_terms(id);
CREATE INDEX ministers_government_idx ON public.ministers(government_id) WHERE status='active';
INSERT INTO public.system_settings(key,value,description) VALUES ('executive_transition_rules',
 '{"direct_call_hours":72,"indirect_call_hours":24,"candidacy_hours":12,"voting_hours":12,"indirect_quorum_numerator":1,"indirect_quorum_denominator":2,"administrative_term_days":30}',
 'Prazos reais das eleições extraordinárias e do mandato administrativo.') ON CONFLICT DO NOTHING;

-- Link the cabinet that is already in office without changing any person's role.
INSERT INTO public.government_terms(original_president_id,head_id,election_id,term_starts_at,term_ends_at,source)
SELECT p.id,p.id,a.election_id,coalesce(a.term_starts_at,p.role_assigned_at,clock_timestamp()),
 coalesce(a.term_ends_at,coalesce(p.role_assigned_at,clock_timestamp())+interval '30 days'),'existing'
FROM public.profiles p LEFT JOIN LATERAL (SELECT * FROM public.election_office_assignments a
 WHERE a.profile_id=p.id AND a.office_role='Presidente' AND a.status='active' AND a.term_ends_at>clock_timestamp()
 ORDER BY a.assigned_at DESC LIMIT 1) a ON true
WHERE p.role='Presidente' AND p.deleted_at IS NULL ORDER BY p.role_assigned_at DESC NULLS LAST LIMIT 1;
UPDATE public.ministers SET government_id=(SELECT id FROM public.government_terms WHERE ended_at IS NULL) WHERE status='active';
UPDATE public.presidential_formation SET government_id=(SELECT id FROM public.government_terms WHERE ended_at IS NULL) WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION public.is_acting_president(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.government_terms g JOIN public.parliament_members m ON m.user_id=g.head_id
 JOIN public.parliament_houses h ON h.id=m.house_id
 WHERE g.head_id=p_user_id AND g.ended_at IS NULL AND g.is_interim AND g.term_ends_at>now()
 AND lower(h.name) LIKE '%câmara%' AND private.is_house_president(p_user_id,h.id));
$$;
REVOKE ALL ON FUNCTION public.is_acting_president(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_acting_president(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN public.is_acting_president(p.id) THEN 'Presidente' ELSE p.role END
 FROM public.profiles p WHERE p.id=p_user_id AND p.deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION private.end_government_cabinet(p_government_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ministers%rowtype;
BEGIN
 FOR m IN SELECT * FROM public.ministers WHERE status='active' AND (government_id=p_government_id OR (government_id IS NULL AND p_government_id IS NULL)) FOR UPDATE LOOP
  UPDATE public.ministers SET status='dismissed',ended_at=clock_timestamp() WHERE id=m.id;
  UPDATE public.profiles SET role='Cidadão',manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),
   titles=array_remove(coalesce(titles,'{}'),'Ministro') WHERE id=m.user_id AND role='Ministro';
  INSERT INTO public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id,metadata)
  VALUES(m.user_id,m.ministry_id,'dismissed',p_reason,auth.uid(),jsonb_build_object('government_id',m.government_id,'appointment',to_jsonb(m)));
  INSERT INTO public.dou_entries(title,summary,content,type,source_id,legal_metadata)
  VALUES('Encerramento ministerial: '||m.ministry,p_reason,p_reason,'Nomeacao e Exoneracao',gen_random_uuid(),jsonb_build_object('government_id',m.government_id,'minister_id',m.user_id));
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION private.end_government_cabinet(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.assign_interim_president(p_government_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  call_deadline=coalesce(call_deadline,least(clock_timestamp()+make_interval(hours=>greatest(1,deadline_hours)),term_ends_at)),
  leadership_history=leadership_history||jsonb_build_array(jsonb_build_object('head_id',chair,'previous_head_id',g.head_id,'at',clock_timestamp(),'reason',p_reason,'interim',true)) WHERE id=g.id;
 IF chair IS NOT NULL THEN
  UPDATE public.presidential_formation SET ended_at=clock_timestamp(),status='invalidated' WHERE ended_at IS NULL AND user_id=chair;
  INSERT INTO public.presidential_formation(user_id,government_id) VALUES(chair,g.id);
  INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(chair,'institutional_result',
   'Você exerce interinamente a Presidência por dupla vacância, mantendo seu mandato e a Presidência da Câmara. Convoque a eleição extraordinária.',
   '/dashboard/president',jsonb_build_object('government_id',g.id,'popup_pending',true,'title','Presidência interina','election_mode',election_mode));
 END IF;
 PERFORM public.justice_write_audit('executive.interim','government',g.id,to_jsonb(g),jsonb_build_object('head_id',chair,'mode',election_mode),p_reason);
END; $$;
REVOKE ALL ON FUNCTION private.assign_interim_president(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.promote_vice_president_when_presidency_empty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  IF g.head_id=new.id AND g.election_id IS NOT DISTINCT FROM a.election_id AND NOT g.is_interim AND old.role='Presidente' THEN RETURN new; END IF;
  PERFORM set_config('govrp.executive_transition','replacing',true);
  IF g.id IS NOT NULL THEN
   PERFORM private.end_government_cabinet(g.id,'Encerramento do gabinete pela posse de novo Governo.');
   UPDATE public.government_terms SET ended_at=clock_timestamp() WHERE id=g.id;
   UPDATE public.presidential_formation SET ended_at=clock_timestamp(),status='invalidated' WHERE ended_at IS NULL AND government_id=g.id;
  ELSE PERFORM private.end_government_cabinet(NULL,'Encerramento do gabinete anterior à posse do novo Governo.'); END IF;
  UPDATE public.election_office_assignments SET status='revoked',ended_at=clock_timestamp(),metadata=metadata||jsonb_build_object('reason','Posse de novo Governo')
   WHERE office_role IN ('Presidente','Vice-Presidente') AND status='active' AND profile_id<>new.id AND (a.election_id IS NULL OR election_id<>a.election_id);
  UPDATE public.profiles SET role='Cidadão',manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),
   titles=array_remove(array_remove(coalesce(titles,'{}'),'Presidente'),'Vice-Presidente')
   WHERE role IN ('Presidente','Vice-Presidente') AND id<>new.id AND deleted_at IS NULL;
  SELECT value INTO cfg FROM public.system_settings WHERE key='executive_transition_rules';
  new_start:=coalesce(a.term_starts_at,clock_timestamp());
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
   PERFORM private.end_government_cabinet(g.id,'Encerramento normal do mandato presidencial.');
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
END; $$;
DROP TRIGGER promote_vice_president_when_presidency_empty_trigger ON public.profiles;
CREATE TRIGGER promote_vice_president_when_presidency_empty_trigger AFTER UPDATE OF role,role_assigned_at ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION public.promote_vice_president_when_presidency_empty();

CREATE OR REPLACE FUNCTION private.start_presidential_formation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g uuid;
BEGIN
 IF new.role='Presidente' AND (old.role IS DISTINCT FROM new.role OR new.role_assigned_at IS DISTINCT FROM old.role_assigned_at) THEN
  SELECT id INTO g FROM public.government_terms WHERE ended_at IS NULL AND head_id=new.id;
  IF EXISTS(SELECT 1 FROM public.presidential_formation WHERE user_id=new.id AND government_id=g AND ended_at IS NULL) THEN RETURN new; END IF;
  UPDATE public.presidential_formation SET ended_at=clock_timestamp(),status='invalidated' WHERE user_id=new.id AND ended_at IS NULL;
  INSERT INTO public.presidential_formation(user_id,government_id) VALUES(new.id,g);
 ELSIF old.role='Presidente' AND new.role<>'Presidente' THEN
  UPDATE public.presidential_formation SET ended_at=clock_timestamp(),status='invalidated' WHERE user_id=new.id AND ended_at IS NULL;
 END IF;
 RETURN new;
END; $$;

CREATE OR REPLACE FUNCTION public.get_executive_state() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('government',to_jsonb(g),'head',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'full_name',p.full_name,'avatar_url',p.avatar_url,'role',p.role) END,
 'vice',(SELECT jsonb_build_object('id',v.id,'full_name',v.full_name,'avatar_url',v.avatar_url,'role',v.role) FROM public.profiles v WHERE v.role='Vice-Presidente' AND v.deleted_at IS NULL ORDER BY v.role_assigned_at DESC LIMIT 1),
 'is_interim',coalesce(g.is_interim,false),'authorized',coalesce(public.get_user_role(auth.uid()) IN ('Presidente','Admin'),false))
 FROM (SELECT 1) seed LEFT JOIN public.government_terms g ON g.ended_at IS NULL AND g.term_ends_at>now()
 LEFT JOIN public.profiles p ON p.id=g.head_id AND p.deleted_at IS NULL AND (p.role='Presidente' OR public.is_acting_president(p.id));
$$;
REVOKE ALL ON FUNCTION public.get_executive_state() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_executive_state() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.choose_government_cabinet(p_choice text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.government_terms%rowtype;
BEGIN
 IF auth.uid() IS NULL OR coalesce(public.get_user_role(auth.uid()),'')<>'Presidente' THEN RAISE EXCEPTION 'Somente a chefia do Governo pode escolher a equipe.' USING errcode='42501'; END IF;
 IF p_choice NOT IN ('keep','reform') OR p_choice IS NULL THEN RAISE EXCEPTION 'Escolha manter a equipe ou formar uma nova.'; END IF;
 SELECT * INTO g FROM public.government_terms WHERE ended_at IS NULL AND head_id=auth.uid() FOR UPDATE;
 IF g.id IS NULL THEN RAISE EXCEPTION 'Não há Governo ativo sob sua chefia.'; END IF;
 IF g.cabinet_decision<>'pending' THEN RETURN to_jsonb(g); END IF;
 IF p_choice='reform' THEN PERFORM private.end_government_cabinet(g.id,'Reforma ministerial decidida pela nova chefia do Governo.');
 ELSE
  INSERT INTO public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id,metadata)
  SELECT user_id,ministry_id,'retained','Equipe mantida após sucessão presidencial.',auth.uid(),jsonb_build_object('government_id',g.id,'head_id',g.head_id)
  FROM public.ministers WHERE government_id=g.id AND status='active';
  UPDATE public.presidential_formation SET status='completed',completed_at=clock_timestamp() WHERE government_id=g.id AND user_id=auth.uid() AND ended_at IS NULL;
 END IF;
 UPDATE public.government_terms SET cabinet_decision=CASE WHEN p_choice='keep' THEN 'kept' ELSE 'reformed' END WHERE id=g.id RETURNING * INTO g;
 PERFORM public.justice_write_audit('executive.cabinet_choice','government',g.id,NULL,to_jsonb(g),'Escolha ministerial após sucessão.');
 RETURN to_jsonb(g);
END; $$;
REVOKE ALL ON FUNCTION public.choose_government_cabinet(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.choose_government_cabinet(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resign_presidency() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='Presidente') THEN
  RETURN json_build_object('success',false,'message','Somente o Presidente titular pode renunciar por esta ação.'); END IF;
 PERFORM set_config('govrp.role_change_reason','Renúncia à Presidência',true);
 UPDATE public.profiles SET role='Cidadão',manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),titles=array_remove(coalesce(titles,'{}'),'Presidente') WHERE id=auth.uid();
 RETURN json_build_object('success',true,'message','Renúncia registrada. A sucessão foi processada e o histórico foi preservado.');
END; $$;
REVOKE ALL ON FUNCTION public.resign_presidency() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resign_presidency() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_presidential_formation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.presidential_formation%rowtype; offices jsonb; ministries jsonb; cfg jsonb; remaining integer;
begin
 if auth.uid() is null or coalesce(public.get_user_role(auth.uid()),'')<>'Presidente' then return null; end if;
 insert into public.presidential_formation(user_id,government_id) select auth.uid(),id from public.government_terms where ended_at is null and head_id=auth.uid() on conflict do nothing;
 select * into f from public.presidential_formation where user_id=auth.uid() and ended_at is null for update;
 select value into cfg from public.system_settings where key='executive_governance';
 select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('appointment',cfg->'specialAppointments'->o.office_key) order by sort_order),'[]') into offices from public.executive_office_definitions o where required_for_formation;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'holder_id',a.user_id) order by m.name),'[]') into ministries
 from public.government_ministries m left join lateral (select user_id from public.ministers where ministry_id=m.id and status='active' order by appointed_at desc limit 1) a on true where m.is_active;
 select count(*) into remaining from jsonb_array_elements(offices) o where o->'appointment'->>'user_id' is null;
 remaining:=remaining+(select count(*) from jsonb_array_elements(ministries) m where m->>'holder_id' is null);
 if f.status='pending' then update public.presidential_formation set status='in_progress' where id=f.id returning * into f; end if;
 return to_jsonb(f)||jsonb_build_object('offices',offices,'ministries',ministries,'remaining',remaining,'government',(select to_jsonb(g) from public.government_terms g where g.ended_at is null and g.head_id=auth.uid()));
end; $function$
;

CREATE OR REPLACE FUNCTION public.appoint_minister(p_user_id uuid, p_ministry text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); ministry public.government_ministries%rowtype; current_holder uuid; result public.ministers%rowtype;
begin
  if coalesce(public.get_user_role(actor),'') not in('Presidente','Admin') then return json_build_object('success',false,'message','Apenas a Presidência pode nomear ministros.'); end if;
  perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
  if not exists(select 1 from public.government_terms where ended_at is null and term_ends_at>clock_timestamp()) then return json_build_object('success',false,'message','Não há Governo ativo para receber esta nomeação.');end if;
  perform 1 from public.profiles where id=p_user_id for update;
  if not private.is_executive_candidate(p_user_id,'minister') then return json_build_object('success',false,'message','Este cidadão não está elegível para a nomeação ministerial.'); end if;
  select * into ministry from public.government_ministries where name=p_ministry and is_active for update;
  if not found then return json_build_object('success',false,'message','Ministério inexistente ou inativo.'); end if;
  select user_id into current_holder from public.ministers where ministry_id=ministry.id and status='active' for update;
  if current_holder is not null and current_holder<>p_user_id then
    update public.ministers set status='dismissed',ended_at=clock_timestamp() where user_id=current_holder;
    update public.profiles set role='Cidadão',manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=actor,titles=array_remove(coalesce(titles,'{}'),'Ministro') where id=current_holder and role='Ministro';
    insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id) values(current_holder,ministry.id,'dismissed','Exoneração por substituição ministerial.',actor);
  end if;
  insert into public.ministers(user_id,ministry,ministry_id,appointed_by,status,appointed_at,ended_at,government_id)
  values(p_user_id,ministry.name,ministry.id,actor,'active',clock_timestamp(),null,(select id from public.government_terms where ended_at is null))
  on conflict(user_id) do update set ministry=excluded.ministry,ministry_id=excluded.ministry_id,appointed_by=actor,status='active',appointed_at=clock_timestamp(),ended_at=null,government_id=excluded.government_id
  returning * into result;
  update public.profiles set role='Ministro',role_assigned_at=clock_timestamp(),role_assigned_by=actor where id=p_user_id;
  insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id) values(p_user_id,ministry.id,'appointed','Nomeação para '||ministry.name||'.',actor);
  perform public.apply_government_impact('politics','minister_appointed','Nomeação ministerial realizada.',.2,0,'ministers',result.id::text,jsonb_build_object('ministerId',p_user_id,'ministry',ministry.name));
  return json_build_object('success',true,'message','Ministro nomeado com sucesso.','minister',to_jsonb(result));
end; $function$
;

CREATE OR REPLACE FUNCTION public.dismiss_minister(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); result public.ministers%rowtype;
begin
  if coalesce(public.get_user_role(actor),'') not in('Presidente','Admin') then return json_build_object('success',false,'message','Apenas a Presidência pode exonerar ministros.'); end if;
  update public.ministers set status='dismissed',ended_at=clock_timestamp() where user_id=p_user_id and status='active' returning * into result;
  if result.id is null then return json_build_object('success',false,'message','Ministro ativo não encontrado.'); end if;
  update public.profiles set role='Cidadão',manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=actor,titles=array_remove(coalesce(titles,'{}'),'Ministro') where id=p_user_id and role='Ministro';
  insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id) values(p_user_id,result.ministry_id,'dismissed','Exoneração de '||result.ministry||'.',actor);
  perform public.apply_government_impact('politics','minister_dismissed','Exoneração ministerial.',-.3,0,'ministers',result.id::text,jsonb_build_object('ministerId',p_user_id,'ministry',result.ministry));
  return json_build_object('success',true,'message','Ministro exonerado com sucesso.');
end; $function$
;

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
   entry:=jsonb_build_object('user_id',p_user_id,'appointed_at',clock_timestamp(),'appointed_by',auth.uid(),'previous_role',target.role,'note',p_note);
   cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')||jsonb_build_object(p_office_key,entry));
   update public.profiles set role=office.role_label,updated_at=clock_timestamp() where id=p_user_id;
 end if;
 insert into public.system_settings(key,value) values('executive_governance',cfg) on conflict(key) do update set value=excluded.value;
 insert into public.dou_entries(title,summary,content,type,source_id,legal_metadata)
 values(case when p_user_id is null then 'Exoneração: ' else 'Nomeação: ' end||office.role_label,
   case when p_user_id is null then 'O cargo foi desocupado.' else target.full_name||' assume o cargo.' end,
   coalesce(p_note,''),'Nomeacao e Exoneracao',event_id,jsonb_build_object('office_key',p_office_key,'actor_id',auth.uid(),'user_id',p_user_id,'previous',previous));
 perform economy_private.audit('executive_appointment_changed','system_settings',p_office_key,previous,entry,coalesce(p_note,'Nomeação executiva.'),auth.uid());
 return coalesce(entry,'{}');
end; $function$
;

CREATE OR REPLACE FUNCTION public.economic_has_role(p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (public.is_acting_president(auth.uid()) and 'presidente'=any(select lower(unnest(p_roles)))) or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        lower(p.role) = any (
          select lower(unnest(p_roles))
        )
        or exists (
          select 1
          from unnest(coalesce(p.titles, array[]::text[])) title
          where lower(title) = any (
            select lower(unnest(p_roles))
          )
        )
        or (
          (
            lower(p.role) = 'presidente do banco nacional'
            or exists (
              select 1
              from unnest(coalesce(p.titles, array[]::text[])) title
              where lower(title) = 'presidente do banco nacional'
            )
          )
          and exists (
            select 1
            from unnest(p_roles) requested_role
            where lower(requested_role) in ('banco central', 'presidente do banco central')
          )
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.justice_has_role(p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select (public.is_acting_president(auth.uid()) and 'presidente'=any(select lower(unnest(p_roles)))) or exists(select 1 from public.profiles p cross join lateral unnest(array[p.role]||coalesce(p.titles,'{}')) r
 cross join lateral unnest(public.official_role_capabilities(r)) cap
 where p.id=(select auth.uid()) and p.deleted_at is null and lower(cap)=any(select lower(unnest(p_roles))));
$function$
;

CREATE OR REPLACE FUNCTION private.maintain_government_term() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.government_terms%rowtype;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 SELECT * INTO g FROM public.government_terms WHERE ended_at IS NULL FOR UPDATE;
 IF g.id IS NULL THEN RETURN; END IF;
 IF g.term_ends_at<=clock_timestamp() THEN
  PERFORM set_config('govrp.executive_transition','replacing',true);
  PERFORM private.end_government_cabinet(g.id,'Encerramento normal do Governo.');
  UPDATE public.government_terms SET ended_at=clock_timestamp() WHERE id=g.id;
  UPDATE public.profiles SET role='Cidadão',manual_role_override=false,role_assigned_at=clock_timestamp(),
   titles=array_remove(array_remove(coalesce(titles,'{}'),'Presidente'),'Vice-Presidente')
   WHERE (id=g.head_id AND role='Presidente') OR (role='Vice-Presidente' AND deleted_at IS NULL);
  UPDATE public.presidential_formation SET ended_at=clock_timestamp(),status='invalidated' WHERE government_id=g.id AND ended_at IS NULL;
  PERFORM set_config('govrp.executive_transition','',true);
 ELSIF g.is_interim AND NOT coalesce(public.is_acting_president(g.head_id),false) THEN
  PERFORM private.assign_interim_president(g.id,'Atualização da chefia interina após mudança na Presidência da Câmara.');
 END IF;
END; $$;
REVOKE ALL ON FUNCTION private.maintain_government_term() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('govrp-government-term','* * * * *','select private.maintain_government_term()');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='government_terms') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.government_terms;
 END IF;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
