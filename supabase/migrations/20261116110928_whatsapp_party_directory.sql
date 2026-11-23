-- WhatsApp GOVRP: live party directory, including all registered parties.
-- Activity (is_active) and registry status (status) are separate concepts.
BEGIN;
CREATE OR REPLACE FUNCTION public.bot_whatsapp_parties()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
 v_list text;
 v_total integer;
 v_active integer;
 v_inactive integer;
BEGIN
 IF auth.role() <> 'service_role' THEN
  RAISE EXCEPTION 'Serviço não autorizado.' USING ERRCODE='42501';
 END IF;

 SELECT count(*)::integer, count(*) FILTER(WHERE is_active)::integer,
        count(*) FILTER(WHERE NOT is_active)::integer
 INTO v_total,v_active,v_inactive
 FROM public.political_parties;

 SELECT string_agg(
   '*'||p.position::text||'. '||left(btrim(p.name),85)||' ('||left(btrim(coalesce(p.acronym,'—')),30)||')*'
   ||coalesce(E'\n🔢 Número: '||nullif(p.electoral_number,''),'')
   ||E'\n👥 Membros: '||p.members::text
   ||E'\n'||CASE WHEN p.is_active THEN '🟢 Ativo' ELSE '🔴 Inativo' END
   ||E'\n📋 Situação cadastral: '||coalesce(nullif(btrim(p.status),''),'Não informada'),
   E'\n\n' ORDER BY p.position)
 INTO v_list
 FROM (
  SELECT pp.id,pp.name,pp.acronym,pp.electoral_number,pp.status,pp.is_active,
         count(DISTINCT pm.user_id)::integer members,
         row_number() OVER (ORDER BY lower(btrim(pp.name)),pp.id) position
  FROM public.political_parties pp
  LEFT JOIN public.party_members pm ON pm.party_id=pp.id
  GROUP BY pp.id
  ORDER BY lower(btrim(pp.name)),pp.id
  LIMIT 30
 ) p;

 RETURN '🚩 *Partidos políticos do GOVRP*'
  ||E'\n\nCadastrados: '||v_total::text
  ||' | Ativos: '||v_active::text
  ||' | Inativos: '||v_inactive::text
  ||E'\n\n'||coalesce(v_list,'Nenhum partido cadastrado.')
  ||CASE WHEN v_total>30 THEN E'\n\nExibindo os primeiros 30 partidos.' ELSE '' END
  ||E'\n\n🌐 Consulte os partidos na plataforma: https://govrp.vercel.app/';
END;
$fn$;

REVOKE ALL ON FUNCTION public.bot_whatsapp_parties() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bot_whatsapp_parties() TO service_role;
COMMIT;
