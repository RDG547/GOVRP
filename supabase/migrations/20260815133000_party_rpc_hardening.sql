-- Elimina atalhos partidários legados e preserva Dono + Presidente simultâneos.

revoke all on function public.join_party(uuid) from public,anon,authenticated;
revoke all on function public.leave_party(uuid) from public,anon,authenticated;
revoke all on function public.manage_party_affiliation(uuid) from public,anon,authenticated;
revoke all on function public.update_party_details(uuid,text,text,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.update_party_details(uuid,text,text,text,uuid,uuid,text,public.political_orientation) from public,anon,authenticated;
revoke all on function public.update_party_details(uuid,text,text,text,text,text,uuid,uuid,text,public.political_orientation) from public,anon,authenticated;
revoke all on function public.create_political_party(text,text,text,text,text,text,public.political_orientation) from public,anon;
grant execute on function public.create_political_party(text,text,text,text,text,text,public.political_orientation) to authenticated,service_role;

create or replace function public.delete_party(p_party_id uuid)
returns json language plpgsql security definer set search_path='' as $$
declare party public.political_parties%rowtype;
begin
  select * into party from public.political_parties where id=p_party_id for update;
  if not found then return json_build_object('success',false,'message','Partido não encontrado.'); end if;
  if auth.uid()<>party.owner_id and public.get_user_role(auth.uid())<>'Admin' then return json_build_object('success',false,'message','Apenas o dono atual pode encerrar o partido.'); end if;
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state)
  values(party.id,auth.uid(),'party_closed','Partido encerrado pelo dono atual ou pela administração.',to_jsonb(party));
  update public.political_parties set status='Encerrado',is_active=false where id=p_party_id;
  return json_build_object('success',true,'message','Partido encerrado com sucesso.');
end; $$;
revoke all on function public.delete_party(uuid) from public,anon;
grant execute on function public.delete_party(uuid) to authenticated,service_role;

create or replace function public.request_party_affiliation(p_party_id uuid)
returns json language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); party public.political_parties%rowtype; current_party uuid; actor_name text;
begin
  if actor is null then return json_build_object('success',false,'message','Faça login para solicitar filiação.'); end if;
  select * into party from public.political_parties where id=p_party_id;
  if not found then return json_build_object('success',false,'message','Partido não encontrado.'); end if;
  if party.status='Encerrado' then return json_build_object('success',false,'message','Este partido foi encerrado.'); end if;
  select party_id into current_party from public.party_members where user_id=actor;
  if current_party=p_party_id then return json_build_object('success',false,'message','Você já integra este partido.'); end if;
  if current_party is not null then return json_build_object('success',false,'message','Desfilie-se do partido atual antes de solicitar outra filiação.'); end if;
  if party.affiliation_mode='automatic' then
    insert into public.party_members(party_id,user_id,role) values(party.id,actor,'Membro');
    update public.profiles set party_affiliation=party.id where id=actor;
    select coalesce(full_name,username,'Novo membro') into actor_name from public.profiles where id=actor;
    insert into public.notifications(user_id,sender_id,type,content,link)
    select distinct pm.user_id,actor,'party_member_joined',actor_name||' entrou para o partido '||party.name||'.','/services/political-parties/'||party.id from public.party_members pm where pm.party_id=party.id and pm.user_id<>actor;
    insert into public.party_history(party_id,actor_id,event_type,summary,current_state) values(party.id,actor,'member_joined',actor_name||' filiou-se ao partido.',jsonb_build_object('userId',actor,'role','Membro'));
    return json_build_object('success',true,'message','Filiação concluída.');
  end if;
  if exists(select 1 from public.party_affiliation_requests where user_id=actor and party_id=party.id and status='pending') then return json_build_object('success',false,'message','Já existe uma solicitação pendente.'); end if;
  insert into public.party_affiliation_requests(user_id,party_id,status) values(actor,party.id,'pending');
  insert into public.notifications(user_id,sender_id,type,content,link)
  select distinct pm.user_id,actor,'party_affiliation_request','Nova solicitação de filiação para '||party.name||'.','/services/political-parties/'||party.id
  from public.party_members pm where pm.party_id=party.id and pm.role in('Dono','Presidente','Vice-Presidente');
  return json_build_object('success',true,'message','Solicitação enviada à liderança partidária.');
end; $$;

create or replace function public.respond_to_affiliation_request(p_request_id uuid,p_is_approved boolean)
returns json language plpgsql security definer set search_path='' as $$
declare request public.party_affiliation_requests%rowtype; actor_role public.party_role; party_name text; applicant_name text;
begin
  select * into request from public.party_affiliation_requests where id=p_request_id for update;
  if not found or request.status<>'pending' then return json_build_object('success',false,'message','Solicitação indisponível.'); end if;
  select role into actor_role from public.party_members where party_id=request.party_id and user_id=auth.uid();
  if actor_role not in('Dono','Presidente','Vice-Presidente') and public.get_user_role(auth.uid())<>'Admin' then return json_build_object('success',false,'message','Sem permissão para decidir esta solicitação.'); end if;
  select name into party_name from public.political_parties where id=request.party_id;
  select coalesce(full_name,username,'Cidadão') into applicant_name from public.profiles where id=request.user_id;
  if p_is_approved then
    if exists(select 1 from public.party_members where user_id=request.user_id) then return json_build_object('success',false,'message','O solicitante já está filiado a outro partido.'); end if;
    insert into public.party_members(party_id,user_id,role) values(request.party_id,request.user_id,'Membro');
    update public.profiles set party_affiliation=request.party_id where id=request.user_id;
  end if;
  update public.party_affiliation_requests set status=case when p_is_approved then 'approved' else 'rejected' end where id=request.id;
  insert into public.party_history(party_id,actor_id,event_type,summary,current_state)
  values(request.party_id,auth.uid(),case when p_is_approved then 'affiliation_approved' else 'affiliation_rejected' end,'Solicitação de '||applicant_name||case when p_is_approved then ' aprovada.' else ' rejeitada.' end,jsonb_build_object('userId',request.user_id));
  insert into public.notifications(user_id,sender_id,type,content,link) values(request.user_id,auth.uid(),'party_affiliation_decided','Sua solicitação para '||party_name||case when p_is_approved then ' foi aprovada.' else ' foi rejeitada.' end,'/services/political-parties/'||request.party_id);
  return json_build_object('success',true,'message',case when p_is_approved then 'Membro aprovado.' else 'Solicitação rejeitada.' end);
end; $$;

create or replace function public.toggle_party_affiliation_mode(p_party_id uuid,p_mode text)
returns json language plpgsql security definer set search_path='' as $$
declare party public.political_parties%rowtype;
begin
  select * into party from public.political_parties where id=p_party_id for update;
  if not found then return json_build_object('success',false,'message','Partido não encontrado.'); end if;
  if auth.uid() not in(party.owner_id,party.president_id) and public.get_user_role(auth.uid())<>'Admin' then return json_build_object('success',false,'message','Somente o dono ou presidente pode alterar as filiações.'); end if;
  if p_mode not in('automatic','manual') then return json_build_object('success',false,'message','Modo de filiação inválido.'); end if;
  update public.political_parties set affiliation_mode=p_mode where id=party.id;
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state,current_state) values(party.id,auth.uid(),'affiliation_mode_changed','Modo de filiação atualizado.',jsonb_build_object('mode',party.affiliation_mode),jsonb_build_object('mode',p_mode));
  return json_build_object('success',true,'message','Modo de filiação atualizado.');
end; $$;

create or replace function public.update_party_customization(p_party_id uuid,p_customization jsonb)
returns json language plpgsql security definer set search_path='' as $$
declare party public.political_parties%rowtype;
begin
  select * into party from public.political_parties where id=p_party_id for update;
  if not found then return json_build_object('success',false,'message','Partido não encontrado.'); end if;
  if auth.uid() not in(party.owner_id,party.president_id) and public.get_user_role(auth.uid())<>'Admin' then return json_build_object('success',false,'message','Sem permissão para personalizar o partido.'); end if;
  if p_customization is null or jsonb_typeof(p_customization)<>'object' then return json_build_object('success',false,'message','Personalização inválida.'); end if;
  update public.political_parties set customization=p_customization where id=party.id;
  insert into public.party_history(party_id,actor_id,event_type,summary,current_state) values(party.id,auth.uid(),'customization_updated','Página partidária personalizada.',p_customization);
  return json_build_object('success',true,'message','Página do partido atualizada.');
end; $$;

create or replace function public.update_party_details(
  p_party_id uuid,p_name text,p_acronym text,p_ideology text,p_statute text,p_logo_url text,
  p_owner_id uuid,p_president_id uuid,p_vice_president_id uuid,p_description text,p_orientation public.political_orientation
)
returns json language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); party public.political_parties%rowtype; admin boolean; prior jsonb;
begin
  select * into party from public.political_parties where id=p_party_id for update;
  if not found then return json_build_object('success',false,'message','Partido não encontrado.'); end if;
  admin:=public.get_user_role(actor)='Admin';
  if not admin and actor not in(party.owner_id,party.president_id) then return json_build_object('success',false,'message','Sem permissão para editar este partido.'); end if;
  if not admin and actor=party.president_id and actor<>party.owner_id and p_owner_id is distinct from party.owner_id then return json_build_object('success',false,'message','O presidente não pode transferir a propriedade.'); end if;
  if p_owner_id is null or not exists(select 1 from public.party_members where party_id=p_party_id and user_id=p_owner_id) then return json_build_object('success',false,'message','O dono precisa integrar o partido.'); end if;
  if p_president_id is not null and not exists(select 1 from public.party_members where party_id=p_party_id and user_id=p_president_id) then return json_build_object('success',false,'message','O presidente precisa integrar o partido.'); end if;
  if p_vice_president_id is not null and (p_vice_president_id in(p_owner_id,p_president_id) or not exists(select 1 from public.party_members where party_id=p_party_id and user_id=p_vice_president_id)) then return json_build_object('success',false,'message','O vice-presidente precisa ser outro integrante do partido.'); end if;
  if length(trim(coalesce(p_name,'')))<3 or length(trim(coalesce(p_acronym,'')))<2 then return json_build_object('success',false,'message','Nome e sigla são obrigatórios.'); end if;
  prior:=to_jsonb(party);
  update public.political_parties set name=trim(p_name),acronym=upper(trim(p_acronym)),ideology=trim(p_ideology),statute=p_statute,logo_url=p_logo_url,owner_id=p_owner_id,president_id=p_president_id,vice_president_id=p_vice_president_id,description=p_description,orientation=p_orientation where id=p_party_id;
  update public.party_members set role=case when user_id=p_owner_id then 'Dono'::public.party_role when user_id=p_president_id then 'Presidente'::public.party_role when user_id=p_vice_president_id then 'Vice-Presidente'::public.party_role else 'Membro'::public.party_role end where party_id=p_party_id;
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state,current_state) values(p_party_id,actor,'party_updated','Estrutura e dados partidários atualizados.',prior,jsonb_build_object('ownerId',p_owner_id,'presidentId',p_president_id,'vicePresidentId',p_vice_president_id,'name',trim(p_name)));
  return json_build_object('success',true,'message','Partido atualizado com sucesso.');
end; $$;

revoke all on function public.request_party_affiliation(uuid) from public,anon;
revoke all on function public.respond_to_affiliation_request(uuid,boolean) from public,anon;
revoke all on function public.toggle_party_affiliation_mode(uuid,text) from public,anon;
revoke all on function public.update_party_customization(uuid,jsonb) from public,anon;
grant execute on function public.request_party_affiliation(uuid) to authenticated,service_role;
grant execute on function public.respond_to_affiliation_request(uuid,boolean) to authenticated,service_role;
grant execute on function public.toggle_party_affiliation_mode(uuid,text) to authenticated,service_role;
grant execute on function public.update_party_customization(uuid,jsonb) to authenticated,service_role;

create or replace function public.update_party_active_status()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_party uuid:=coalesce(new.party_id,old.party_id); member_count integer; party_status text;
begin
  select count(*) into member_count from public.party_members where party_id=target_party;
  select status into party_status from public.political_parties where id=target_party;
  update public.political_parties set is_active=case when party_status='Encerrado' then false else member_count>=5 end where id=target_party;
  return null;
end; $$;
