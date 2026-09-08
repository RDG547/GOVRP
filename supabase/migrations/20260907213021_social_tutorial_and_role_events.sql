-- Public social content remains separate from private account/profile data.
CREATE OR REPLACE FUNCTION public.get_stories_by_user_ids(p_user_ids uuid[] DEFAULT NULL)
RETURNS TABLE(user_id uuid,author_username text,author_avatar text,stories jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.id,coalesce(nullif(p.x_username,''),p.full_name,p.username),coalesce(p.x_avatar_url,p.avatar_url),
   jsonb_agg(jsonb_build_object('id',s.id,'media_url',s.media_url,'media_type',s.media_type,
     'created_at',s.created_at,'expires_at',s.created_at+interval '24 hours','content',s.content)
     ORDER BY s.created_at,s.id)
 FROM public.stories s JOIN public.profiles p ON p.id=s.user_id
 WHERE auth.uid() IS NOT NULL AND (p_user_ids IS NULL OR s.user_id=ANY(p_user_ids))
   AND s.created_at>statement_timestamp()-interval '24 hours' AND s.created_at<=statement_timestamp()
   AND p.deleted_at IS NULL AND (p.onboarding_completed OR p.onboarding_mode='legacy_migration')
 GROUP BY p.id ORDER BY max(s.created_at) DESC,p.id
$$;
REVOKE ALL ON FUNCTION public.get_stories_by_user_ids(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_stories_by_user_ids(uuid[]) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.delete_story(p_story_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); owner_id uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 SELECT user_id INTO owner_id FROM public.stories WHERE id=p_story_id FOR UPDATE;
 IF NOT FOUND THEN RETURN json_build_object('success',true,'message','Story já removido.'); END IF;
 IF actor IS DISTINCT FROM owner_id AND public.get_user_role(actor) IS DISTINCT FROM 'Admin' THEN
   RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED';
 END IF;
 DELETE FROM public.posts WHERE story_id=p_story_id;
 DELETE FROM public.stories WHERE id=p_story_id;
 INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 VALUES('story_removed','social','stories',p_story_id,actor,jsonb_build_object('owner_id',owner_id,'moderated',actor<>owner_id),'story-removed:'||p_story_id);
 IF actor<>owner_id THEN
   INSERT INTO public.notifications(user_id,sender_id,type,content,link,metadata)
   VALUES(owner_id,actor,'story_moderated','Um de seus Stories foi removido pela moderação.','/services/x',jsonb_build_object('story_id',p_story_id));
 END IF;
 RETURN json_build_object('success',true,'message','Story excluído com sucesso.');
END $$;
REVOKE ALL ON FUNCTION public.delete_story(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_story(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.delete_post(p_post_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); owner_id uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 SELECT user_id INTO owner_id FROM public.posts WHERE id=p_post_id FOR UPDATE;
 IF NOT FOUND THEN RETURN json_build_object('success',true,'message','Publicação já removida.'); END IF;
 IF actor IS DISTINCT FROM owner_id AND public.get_user_role(actor) IS DISTINCT FROM 'Admin' THEN
   RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED';
 END IF;
 DELETE FROM public.posts WHERE id=p_post_id;
 RETURN json_build_object('success',true,'message','Publicação excluída com sucesso.');
END $$;
REVOKE ALL ON FUNCTION public.delete_post(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_post(uuid) TO authenticated,service_role;

-- Existing table/RLS protects other sensitive profile columns. This stores two
-- distinct preferences; closing the tutorial is not a permanent opt-out.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tutorial_completed boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tutorial_dont_show_again boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.save_tutorial_progress(p_completed boolean,p_dont_show_again boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 UPDATE public.profiles SET tutorial_completed=tutorial_completed OR coalesce(p_completed,false),
   tutorial_dont_show_again=coalesce(p_dont_show_again,false),has_seen_tutorial=coalesce(p_dont_show_again,false)
 WHERE id=auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.save_tutorial_progress(boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_tutorial_progress(boolean,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.mark_tutorial_seen(p_dont_show_again boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.save_tutorial_progress(true,p_dont_show_again)
$$;
REVOKE ALL ON FUNCTION public.mark_tutorial_seen(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_tutorial_seen(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION private.notify_official_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_id bigint; origin text; loss boolean; details jsonb; assignment public.election_office_assignments%rowtype;
BEGIN
 IF NEW.role IS NOT DISTINCT FROM OLD.role OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 origin:=case when NEW.manual_role_override then 'administration'
   when NEW.role in('Deputado','Senador','Presidente','Vice-Presidente') then 'institutional_office'
   else 'institutional_transition' end;
 loss:=coalesce(NEW.role,'Cidadão') in('Cidadão','Prisioneiro','Preso');
 IF NOT coalesce(NEW.manual_role_override,false) THEN
   SELECT * INTO assignment FROM public.election_office_assignments WHERE profile_id=NEW.id AND office_role=case when loss then OLD.role else NEW.role end ORDER BY assigned_at DESC LIMIT 1;
   IF FOUND THEN origin:='election'; END IF;
 END IF;
 details:=jsonb_build_object('user_id',NEW.id,'previous_role',OLD.role,'new_role',NEW.role,
   'reason',case when loss then 'Encerramento ou afastamento do cargo oficial' else 'Atualização do cargo oficial' end,
   'origin',origin,'actor_id',auth.uid(),'occurred_at',clock_timestamp(),'role_assigned_at',NEW.role_assigned_at,
   'loss',loss,'popup_pending',true,'election_id',assignment.election_id,'office_role',NEW.role,'term_start_at',assignment.term_starts_at,'term_end_at',assignment.term_ends_at);
 INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 VALUES('role_changed','citizenship','profiles',NEW.id,auth.uid(),details,'role-change:'||gen_random_uuid()) RETURNING id INTO event_id;
 INSERT INTO public.notifications(user_id,sender_id,type,content,link,metadata)
 VALUES(NEW.id,auth.uid(),'role_changed',
   'Seu cargo foi alterado de '||coalesce(OLD.role,'Cidadão')||' para '||coalesce(NEW.role,'Cidadão')||'.',
   case when NEW.role in('Deputado','Senador') then '/services/parliament'
     when NEW.role in('Juiz','Promotor','Delegado','Policial','Advogado') then '/services/justice' else '/dashboard' end,
   details||jsonb_build_object('event_id',event_id));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.notify_official_role_change() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS official_role_changed ON public.profiles;
CREATE TRIGGER official_role_changed AFTER UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.notify_official_role_change();
CREATE OR REPLACE FUNCTION public.acknowledge_role_change(p_notification_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 UPDATE public.notifications SET metadata=coalesce(metadata,'{}')||jsonb_build_object('popup_shown_at',clock_timestamp(),'popup_pending',false),is_read=true
 WHERE id=p_notification_id AND user_id=auth.uid() AND type in('role_changed','office_awarded') AND metadata->>'popup_shown_at' IS NULL;
 RETURN found;
END $$;
REVOKE ALL ON FUNCTION public.acknowledge_role_change(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_role_change(uuid) TO authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['stories','parliament_votings','parliament_voting_votes','parliament_commission_members','parliament_leadership_elections','parliament_leadership_candidates','parliament_leadership_votes','bill_status_history','government_rules','law_effects','penal_code','domain_events'] LOOP
   IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND to_regclass('public.'||t) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
     EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
   END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION private.broadcast_public_profile_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (NEW.onboarding_completed OR OLD.onboarding_completed OR NEW.onboarding_mode='legacy_migration')
    AND ROW(NEW.deleted_at,NEW.username,NEW.full_name,NEW.avatar_url,NEW.role,NEW.titles,NEW.x_username,NEW.x_handle,NEW.x_avatar_url,NEW.x_header_url,NEW.x_bio,NEW.onboarding_completed)
    IS DISTINCT FROM ROW(OLD.deleted_at,OLD.username,OLD.full_name,OLD.avatar_url,OLD.role,OLD.titles,OLD.x_username,OLD.x_handle,OLD.x_avatar_url,OLD.x_header_url,OLD.x_bio,OLD.onboarding_completed)
    AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
   PERFORM realtime.send(jsonb_build_object('id',NEW.id),'public-profile-changed','citizen-public-profile',false);
 END IF;
 RETURN NEW;
END $$;

NOTIFY pgrst,'reload schema';
