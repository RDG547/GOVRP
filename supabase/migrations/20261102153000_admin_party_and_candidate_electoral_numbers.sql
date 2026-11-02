BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_party(p_party_id uuid, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result json; party public.political_parties%rowtype;
begin
 if not coalesce(public.get_authority_role(auth.uid())='Admin',false) then raise exception 'Somente Admin pode usar esta edição.' using errcode='42501'; end if;
 select * into party from public.political_parties where id=p_party_id for update;
 if not found or party.status='Encerrado' then raise exception 'O partido está encerrado ou indisponível.'; end if;
 if p_changes ? 'color' then perform public.set_party_color(p_party_id,p_changes->>'color'); end if;
 result:=public.update_party_details(p_party_id,p_changes->>'name',p_changes->>'acronym',p_changes->>'ideology',p_changes->>'statute',p_changes->>'logo_url',nullif(p_changes->>'owner_id','')::uuid,nullif(p_changes->>'president_id','')::uuid,nullif(p_changes->>'vice_president_id','')::uuid,p_changes->>'description',(p_changes->>'orientation')::public.political_orientation);
 if not coalesce((result->>'success')::boolean,false) then raise exception '%',coalesce(result->>'message','Não foi possível salvar o partido.'); end if;
 if p_changes ? 'electoral_number' and p_changes->>'electoral_number' is distinct from party.electoral_number then
   perform public.set_party_electoral_number(p_party_id,p_changes->>'electoral_number');
 end if;
 if p_changes->>'affiliation_mode' is distinct from party.affiliation_mode then
  result:=public.toggle_party_affiliation_mode(p_party_id,p_changes->>'affiliation_mode');
  if not coalesce((result->>'success')::boolean,false) then raise exception '%',result->>'message'; end if;
 end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_manage_candidacy(p_candidate_id uuid, p_action text, p_changes jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare candidate public.candidates%rowtype;
begin
 if not coalesce(public.is_admin(auth.uid()),false) then raise exception 'Somente Admin pode administrar candidaturas.' using errcode='42501'; end if;
 select * into candidate from public.candidates where id=p_candidate_id for update;
 if not found then raise exception 'Candidatura não encontrada.'; end if;
 if p_action='delete' then
  if candidate.removed_at is not null then return jsonb_build_object('success',true); end if;
  update public.candidates set removed_at=now(),status='Withdrawn' where id=candidate.id;
 elsif p_action='edit' then
  if candidate.removed_at is not null then raise exception 'Esta candidatura foi excluída.'; end if;
  if length(btrim(coalesce(p_changes->>'political_name','')))<2 then raise exception 'Informe o nome político do candidato.'; end if;
  update public.candidates set political_name=btrim(p_changes->>'political_name'),bio=coalesce(p_changes->>'bio',''),proposals=coalesce(p_changes->>'proposals',''),admin_feedback=nullif(p_changes->>'admin_feedback',''),
    electoral_number=coalesce(nullif(btrim(p_changes->>'electoral_number'),''),candidate.electoral_number)
    where id=candidate.id;
 else raise exception 'Ação administrativa inválida.'; end if;
 perform public.justice_write_audit('candidacy.'||p_action,'candidate',candidate.id,to_jsonb(candidate),jsonb_build_object('action',p_action,'changes',p_changes),'Ação administrativa; votos e mandatos históricos preservados.');
 return jsonb_build_object('success',true);
end $function$
;

CREATE OR REPLACE FUNCTION public.update_party_details_with_number(
 p_party_id uuid,p_name text,p_acronym text,p_ideology text,p_statute text,
 p_logo_url text,p_owner_id uuid,p_president_id uuid,p_vice_president_id uuid,
 p_description text,p_orientation public.political_orientation,p_electoral_number text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result json; v_current text;
BEGIN
 SELECT electoral_number INTO v_current FROM public.political_parties WHERE id=p_party_id FOR UPDATE;
 IF p_electoral_number IS DISTINCT FROM v_current THEN
   PERFORM public.set_party_electoral_number(p_party_id,p_electoral_number);
 END IF;
 v_result:=public.update_party_details(p_party_id,p_name,p_acronym,p_ideology,p_statute,p_logo_url,
    p_owner_id,p_president_id,p_vice_president_id,p_description,p_orientation);
 IF NOT coalesce((v_result->>'success')::boolean,false) THEN
   RAISE EXCEPTION '%',coalesce(v_result->>'message','Não foi possível atualizar o partido.');
 END IF;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.update_party_details_with_number(uuid,text,text,text,text,text,uuid,uuid,uuid,text,public.political_orientation,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_party_details_with_number(uuid,text,text,text,text,text,uuid,uuid,uuid,text,public.political_orientation,text) TO authenticated;

COMMIT;