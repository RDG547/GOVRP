-- Extend existing social entities; private attachments never become public assets.
alter table public.x_messages add column edit_count integer not null default 0 check(edit_count>=0),
 add column edited_at timestamptz, add column deleted_at timestamptz,
 add column attachment jsonb, add column client_request_id uuid;
create unique index x_message_request_unique on public.x_messages(sender_id,client_request_id) where client_request_id is not null;
revoke insert,update,delete on public.x_messages,public.x_conversations,public.x_conversation_participants from anon,authenticated;

create or replace function public.x_is_participant(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.x_conversation_participants where conversation_id=p_conversation_id and user_id=auth.uid())
$$;
revoke all on function public.x_is_participant(uuid) from public,anon;
grant execute on function public.x_is_participant(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('x-message-attachments','x-message-attachments',false,10485760,array['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document']) on conflict(id) do nothing;
create policy x_attachment_upload on storage.objects for insert to authenticated with check(
 bucket_id='x-message-attachments' and (storage.foldername(name))[2]=auth.uid()::text
 and public.x_is_participant(((storage.foldername(name))[1])::uuid));
create policy x_attachment_read on storage.objects for select to authenticated using(
 bucket_id='x-message-attachments' and public.x_is_participant(((storage.foldername(name))[1])::uuid)
 and ((storage.foldername(name))[2]=auth.uid()::text or exists(select 1 from public.x_messages m where m.attachment->>'path'=name and m.deleted_at is null)));
create policy x_attachment_cleanup on storage.objects for delete to authenticated using(
 bucket_id='x-message-attachments' and (storage.foldername(name))[2]=auth.uid()::text
 and not exists(select 1 from public.x_messages m where m.attachment->>'path'=name and m.deleted_at is null));

create or replace function public.send_x_message(p_recipient_id uuid,p_content text,p_attachment jsonb,p_request_id uuid)
returns json language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); conversation uuid; message public.x_messages%rowtype; object storage.objects%rowtype; file jsonb;
begin
 if actor is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_request_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
  select * into message from public.x_messages where sender_id=actor and client_request_id=p_request_id;
  if found then return json_build_object('success',true,'conversation_id',message.conversation_id,'message',row_to_json(message)); end if;
 end if;
 if p_recipient_id=actor then raise exception 'Escolha outro participante.'; end if;
 if length(btrim(coalesce(p_content,'')))>4000 or (nullif(btrim(p_content),'') is null and p_attachment is null) then raise exception 'Informe uma mensagem ou anexe um arquivo de até 10 MB.'; end if;
 if (select count(*) from public.profiles where id in(actor,p_recipient_id) and deleted_at is null and (onboarding_completed or onboarding_mode='legacy_migration') and x_handle is not null)<>2 then raise exception 'Participante indisponível no X.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(actor::text,p_recipient_id::text)||greatest(actor::text,p_recipient_id::text),0));
 select a.conversation_id into conversation from public.x_conversation_participants a join public.x_conversation_participants b on a.conversation_id=b.conversation_id where a.user_id=actor and b.user_id=p_recipient_id order by a.conversation_id limit 1;
 if conversation is null then
  insert into public.x_conversations default values returning id into conversation;
  insert into public.x_conversation_participants(conversation_id,user_id) values(conversation,actor),(conversation,p_recipient_id);
 end if;
 if p_attachment is not null then
  select * into object from storage.objects where bucket_id='x-message-attachments' and name=p_attachment->>'path';
  if not found or split_part(object.name,'/',1)<>conversation::text or split_part(object.name,'/',2)<>actor::text or object.owner_id<>actor::text then raise exception 'Arquivo indisponível para esta conversa.'; end if;
  if coalesce((object.metadata->>'size')::bigint,0) not between 1 and 10485760 or object.metadata->>'mimetype' not in('image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document') then raise exception 'Tipo ou tamanho do arquivo não permitido.'; end if;
  file:=jsonb_build_object('path',object.name,'name',left(coalesce(p_attachment->>'name','Arquivo'),180),'type',object.metadata->>'mimetype','size',(object.metadata->>'size')::bigint);
 end if;
 insert into public.x_messages(conversation_id,sender_id,content,attachment,client_request_id) values(conversation,actor,btrim(coalesce(p_content,'')),file,p_request_id) returning * into message;
 update public.x_conversations set updated_at=clock_timestamp() where id=conversation;
 insert into public.notifications(user_id,sender_id,type,content,link) values(p_recipient_id,actor,'x_dm','enviou uma nova mensagem.','/services/x/messages/'||conversation);
 return json_build_object('success',true,'conversation_id',conversation,'message',row_to_json(message));
end $$;
create or replace function public.send_x_message(p_recipient_id uuid,p_content text)
returns json language sql security invoker set search_path='' as $$ select public.send_x_message(p_recipient_id,p_content,null,null) $$;
revoke all on function public.send_x_message(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.send_x_message(uuid,text,jsonb,uuid) to authenticated;

create or replace function public.edit_x_message(p_message_id uuid,p_content text)
returns public.x_messages language plpgsql security definer set search_path='' as $$
declare message public.x_messages%rowtype;
begin
 select * into message from public.x_messages where id=p_message_id and sender_id=auth.uid() and deleted_at is null for update;
 if not found or not public.x_is_participant(message.conversation_id) then raise exception 'Você só pode editar suas próprias mensagens.'; end if;
 if length(trim(coalesce(p_content,''))) not between 1 and 4000 then raise exception 'A mensagem deve ter entre 1 e 4.000 caracteres.'; end if;
 if message.content<>trim(p_content) then update public.x_messages set content=trim(p_content),edit_count=edit_count+1,edited_at=clock_timestamp() where id=p_message_id returning * into message; end if;
 return message;
end $$;
create or replace function public.remove_x_message(p_message_id uuid)
returns public.x_messages language plpgsql security definer set search_path='' as $$
declare message public.x_messages%rowtype;
begin
 select * into message from public.x_messages where id=p_message_id and sender_id=auth.uid() for update;
 if not found or not public.x_is_participant(message.conversation_id) then raise exception 'Você só pode apagar suas próprias mensagens.'; end if;
 if message.deleted_at is null then update public.x_messages set content='',attachment=null,deleted_at=clock_timestamp() where id=p_message_id returning * into message; end if;
 return message;
end $$;
revoke all on function public.edit_x_message(uuid,text),public.remove_x_message(uuid) from public,anon;
grant execute on function public.edit_x_message(uuid,text),public.remove_x_message(uuid) to authenticated;

create table public.comment_likes(comment_id uuid not null references public.comments(id) on delete cascade,user_id uuid not null references public.profiles(id) on delete cascade,created_at timestamptz not null default now(),primary key(comment_id,user_id));
alter table public.comment_likes enable row level security;
grant select on public.comment_likes to authenticated;
create policy comment_likes_read on public.comment_likes for select to authenticated using(exists(select 1 from public.comments c join public.posts p on p.id=c.post_id where c.id=comment_id and c.deleted_at is null));
create or replace function public.set_x_comment_like(p_comment_id uuid,p_liked boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 perform id from public.comments where id=p_comment_id and deleted_at is null for update;
 if not found then raise exception 'Este comentário foi removido.'; end if;
 if p_liked then insert into public.comment_likes(comment_id,user_id) values(p_comment_id,auth.uid()) on conflict do nothing;
 else delete from public.comment_likes where comment_id=p_comment_id and user_id=auth.uid(); end if;
 return p_liked;
end $$;
revoke all on function public.set_x_comment_like(uuid,boolean) from public,anon;
grant execute on function public.set_x_comment_like(uuid,boolean) to authenticated;
alter table public.comment_likes replica identity full;
alter publication supabase_realtime add table public.comment_likes;

create or replace function public.get_x_follow_page(p_user_id uuid,p_direction text,p_offset integer default 0,p_search text default '')
returns table(id uuid,x_username text,x_handle text,x_avatar_url text,x_bio text,is_following boolean,total_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_direction not in('followers','following') then raise exception 'INVALID_DIRECTION'; end if;
 return query select p.id,coalesce(p.x_username,p.full_name),p.x_handle,coalesce(nullif(p.x_avatar_url,''),p.avatar_url),p.x_bio,
 exists(select 1 from public.followers mine where mine.follower_id=auth.uid() and mine.following_id=p.id),count(*) over()
 from public.followers f join public.profiles p on p.id=case when p_direction='followers' then f.follower_id else f.following_id end
 where (case when p_direction='followers' then f.following_id else f.follower_id end)=p_user_id
 and p.deleted_at is null and p.x_handle is not null and (p.onboarding_completed or p.onboarding_mode='legacy_migration')
 and position(lower(coalesce(p_search,'')) in lower(concat_ws(' ',p.x_username,p.x_handle,p.full_name)))>0
 order by f.created_at desc,p.id limit 30 offset greatest(coalesce(p_offset,0),0);
end $$;
revoke all on function public.get_x_follow_page(uuid,text,integer,text) from public,anon;
grant execute on function public.get_x_follow_page(uuid,text,integer,text) to authenticated;

create or replace function public.resolve_x_mentions(p_handles text[])
returns table(x_handle text) language sql stable security definer set search_path='' as $$
 select p.x_handle from public.profiles p where auth.uid() is not null and p.x_handle=any(p_handles[1:100]) and p.deleted_at is null and (p.onboarding_completed or p.onboarding_mode='legacy_migration')
$$;
revoke all on function public.resolve_x_mentions(text[]) from public,anon;
grant execute on function public.resolve_x_mentions(text[]) to authenticated;
notify pgrst,'reload schema';
