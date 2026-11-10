BEGIN;
-- A posse de tres ministros ativos e de ministerios distintos libera a formacao presidencial.
-- Os demais ministerios e nomeacoes permanecem disponiveis, mas nao bloqueiam a formacao.
-- Preserva o governo atual e convites ja registrados; nenhuma linha operacional e alterada.

CREATE OR REPLACE FUNCTION public.get_presidential_formation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.presidential_formation%rowtype; offices jsonb; ministries jsonb; cfg jsonb; remaining integer; appointed_ministers integer; required_ministers integer:=3;
begin
 if auth.uid() is null or coalesce(public.get_user_role(auth.uid()),'')<>'Presidente' then return null; end if;
 perform private.maintain_minister_invitations();
 insert into public.presidential_formation(user_id,government_id) select auth.uid(),id from public.government_terms where ended_at is null and head_id=auth.uid() on conflict do nothing;
 select * into f from public.presidential_formation where user_id=auth.uid() and ended_at is null for update;
 select value into cfg from public.system_settings where key='executive_governance';
 select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('appointment',cfg->'specialAppointments'->o.office_key,'invitation',(select to_jsonb(i) from public.minister_invitations i where (i.government_id=f.government_id or not o.government_bound) and i.office_key=o.office_key order by created_at desc limit 1)) order by sort_order),'[]') into offices from public.executive_office_definitions o where required_for_formation;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'holder_id',a.user_id,'invitation',(select to_jsonb(i) from public.minister_invitations i where i.government_id=f.government_id and i.ministry_id=m.id order by created_at desc limit 1)) order by m.name),'[]') into ministries
 from public.government_ministries m left join lateral (select user_id from public.ministers where ministry_id=m.id and status='active' and government_id=f.government_id order by appointed_at desc limit 1) a on true where m.is_active;
 select count(*) into appointed_ministers from jsonb_array_elements(ministries) m where m->>'holder_id' is not null;
 remaining:=greatest(0,required_ministers-appointed_ministers);
 if f.status='pending' then update public.presidential_formation set status='in_progress' where id=f.id returning * into f; end if;
 return to_jsonb(f)||jsonb_build_object('offices',offices,'ministries',ministries,'remaining',remaining,'appointed_ministers',appointed_ministers,'required_ministers',required_ministers,'awaiting',(select count(*) from public.minister_invitations where government_id=f.government_id and ministry_id is not null and status='pending' and expires_at>clock_timestamp())),'revision',(select max(coalesce(responded_at,created_at)) from public.minister_invitations where government_id=f.government_id),'government',(select to_jsonb(g) from public.government_terms g where g.ended_at is null and g.head_id=auth.uid()));
end; $function$


CREATE OR REPLACE FUNCTION public.complete_presidential_formation()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f jsonb;
begin
 f:=public.get_presidential_formation();
 if f is null then raise exception 'Somente o Presidente em exercício pode concluir a formação.' using errcode='42501'; end if;
 if coalesce((f->>'appointed_ministers')::integer,0)<3 then raise exception 'É necessário empossar pelo menos três ministros para concluir a formação do Governo.'; end if;
 update public.presidential_formation set completed_at=coalesce(completed_at,clock_timestamp()),status='completed' where id=(f->>'id')::uuid;
end $function$


-- Convites recusados/expirados nao reabrem uma formacao ja concluida.
CREATE OR REPLACE FUNCTION private.notify_minister_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ministry text; candidate text; president text; head uuid;
begin
 select name into ministry from public.government_ministries where id=new.ministry_id;
 if ministry is null then select role_label into ministry from public.executive_office_definitions where office_key=new.office_key;end if;
 select full_name into candidate from public.profiles where id=new.candidate_id;
 select full_name into president from public.profiles where id=new.invited_by;
 select head_id into head from public.government_terms where id=new.government_id and ended_at is null;
 if head is null and exists(select 1 from public.executive_office_definitions where office_key=new.office_key and not government_bound) then select head_id into head from public.government_terms where ended_at is null and term_ends_at>clock_timestamp() order by term_starts_at desc limit 1;end if;
 if tg_op='INSERT' then
  insert into public.notifications(user_id,sender_id,type,content,link,metadata) values(new.candidate_id,new.invited_by,'minister_invitation',
   'O Presidente '||president||' convidou você para assumir o '||ministry||'.','/dashboard',jsonb_build_object('invitation_id',new.id,'expires_at',new.expires_at));
 elsif new.status is distinct from old.status then
  if head is not null then
   insert into public.notifications(user_id,sender_id,type,content,link,metadata) values(head,auth.uid(),'minister_invitation_response',
    case new.status when 'accepted' then candidate||' aceitou o convite para o '||ministry||'.' when 'declined' then candidate||' recusou o convite para o '||ministry||'.' when 'expired' then 'O convite para '||candidate||' assumir o '||ministry||' expirou.' else 'O convite para o '||ministry||' foi cancelado.' end,
    '/dashboard/president',jsonb_build_object('invitation_id',new.id,'status',new.status));
  end if;
  if new.status in('declined','expired','cancelled') then
   update public.presidential_formation set completed_at=null,status='in_progress' where government_id=new.government_id and ended_at is null and completed_at is null;
  end if;
 end if;
 perform economy_private.audit('minister_invitation_'||new.status,'minister_invitation',new.id::text,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),'Fluxo de convite ministerial.',auth.uid());
 return new;
end $function$


-- Em sucessao com gabinete mantido, exigir tres ministros se a equipe for menor.
CREATE OR REPLACE FUNCTION public.choose_government_cabinet(p_choice text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g public.government_terms%rowtype; v_ministers integer;
BEGIN
 IF auth.uid() IS NULL OR (coalesce(public.get_user_role(auth.uid()),'')<>'Presidente' and not public.has_full_admin_access()) THEN RAISE EXCEPTION 'Somente a chefia do Governo pode escolher a equipe.' USING errcode='42501'; END IF;
 IF p_choice NOT IN ('keep','reform') OR p_choice IS NULL THEN RAISE EXCEPTION 'Escolha manter a equipe ou formar uma nova.'; END IF;
 SELECT * INTO g FROM public.government_terms WHERE ended_at IS NULL AND (head_id=auth.uid() OR public.has_full_admin_access()) ORDER BY term_starts_at DESC LIMIT 1 FOR UPDATE;
 IF g.id IS NULL THEN RAISE EXCEPTION 'Não há Governo ativo sob sua chefia.'; END IF;
 IF g.cabinet_decision<>'pending' THEN RETURN to_jsonb(g); END IF;
 IF p_choice='reform' THEN PERFORM private.end_government_cabinet(g.id,'Reforma ministerial decidida pela nova chefia do Governo.');
 ELSE
  INSERT INTO public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id,metadata)
  SELECT user_id,ministry_id,'retained','Equipe mantida após sucessão presidencial.',auth.uid(),jsonb_build_object('government_id',g.id,'head_id',g.head_id)
  FROM public.ministers WHERE government_id=g.id AND status='active';
  SELECT count(distinct m.ministry_id) INTO v_ministers FROM public.ministers m JOIN public.government_ministries gm ON gm.id=m.ministry_id AND gm.is_active WHERE m.government_id=g.id AND m.status='active';
  UPDATE public.presidential_formation SET status=CASE WHEN v_ministers>=3 THEN 'completed' ELSE 'in_progress' END,completed_at=CASE WHEN v_ministers>=3 THEN coalesce(completed_at,clock_timestamp()) ELSE NULL END WHERE government_id=g.id AND user_id=g.head_id AND ended_at IS NULL;
 END IF;
 UPDATE public.government_terms SET cabinet_decision=CASE WHEN p_choice='keep' THEN 'kept' ELSE 'reformed' END WHERE id=g.id RETURNING * INTO g;
 PERFORM public.justice_write_audit('executive.cabinet_choice','government',g.id,NULL,to_jsonb(g),'Escolha ministerial após sucessão.');
 RETURN to_jsonb(g);
END; $function$


COMMIT;
