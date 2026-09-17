-- Founding and subsequent leadership changes share the existing notification inbox.
create or replace function private.notify_party_membership_confirmed()
returns trigger language plpgsql security definer set search_path='' as $$
declare party public.political_parties%rowtype; founding boolean;
begin
 select * into party from public.political_parties where id=new.party_id;
 founding:=party.founder_id=new.user_id and party.owner_id=new.user_id and not exists(select 1 from public.party_members where party_id=new.party_id and id<>new.id);
 insert into public.notifications(user_id,type,content,link,metadata)
 values(new.user_id,case when founding then 'party_founded' else 'party_membership_confirmed' end,
 case when founding then 'Você fundou o partido ' else 'Sua filiação foi confirmada: ' end||party.name||'.','/services/political-parties/'||party.id,
 jsonb_build_object('membership_id',new.id,'party_id',party.id,'party_name',party.name,'party_acronym',party.acronym,'logo_url',party.logo_url));
 return new;
end $$;

create or replace function private.notify_party_leadership_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare item record;
begin
 for item in select * from (values('Dono',old.owner_id,new.owner_id),('Presidente',old.president_id,new.president_id),('Vice-Presidente',old.vice_president_id,new.vice_president_id)) roles(label,previous_id,next_id) loop
  if item.previous_id is distinct from item.next_id then
   if item.next_id is not null then
    insert into public.notifications(user_id,sender_id,type,content,link,metadata) values(item.next_id,auth.uid(),'party_role_changed','Você assumiu a função de '||item.label||' do partido '||new.name||'.','/services/political-parties/'||new.id,jsonb_build_object('party_id',new.id,'new_role',item.label,'loss',false));
   end if;
   if item.previous_id is not null then
    insert into public.notifications(user_id,sender_id,type,content,link,metadata) values(item.previous_id,auth.uid(),'party_role_changed','Sua função de '||item.label||' do partido '||new.name||' foi encerrada.','/services/political-parties/'||new.id,jsonb_build_object('party_id',new.id,'old_role',item.label,'loss',true));
   end if;
  end if;
 end loop;
 return new;
end $$;
revoke all on function private.notify_party_leadership_change() from public,anon,authenticated;
create trigger party_leadership_notification after update of owner_id,president_id,vice_president_id on public.political_parties for each row execute function private.notify_party_leadership_change();
create or replace function public.acknowledge_party_welcome(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 update public.notifications set metadata=jsonb_set(coalesce(metadata,'{}'),'{celebration_seen_at}',to_jsonb(clock_timestamp())),is_read=true
 where id=p_notification_id and user_id=auth.uid() and type in('party_membership_confirmed','party_approved','party_founded','party_role_changed') and metadata->>'celebration_seen_at' is null;
 return found;
end $$;

create or replace function public.disaffiliate_from_party(p_party_id uuid,p_new_founder_id uuid default null)
returns json language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); party public.political_parties%rowtype; member_count integer;
begin
 if actor is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into party from public.political_parties where id=p_party_id for update;
 if not found or not exists(select 1 from public.party_members where party_id=p_party_id and user_id=actor) then return json_build_object('success',false,'message','Você não é membro deste partido.'); end if;
 select count(*) into member_count from public.party_members where party_id=p_party_id;
 if member_count=1 then
  update public.political_parties set status='Encerrado',is_active=false,owner_id=null,president_id=null,vice_president_id=null where id=p_party_id;
  delete from public.party_members where party_id=p_party_id and user_id=actor;
  update public.profiles set party_affiliation=null where id=actor and party_affiliation=p_party_id;
  update public.party_affiliation_requests set status='rejected' where party_id=p_party_id and status='pending';
  insert into public.party_history(party_id,actor_id,event_type,summary,previous_state) values(p_party_id,actor,'party_closed','Último integrante saiu e encerrou o partido. Histórico preservado.',to_jsonb(party));
  return json_build_object('success',true,'message','Você saiu e o partido foi encerrado. Seu histórico permanece preservado.');
 end if;
 if party.owner_id=actor then
  if p_new_founder_id is null or p_new_founder_id=actor or not exists(select 1 from public.party_members where party_id=p_party_id and user_id=p_new_founder_id) then return json_build_object('success',false,'message','Selecione outro integrante para receber a propriedade antes de sair.'); end if;
  update public.political_parties set owner_id=p_new_founder_id,president_id=case when president_id=actor then p_new_founder_id else president_id end,vice_president_id=case when vice_president_id in(actor,p_new_founder_id) then null else vice_president_id end where id=p_party_id;
  update public.party_members set role='Dono' where party_id=p_party_id and user_id=p_new_founder_id;
 else
  update public.political_parties set president_id=case when president_id=actor then null else president_id end,vice_president_id=case when vice_president_id=actor then null else vice_president_id end where id=p_party_id;
 end if;
 delete from public.party_members where party_id=p_party_id and user_id=actor;
 update public.profiles set party_affiliation=null where id=actor and party_affiliation=p_party_id;
 insert into public.party_history(party_id,actor_id,event_type,summary,previous_state) values(p_party_id,actor,'member_left','Integrante saiu do partido.',jsonb_build_object('user_id',actor,'role',party.status));
 return json_build_object('success',true,'message','Desfiliação concluída. O fundador histórico foi preservado.');
end $$;

create or replace function public.set_party_leadership(p_party_id uuid,p_member_id uuid,p_role text)
returns json language plpgsql security definer set search_path='' as $$
declare party public.political_parties%rowtype; owner_id uuid; president_id uuid; vice_id uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into party from public.political_parties where id=p_party_id and status<>'Encerrado' for update;
 if not found then raise exception 'Este partido não está disponível.'; end if;
 if not (auth.uid()=party.owner_id or auth.uid()=party.president_id or public.get_user_role(auth.uid())='Admin') is true then raise exception 'Sem permissão para alterar a liderança.'; end if;
 if not exists(select 1 from public.party_members where party_id=p_party_id and user_id=p_member_id) then raise exception 'O cidadão precisa integrar este partido.'; end if;
 owner_id:=party.owner_id; president_id:=party.president_id; vice_id:=party.vice_president_id;
 if p_role='Dono' then owner_id:=p_member_id;
 elsif p_role='Presidente' then president_id:=p_member_id;
 elsif p_role='Vice-Presidente' then vice_id:=p_member_id;
 elsif p_role='Membro' then
  if p_member_id=owner_id then raise exception 'Transfira a propriedade antes de remover a função do dono.'; end if;
  if president_id=p_member_id then president_id:=null; end if;
  if vice_id=p_member_id then vice_id:=null; end if;
 else raise exception 'Função partidária inválida.'; end if;
 if p_role in('Dono','Presidente') and vice_id=p_member_id then vice_id:=null; end if;
 return public.update_party_details(party.id,party.name,party.acronym,party.ideology,party.statute,party.logo_url,owner_id,president_id,vice_id,party.description,party.orientation);
end $$;
revoke all on function public.set_party_leadership(uuid,uuid,text) from public,anon;
grant execute on function public.set_party_leadership(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';

create or replace function public.update_party_details(
  p_party_id uuid,p_name text,p_acronym text,p_ideology text,p_statute text,p_logo_url text,
  p_owner_id uuid,p_president_id uuid,p_vice_president_id uuid,p_description text,p_orientation public.political_orientation
)
returns json language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); party public.political_parties%rowtype; admin boolean; prior jsonb;
begin
  select * into party from public.political_parties where id=p_party_id for update;
  if not found then return json_build_object('success',false,'message','Partido não encontrado.'); end if;
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  admin:=coalesce(public.get_user_role(actor)='Admin',false);
  if not admin and not coalesce(actor=party.owner_id or actor=party.president_id,false) then return json_build_object('success',false,'message','Sem permissão para editar este partido.'); end if;
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
