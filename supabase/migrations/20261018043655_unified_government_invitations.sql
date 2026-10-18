begin;
alter table public.minister_invitations alter column ministry_id drop not null;
alter table public.minister_invitations add column office_key text references public.executive_office_definitions(office_key);
alter table public.minister_invitations add constraint invitation_one_office check ((ministry_id is not null)::integer+(office_key is not null)::integer=1);
create unique index one_pending_strategic_invitation on public.minister_invitations(government_id,office_key) where status='pending' and office_key is not null;
CREATE OR REPLACE FUNCTION private.apply_executive_appointment(p_office_key text, p_user_id uuid, p_note text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb; office public.executive_office_definitions%rowtype; previous jsonb; target public.profiles%rowtype; entry jsonb; event_id uuid:=gen_random_uuid();
begin

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
   update public.profiles set role=coalesce(previous->>'previous_role','Cidadão'),manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=p_actor_id,updated_at=clock_timestamp() where id=(previous->>'user_id')::uuid and role=office.role_label;
 end if;
 if p_user_id is null then cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')-p_office_key);
 else
   entry:=jsonb_build_object('user_id',p_user_id,'appointed_at',clock_timestamp(),'appointed_by',p_actor_id,'previous_role',target.role,'note',p_note,'government_id',(select id from public.government_terms where ended_at is null));
   cfg:=jsonb_set(cfg,'{specialAppointments}',coalesce(cfg->'specialAppointments','{}')||jsonb_build_object(p_office_key,entry));
   update public.profiles set role=office.role_label,manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=p_actor_id,updated_at=clock_timestamp() where id=p_user_id;
 end if;
 insert into public.system_settings(key,value) values('executive_governance',cfg) on conflict(key) do update set value=excluded.value;
 insert into public.dou_entries(title,summary,content,type,source_id,legal_metadata)
 values(case when p_user_id is null then 'Exoneração: ' else 'Nomeação: ' end||office.role_label,
   case when p_user_id is null then 'O cargo foi desocupado.' else target.full_name||' assume o cargo.' end,
   coalesce(p_note,''),'Nomeacao e Exoneracao',event_id,jsonb_build_object('office_key',p_office_key,'actor_id',p_actor_id,'user_id',p_user_id,'previous',previous));
 perform economy_private.audit('executive_appointment_changed','system_settings',p_office_key,previous,entry,coalesce(p_note,'Nomeação executiva.'),p_actor_id);
 return coalesce(entry,'{}');
end; $function$;

revoke all on function private.apply_executive_appointment(text,uuid,text,uuid) from public,anon,authenticated;
alter function public.respond_minister_invitation(uuid,boolean) set schema private;
alter function private.respond_minister_invitation(uuid,boolean) rename to respond_ministry_invitation;
revoke all on function private.respond_ministry_invitation(uuid,boolean) from public,anon,authenticated;
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
   update public.presidential_formation set completed_at=null,status='in_progress' where government_id=new.government_id and ended_at is null;
  end if;
 end if;
 perform economy_private.audit('minister_invitation_'||new.status,'minister_invitation',new.id::text,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),'Fluxo de convite ministerial.',auth.uid());
 return new;
end $function$;

create or replace function public.manage_executive_appointment(p_office_key text,p_user_id uuid default null,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.government_terms%rowtype;i public.minister_invitations%rowtype;
begin
 if auth.uid() is null or (public.get_user_role(auth.uid()) is distinct from 'Presidente' and not public.has_full_admin_access()) then raise exception 'A nomeação exige autoridade presidencial.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 perform private.maintain_minister_invitations();
 select * into g from public.government_terms where ended_at is null and term_ends_at>clock_timestamp() and (head_id=auth.uid() or public.has_full_admin_access()) for update;
 if g.id is null then raise exception 'Não há Governo vigente para esta nomeação.';end if;
 if not exists(select 1 from public.executive_office_definitions where office_key=p_office_key) then raise exception 'Selecione um cargo executivo válido.';end if;
 if p_user_id is null then
  update public.minister_invitations set status='cancelled',responded_at=clock_timestamp() where government_id=g.id and office_key=p_office_key and status='pending';
  return private.apply_executive_appointment(p_office_key,null,p_note,auth.uid());
 end if;
 if not private.is_executive_candidate(p_user_id,p_office_key) then raise exception 'Este cidadão não está elegível para a nomeação.';end if;
 select * into i from public.minister_invitations where government_id=g.id and office_key=p_office_key and status='pending' for update;
 if i.candidate_id=p_user_id then return jsonb_build_object('success',true,'invitation',to_jsonb(i),'message','Convite aguardando resposta.');end if;
 update public.minister_invitations set status='cancelled',responded_at=clock_timestamp() where id=i.id;
 insert into public.minister_invitations(government_id,office_key,candidate_id,invited_by) values(g.id,p_office_key,p_user_id,g.head_id) returning * into i;
 return jsonb_build_object('success',true,'invitation',to_jsonb(i),'message','Convite enviado. O cargo será atribuído somente após o aceite.');
end $$;

create or replace function public.respond_minister_invitation(p_invitation_id uuid,p_accept boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.minister_invitations%rowtype;
begin
 if auth.uid() is null or p_accept is null then raise exception 'Entre para responder ao convite.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 perform pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 select * into i from public.minister_invitations where id=p_invitation_id and candidate_id=auth.uid() for update;
 if i.id is null then raise exception 'Este convite não pertence à sua conta.' using errcode='42501';end if;
 if i.office_key is null then return private.respond_ministry_invitation(i.id,p_accept);end if;
 if i.status<>'pending' then return jsonb_build_object('success',i.status in ('accepted','declined'),'status',i.status,'message','Este convite já foi encerrado.');end if;
 perform private.maintain_minister_invitations();select * into i from public.minister_invitations where id=i.id;
 if i.status<>'pending' then return jsonb_build_object('success',false,'status',i.status,'message','O convite expirou ou o Governo foi encerrado.');end if;
 if p_accept then
  perform private.apply_executive_appointment(i.office_key,auth.uid(),'Nomeação efetivada após aceite do convite '||i.id,i.invited_by);
 end if;
 update public.minister_invitations set status=case when p_accept then 'accepted' else 'declined' end,responded_at=clock_timestamp() where id=i.id;
 return jsonb_build_object('success',true,'status',case when p_accept then 'accepted' else 'declined' end,'message',case when p_accept then 'Convite aceito. Suas funções foram atualizadas.' else 'Convite recusado.' end);
end $$;
revoke all on function public.respond_minister_invitation(uuid,boolean) from public,anon;
grant execute on function public.respond_minister_invitation(uuid,boolean) to authenticated;

create or replace function public.get_my_invitations() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Entre para consultar seus convites.' using errcode='42501';end if;
 perform private.maintain_minister_invitations();
 return jsonb_build_object('server_now',clock_timestamp(),'items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('office',coalesce(m.name,o.role_label),'inviter',p.full_name,'kind','government') order by i.created_at desc) from public.minister_invitations i left join public.government_ministries m on m.id=i.ministry_id left join public.executive_office_definitions o on o.office_key=i.office_key left join public.profiles p on p.id=i.invited_by where i.candidate_id=auth.uid()),'[]'::jsonb));
end $$;
revoke all on function public.get_my_invitations() from public,anon;
grant execute on function public.get_my_invitations() to authenticated;

commit;
