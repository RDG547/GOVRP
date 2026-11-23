-- GOVRP WhatsApp: show active parties first and parties in formation/inactive second;
-- list current Deputies and Senators including party and remaining mandate.
BEGIN;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_parties()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_active_list text;v_formation_list text;v_total int;v_active int;v_other int;
BEGIN
 IF auth.role()<>'service_role' THEN
  RAISE EXCEPTION 'Serviço não autorizado.' USING ERRCODE='42501';
 END IF;
 SELECT count(*)::int,count(*) FILTER(WHERE is_active)::int,count(*) FILTER(WHERE NOT is_active)::int
 INTO v_total,v_active,v_other
 FROM public.political_parties;
 WITH parties AS (
   SELECT p.id,p.name,p.acronym,p.electoral_number,p.status,p.is_active,
          count(distinct pm.user_id)::int member_count,
          row_number() over(partition by p.is_active order by lower(btrim(p.name)),p.id) as position
   FROM public.political_parties p
   LEFT JOIN public.party_members pm ON pm.party_id=p.id
   GROUP BY p.id
 ), formatted AS (
   SELECT is_active,position,
     '*'||position::text||'. '||left(btrim(name),85)||' ('||left(btrim(coalesce(acronym,'—')),30)||')*'
     ||coalesce(E'\n🔢 Número: '||nullif(electoral_number,''),'')
     ||E'\n👥 Membros: '||member_count::text
     ||E'\n'||CASE WHEN is_active THEN '🟢 Ativo' ELSE '🔴 Inativo' END
     ||E'\n📋 Situação cadastral: '||coalesce(nullif(btrim(status),''),'Não informada')
     AS line
   FROM parties
 )
 SELECT string_agg(line,E'\n\n' ORDER BY position) FILTER(WHERE is_active),
        string_agg(line,E'\n\n' ORDER BY position) FILTER(WHERE NOT is_active)
 INTO v_active_list,v_formation_list
 FROM formatted;
 RETURN '🚩 *Partidos políticos do GOVRP*'
  ||E'\n\nTotal: '||v_total||' | Ativos: '||v_active||' | Em formação/inativos: '||v_other
  ||E'\n\n🟢 *PARTIDOS ATIVOS*\n'||coalesce(v_active_list,'Nenhum partido ativo.')
  ||E'\n\n🟡 *PARTIDOS EM FORMAÇÃO / INATIVOS*\n'||coalesce(v_formation_list,'Nenhum partido inativo.')
  ||E'\n\nℹ️ A situação cadastral é exibida separadamente da ativação.'
  ||E'\n\n🌐 https://govrp.vercel.app/';
END;
$fn$;

REVOKE ALL ON FUNCTION public.bot_whatsapp_parties() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bot_whatsapp_parties() TO service_role;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_parliament_house(p_house text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_house_id uuid;v_house_name text;v_list text;v_count int;
BEGIN
 IF auth.role()<>'service_role' THEN
  RAISE EXCEPTION 'Serviço não autorizado.' USING ERRCODE='42501';
 END IF;
 IF p_house NOT IN ('deputados','senadores') THEN
  RETURN 'Casa parlamentar inválida. Use !deputados ou !senadores.';
 END IF;

 SELECT h.id,h.name INTO v_house_id,v_house_name
 FROM public.parliament_houses h
 WHERE h.name=CASE WHEN p_house='deputados' THEN 'Câmara dos Deputados' ELSE 'Senado' END
 LIMIT 1;
 IF v_house_id IS NULL THEN
  RETURN 'Casa parlamentar não encontrada no GOVRP.';
 END IF;

 WITH current_members AS (
  SELECT m.id,
     left(coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),'Cidadão'),90) AS citizen_name,
     coalesce(nullif(btrim(pp.acronym),''),'Sem partido') AS party_name,
     m.term_end_date,
     greatest(0,extract(epoch FROM
       ((m.term_end_date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')-clock_timestamp())) AS seconds_left
  FROM public.parliament_members m
  JOIN public.profiles p ON p.id=m.user_id AND p.deleted_at IS NULL
  LEFT JOIN public.political_parties pp ON pp.id=coalesce(m.party_id,m.elected_party_id)
  WHERE m.house_id=v_house_id
    AND m.term_start_date<=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date
    AND m.term_end_date>=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date
    AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
 ), numbered AS (
   SELECT *,row_number() OVER(ORDER BY lower(citizen_name),id) position
   FROM current_members
 )
 SELECT count(*)::int,
   string_agg(
    '*'||position||'. '||citizen_name||'*'
    ||E'\n🏳️ Partido: '||party_name
    ||E'\n⏳ Mandato restante: '
       ||floor(seconds_left/86400)::bigint||'d '
       ||floor(mod(seconds_left,86400)/3600)::bigint||'h'
    ||E'\n📅 Término: '||to_char(term_end_date,'DD/MM/YYYY'),
    E'\n\n' ORDER BY position
   )
 INTO v_count,v_list
 FROM numbered;

 RETURN CASE WHEN p_house='deputados'
  THEN '🏛️ *Câmara dos Deputados — composição atual*'
  ELSE '🏛️ *Senado — composição atual*' END
 ||E'\n\nParlamentares em exercício: '||v_count::text
 ||E'\n\n'||coalesce(v_list,'Nenhum parlamentar com mandato vigente.')
 ||E'\n\n🌐 https://govrp.vercel.app/services/parliament';
END;
$fn$;

REVOKE ALL ON FUNCTION public.bot_whatsapp_parliament_house(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bot_whatsapp_parliament_house(text) TO service_role;

COMMIT;
