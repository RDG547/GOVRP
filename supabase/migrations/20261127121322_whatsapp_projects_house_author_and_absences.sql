CREATE OR REPLACE FUNCTION private.bot_whatsapp_project_location(p_bill_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $fn$
 SELECT CASE
   WHEN lower(b.status)='aguardando sanção presidencial' THEN 'Etapa atual: Presidência da República; última Casa: '||coalesce(last_house.name,origin.name,'Não identificada')
   WHEN lower(b.status) IN ('sancionado','promulgado','rejeitado','arquivado','sustado') OR lower(b.status) LIKE 'vetado%' THEN
     'Última Casa: '||coalesce(last_house.name,origin.name,'Não identificada')
   ELSE 'Casa atual: '||coalesce(active_house.name,last_house.name,origin.name,'Não identificada')
 END
 FROM public.bills b
 LEFT JOIN public.parliament_houses origin ON origin.id=b.house_id
 LEFT JOIN LATERAL (
   SELECT h.name FROM public.parliament_votings v JOIN public.parliament_houses h ON h.id=v.house_id
   WHERE v.related_id=b.id AND v.type='bill' AND v.status='active'
   ORDER BY v.created_at DESC,v.id DESC LIMIT 1
 ) active_house ON true
 LEFT JOIN LATERAL (
   SELECT h.name FROM public.parliament_votings v JOIN public.parliament_houses h ON h.id=v.house_id
   WHERE v.related_id=b.id AND v.type='bill'
   ORDER BY v.created_at DESC,v.id DESC LIMIT 1
 ) last_house ON true
 WHERE b.id=p_bill_id;
$fn$;
REVOKE ALL ON FUNCTION private.bot_whatsapp_project_location(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.bot_whatsapp_project_location(uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.bot_whatsapp_vote_summary(p_voting_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 v public.parliament_votings%ROWTYPE;
 v_house text;
 v_kind text;
 v_yes integer;
 v_no integer;
 v_abst integer;
 v_total integer;
 v_missing integer;
 v_abstention_line text;
 v_result text;
 v_quorum text:='';
BEGIN
 SELECT * INTO v FROM public.parliament_votings WHERE id=p_voting_id;
 IF NOT FOUND THEN RETURN 'Votação não encontrada.'; END IF;
 SELECT name INTO v_house FROM public.parliament_houses WHERE id=v.house_id;
 IF v.type='bill' THEN
   SELECT type INTO v_kind FROM public.bills WHERE id=v.related_id;
 END IF;
 v_kind:=coalesce(v_kind,CASE v.type
   WHEN 'institutional_appointment' THEN 'Indicação institucional'
   WHEN 'judicial_impeachment' THEN 'Julgamento institucional'
   WHEN 'commission' THEN 'Comissão'
   WHEN 'suggestion' THEN 'Sugestão'
   ELSE initcap(replace(v.type,'_',' ')) END);
 SELECT count(*) FILTER(WHERE vote='Aprovar'),
        count(*) FILTER(WHERE vote='Rejeitar'),
        count(*) FILTER(WHERE vote='Abster'),
        count(*)
 INTO v_yes,v_no,v_abst,v_total
 FROM public.parliament_voting_votes WHERE voting_id=v.id;

 SELECT count(DISTINCT e.member_id) INTO v_missing
 FROM unnest(v.eligible_member_ids) AS e(member_id)
 WHERE e.member_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.parliament_voting_votes ballot
   WHERE ballot.voting_id=v.id AND ballot.member_id=e.member_id
 );
 IF v.eligible_member_ids IS NULL OR cardinality(v.eligible_member_ids)=0 THEN
   v_abstention_line:='⚪ Abstenções registradas: *'||v_abst||'* (ausências não apuráveis: lista de aptos indisponível)';
 ELSIF v.status='closed' THEN
   v_abstention_line:='⚪ Abstenções: *'||(v_abst+v_missing)||'*'
     ||' (registradas: '||v_abst||'; não votaram: '||v_missing||')';
 ELSE
   v_abstention_line:='⚪ Abstenções registradas: *'||v_abst||'*'
     ||E'\n⏳ Aptos sem voto registrado: *'||v_missing||'*';
 END IF;

 IF v.status='closed' AND v.result ? 'approved'
   AND v.result->>'approved' IN ('true','false') THEN
   v_result:=CASE WHEN (v.result->>'approved')::boolean
     THEN '✅ *APROVADO*' ELSE '❌ *REJEITADO*' END;
 ELSIF v.status='active' THEN v_result:='🟡 *EM ANDAMENTO*';
 ELSIF v.status='closed' THEN v_result:='⚪ *ENCERRADO — resultado oficial não disponível*';
 ELSE v_result:='ℹ️ *'||upper(coalesce(v.status,'NÃO INFORMADO'))||'*';
 END IF;

 IF v.result ? 'deliberation_required'
   AND (v.result->>'deliberation_required') ~ '^[0-9]+$' THEN
   v_quorum:=E'\n📊 Quórum mínimo de deliberação: '||
       (v.result->>'deliberation_required')||
       CASE WHEN v_total<(v.result->>'deliberation_required')::integer
          THEN ' (não atingido)' ELSE ' (atingido)' END;
 END IF;

 RETURN '🏛️ Casa: '||coalesce(v_house,'Não identificada')
   ||E'\n📜 Tipo: '||v_kind
   ||E'\n🏁 Resultado: '||v_result
   ||E'\n👍 A favor: *'||v_yes||'*'
   ||E'\n👎 Contra: *'||v_no||'*'
   ||E'\n'||v_abstention_line
   ||E'\n🗳️ Votos registrados: *'||v_total||'*'
   ||v_quorum
   ||CASE WHEN v.status='active' THEN E'\n⏰ Encerramento previsto: '
          ELSE E'\n🕒 Prazo de votação: ' END
   ||to_char(v.end_date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI');
END $fn$;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_projects()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_message text;
BEGIN
 IF auth.role()<>'service_role' THEN
   RAISE EXCEPTION 'Serviço não autorizado.' USING ERRCODE='42501';
 END IF;
 WITH recent AS (
   SELECT row_number() over (ORDER BY b.updated_at DESC,b.id DESC) AS number,
     b.type,b.title,b.status,
     coalesce(nullif(b.author_identity_snapshot->>'full_name',''),nullif(p.full_name,''),nullif(p.username,''),'Não informado') AS author,
     private.bot_whatsapp_project_location(b.id) AS location
   FROM (
     SELECT id,type,title,status,updated_at,author_id,author_identity_snapshot FROM public.bills
     ORDER BY updated_at DESC,id DESC LIMIT 12
   ) b
   LEFT JOIN public.profiles p ON p.id=b.author_id
 )
 SELECT string_agg(
   number||'. *'||coalesce(type,'PL')||'* — '||left(title,95)
      ||E'\n   Autor: '||author
      ||E'\n   '||coalesce(location,'Casa não identificada')
      ||E'\n   Situação: '||coalesce(status,'Não informada'),
   E'\n\n' ORDER BY number)
 INTO v_message FROM recent;
 RETURN '📚 *Projetos legislativos do GOVRP*'
   ||E'\n\n'||coalesce(v_message,'Nenhum projeto cadastrado.')
   ||E'\n\n🔎 Detalhes e votos: *!projeto N*'
   ||E'\n🔎 Busca por nome: *!projeto NOME*'
   ||E'\n🌐 https://govrp.vercel.app/services/parliament';
END $fn$;

CREATE OR REPLACE FUNCTION public.bot_whatsapp_project(p_selector text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 v_input text:=left(btrim(coalesce(p_selector,'')),140);
 v_bill public.bills%ROWTYPE;
 v_house text;
 v_author text;
 v_matches integer;
 v_alternatives text;
 v_votes text;
BEGIN
 IF auth.role()<>'service_role' THEN
   RAISE EXCEPTION 'Serviço não autorizado.' USING ERRCODE='42501';
 END IF;
 IF v_input='' THEN
   RETURN 'Informe o número ou título do projeto. Use *!projetos* para ver a lista e depois *!projeto 1*.';
 END IF;
 IF v_input ~ '^[0-9]+$' THEN
   IF length(v_input)>2 OR v_input::integer NOT BETWEEN 1 AND 12 THEN
     RETURN 'Número inválido. Consulte *!projetos* para ver os números de 1 a 12.';
   END IF;
   SELECT * INTO v_bill FROM public.bills
   ORDER BY updated_at DESC,id DESC LIMIT 1 OFFSET v_input::integer-1;
 ELSE
   SELECT count(*) INTO v_matches FROM public.bills
     WHERE lower(title)=lower(v_input);
   IF v_matches=1 THEN
     SELECT * INTO v_bill FROM public.bills
     WHERE lower(title)=lower(v_input)
     ORDER BY updated_at DESC,id DESC LIMIT 1;
   ELSE
     SELECT count(*) INTO v_matches FROM public.bills
       WHERE position(lower(v_input) IN lower(title))>0;
     IF v_matches>1 THEN
       SELECT string_agg('• '||left(title,100)||' ('||type||')',E'\n' ORDER BY updated_at DESC,id DESC)
         INTO v_alternatives FROM (
           SELECT id,title,type,updated_at FROM public.bills
           WHERE position(lower(v_input) IN lower(title))>0
           ORDER BY updated_at DESC,id DESC LIMIT 5
         ) matches;
       RETURN '🔎 *Mais de um projeto encontrado.*'
          ||E'\n\n'||coalesce(v_alternatives,'')
          ||E'\n\nInforme o título completo ou consulte *!projetos*.';
     ELSIF v_matches=1 THEN
       SELECT * INTO v_bill FROM public.bills
       WHERE position(lower(v_input) IN lower(title))>0
       ORDER BY updated_at DESC,id DESC LIMIT 1;
     END IF;
   END IF;
 END IF;
 IF v_bill.id IS NULL THEN
   RETURN 'Projeto não encontrado. Consulte *!projetos* ou pesquise usando *!projeto NOME*.';
 END IF;
 SELECT name INTO v_house FROM public.parliament_houses WHERE id=v_bill.house_id;
 SELECT coalesce(full_name,username) INTO v_author
   FROM public.profiles WHERE id=v_bill.author_id;

 -- Distinguish the result of each house from the overall status of a
 -- bicameral PEC. An approved first-house vote does NOT mean enacted law.
 SELECT string_agg(
    '🗳️ *Votação '||rank||'* — '
    ||coalesce((SELECT h.name FROM public.parliament_houses h WHERE h.id=v.house_id),'Casa não identificada')
    ||E'\n'||private.bot_whatsapp_vote_summary(v.id),
    E'\n\n' ORDER BY rank
 ) INTO v_votes FROM (
   SELECT v.id,v.house_id,row_number() over(ORDER BY v.created_at DESC,v.id DESC) AS rank
   FROM public.parliament_votings v
   WHERE v.related_id=v_bill.id AND v.type='bill'
   ORDER BY v.created_at DESC,v.id DESC LIMIT 6
 ) v;
 RETURN left(
   '📜 *'||left(v_bill.title,170)||'*'
   ||E'\n\n📂 Tipo: '||coalesce(v_bill.type,'PL')
   ||E'\n🏛️ Casa de origem: '||coalesce(v_house,'Não identificada')
   ||E'\n🏛️ '||coalesce(private.bot_whatsapp_project_location(v_bill.id),'Casa não identificada')
   ||E'\n👤 Autor: '||coalesce(v_author,v_bill.author_identity_snapshot->>'full_name','Não informado')
   ||E'\n📌 Situação geral: *'||coalesce(v_bill.status,'Não informada')||'*'
   ||E'\n📅 Proposto em: '||to_char(v_bill.created_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')
   ||CASE WHEN nullif(btrim(coalesce(v_bill.summary,'')),'') IS NOT NULL
      THEN E'\n📝 Ementa: '||left(regexp_replace(v_bill.summary,E'[\\r\\n]+',' ','g'),240)
      ELSE '' END
   ||E'\n\n*Apuração parlamentar por votação:*'
   ||E'\n\n'||coalesce(v_votes,'Ainda não há votação parlamentar registrada para este projeto.')
   ||E'\n\n🌐 https://govrp.vercel.app/services/parliament',3600);
END $fn$;
