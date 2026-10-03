begin;
-- Restore only independent careers; elected and appointed offices have their own terms.
create or replace function private.minister_return_role(p_previous text) returns text language sql immutable set search_path='' as $$
 select case when p_previous in('Policial','Militar','Agente Secreto','Juiz','Promotor') then p_previous else 'Cidadão' end;
$$;
revoke all on function private.minister_return_role(text) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.end_government_cabinet(p_government_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.ministers%rowtype;
BEGIN
 FOR m IN SELECT * FROM public.ministers WHERE status='active' AND (government_id=p_government_id OR (government_id IS NULL AND p_government_id IS NULL)) FOR UPDATE LOOP
  UPDATE public.ministers SET status='dismissed',ended_at=clock_timestamp() WHERE id=m.id;
  UPDATE public.profiles SET role=private.minister_return_role(m.previous_role),manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=auth.uid(),
   titles=array_remove(coalesce(titles,'{}'),'Ministro') WHERE id=m.user_id AND role='Ministro';
  UPDATE public.profiles SET titles=array_remove(coalesce(titles,'{}'),'Ministro') WHERE id=m.user_id AND 'Ministro'=any(coalesce(titles,'{}'));
  INSERT INTO public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id,metadata)
  VALUES(m.user_id,m.ministry_id,'dismissed',p_reason,auth.uid(),jsonb_build_object('government_id',m.government_id,'appointment',to_jsonb(m)));
  INSERT INTO public.dou_entries(title,summary,content,type,source_id,legal_metadata)
  VALUES('Encerramento ministerial: '||m.ministry,p_reason,p_reason,'Nomeacao e Exoneracao',gen_random_uuid(),jsonb_build_object('government_id',m.government_id,'minister_id',m.user_id));
 END LOOP;
END; $function$;

CREATE OR REPLACE FUNCTION public.dismiss_minister(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); result public.ministers%rowtype;
begin
  if coalesce(public.get_user_role(actor),'') not in('Presidente','Admin') then return json_build_object('success',false,'message','Apenas a Presidência pode exonerar ministros.'); end if;
  perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
  perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
  update public.ministers set status='dismissed',ended_at=clock_timestamp() where user_id=p_user_id and status='active' returning * into result;
  if result.id is null then return json_build_object('success',false,'message','Ministro ativo não encontrado.'); end if;
  update public.profiles set role=private.minister_return_role(result.previous_role),manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=actor,titles=array_remove(coalesce(titles,'{}'),'Ministro') where id=p_user_id and role='Ministro';
  update public.profiles set titles=array_remove(coalesce(titles,'{}'),'Ministro') where id=p_user_id and 'Ministro'=any(coalesce(titles,'{}'));
  insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id) values(p_user_id,result.ministry_id,'dismissed','Exoneração de '||result.ministry||'.',actor);
  perform public.apply_government_impact('politics','minister_dismissed','Exoneração ministerial.',-.3,0,'ministers',result.id::text,jsonb_build_object('ministerId',p_user_id,'ministry',result.ministry));
  return json_build_object('success',true,'message','Ministro exonerado com sucesso.');
end; $function$;

CREATE OR REPLACE FUNCTION public.respond_minister_invitation(p_invitation_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.minister_invitations%rowtype; m public.government_ministries%rowtype; previous public.ministers%rowtype; target public.profiles%rowtype;
begin
 if auth.uid() is null or p_accept is null then raise exception 'Entre na sua conta para responder ao convite.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 select * into i from public.minister_invitations where id=p_invitation_id and candidate_id=auth.uid() for update;
 if i.id is null then raise exception 'Este convite não pertence à sua conta.' using errcode='42501';end if;
 if i.status<>'pending' then return jsonb_build_object('status',i.status,'success',i.status in('accepted','declined'),'message','Este convite já foi respondido ou encerrado.');end if;
 perform private.maintain_minister_invitations();
 select * into i from public.minister_invitations where id=p_invitation_id;
 if i.status<>'pending' then return jsonb_build_object('status',i.status,'success',false,'message','O convite expirou ou o Governo responsável foi encerrado.');end if;
 if not p_accept then update public.minister_invitations set status='declined',responded_at=clock_timestamp() where id=i.id;return jsonb_build_object('success',true,'status','declined','message','Convite recusado.');end if;
 select * into target from public.profiles where id=auth.uid() for update;
 if not private.is_executive_candidate(auth.uid(),'minister') then raise exception 'Sua situação institucional mudou. Você não pode assumir este Ministério.';end if;
 select * into m from public.government_ministries where id=i.ministry_id and is_active for update;
 if m.id is null then raise exception 'Este Ministério não está mais ativo.';end if;
 select * into previous from public.ministers where ministry_id=m.id and status='active' for update;
 if previous.id is not null then
  update public.ministers set status='dismissed',ended_at=clock_timestamp() where id=previous.id;
  update public.profiles set role=private.minister_return_role(previous.previous_role),manual_role_override=false,titles=array_remove(coalesce(titles,'{}'),'Ministro'),role_assigned_at=clock_timestamp() where id=previous.user_id and role='Ministro';
  insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id) values(previous.user_id,m.id,'dismissed','Substituição após aceite do sucessor.',i.invited_by);
 end if;
 insert into public.ministers(user_id,ministry,ministry_id,appointed_by,status,appointed_at,ended_at,government_id,previous_role)
 values(target.id,m.name,m.id,i.invited_by,'active',clock_timestamp(),null,i.government_id,target.role)
 on conflict(user_id) do update set ministry=excluded.ministry,ministry_id=excluded.ministry_id,appointed_by=excluded.appointed_by,status='active',appointed_at=excluded.appointed_at,ended_at=null,government_id=excluded.government_id,previous_role=excluded.previous_role;
 perform set_config('govrp.role_change_reason','Aceite de convite para o '||m.name,true);
 update public.profiles set role='Ministro',manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=i.invited_by where id=target.id;
 insert into public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id,metadata) values(target.id,m.id,'appointed','Nomeação efetiva após aceite do convite.',target.id,jsonb_build_object('invitation_id',i.id,'government_id',i.government_id,'previous_role',target.role));
 update public.minister_invitations set status='accepted',responded_at=clock_timestamp(),previous_role=target.role where id=i.id;
 insert into public.dou_entries(title,summary,content,type,source_id,legal_metadata) values('Nomeação: '||m.name,target.full_name||' aceitou integrar o Governo.',target.full_name||' assumiu o '||m.name||' após aceitar o convite presidencial.','Nomeacao e Exoneracao',i.id,jsonb_build_object('government_id',i.government_id,'invitation_id',i.id));
 return jsonb_build_object('success',true,'status','accepted','message','Convite aceito. Você assumiu o Ministério.');
end $function$;


notify pgrst,'reload schema';
commit;
