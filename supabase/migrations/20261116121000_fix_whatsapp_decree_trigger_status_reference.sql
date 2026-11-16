-- Fix invalid trigger attribute access on INSERT/UPDATE of public.decrees.
-- PL/pgSQL cannot resolve NEW.status for a decree row in the ELSIF guard,
-- even when TG_TABLE_NAME='elections' is false. Check table identity first.
-- Also guard the same cross-table pitfall for the bills branch.
BEGIN;
CREATE OR REPLACE FUNCTION private.whatsapp_bot_outbox_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_kind text;v_event text;v_title text;v_message text;v_url text;v_source text;
BEGIN
 v_source:=NEW.id::text;
 IF TG_TABLE_NAME='news_articles' AND TG_OP='INSERT' THEN
  v_kind:='news';v_event:='news';
  v_title:=left(coalesce(NEW.title,'Notícia do GOVRP'),160);
  v_message:=left(regexp_replace(coalesce(NEW.content,''),'<[^>]*>',' ','g'),500);
  v_url:='https://govrp.vercel.app/news/'||v_source;
 ELSIF TG_TABLE_NAME='parliament_voting_schedules' THEN
  IF TG_OP='INSERT' THEN
   v_kind:='votings';v_event:='scheduled';v_title:='Votação agendada';
   v_message:=left(NEW.title,200)||E'\nInício: '||to_char(NEW.starts_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI')||E'\nTérmino: '||to_char(NEW.ends_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI');
  ELSIF NEW.status IN ('cancelled','canceled') AND OLD.status IS DISTINCT FROM NEW.status THEN
   v_kind:='votings';v_event:='cancelled';v_title:='Votação cancelada';v_message:=left(NEW.title,250);
  ELSE RETURN NEW;END IF;
  v_url:='https://govrp.vercel.app/services/parliament';
 ELSIF TG_TABLE_NAME='parliament_votings' THEN
  IF NEW.status='active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
   v_kind:='votings';v_event:='active';v_title:='Votação parlamentar iniciada';
  ELSIF TG_OP='UPDATE' AND NEW.status='closed' AND OLD.status IS DISTINCT FROM NEW.status THEN
   v_kind:='votings';v_event:='closed';v_title:='Votação parlamentar encerrada';
  ELSE RETURN NEW;END IF;
  v_message:=left(NEW.title,240);v_url:='https://govrp.vercel.app/services/parliament';
 ELSIF TG_TABLE_NAME='elections' AND TG_OP='UPDATE' THEN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('Candidacy','Voting','Finished') THEN RETURN NEW; END IF;
  v_kind:='elections';v_event:=NEW.status;v_title:='Eleições: '||NEW.status;
  v_message:=left(NEW.name,240);v_url:='https://govrp.vercel.app/services/elections';
 ELSIF TG_TABLE_NAME='decrees' AND (TG_OP='INSERT' OR TG_OP='UPDATE') THEN
  IF NOT NEW.is_published OR (TG_OP='UPDATE' AND coalesce(OLD.is_published,false)) THEN RETURN NEW; END IF;
  v_kind:='government';v_event:='published';v_title:='Novo decreto publicado';v_message:=left(NEW.title,240);
  v_url:='https://govrp.vercel.app/';
 ELSIF TG_TABLE_NAME='bills' AND TG_OP='UPDATE' THEN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('Sancionado','Promulgado','Vigente') THEN RETURN NEW; END IF;
  v_kind:='government';v_event:='law_'||NEW.status;v_title:='Lei aprovada e publicada';v_message:=left(NEW.title,240);
  v_url:='https://govrp.vercel.app/services/parliament';
 ELSE RETURN NEW;END IF;
 INSERT INTO public.whatsapp_bot_events(event_kind,source_table,source_id,title,message,url)
 VALUES(v_kind,TG_TABLE_NAME,v_source||':'||v_event,v_title,coalesce(v_message,''),v_url)
 ON CONFLICT(event_kind,source_table,source_id) DO NOTHING;
 RETURN NEW;
END $function$;
COMMIT;
