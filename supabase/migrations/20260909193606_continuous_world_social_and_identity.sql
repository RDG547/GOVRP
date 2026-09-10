begin;
alter table public.comments add column edit_count integer not null default 0,
 add column edited_at timestamptz, add column deleted_at timestamptz;

create or replace function private.guard_comment_edits()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
   new.edit_count:=0;new.edited_at:=null;new.deleted_at:=null;
   if new.content is null or length(btrim(new.content))=0 or length(new.content)>10000 then raise exception 'Escreva um comentário de até 10.000 caracteres.'; end if;
 elsif new.content is distinct from old.content and new.deleted_at is null then
   if old.deleted_at is not null then raise exception 'Este comentário foi removido.'; end if;
   if new.content is null or length(btrim(new.content))=0 or length(new.content)>10000 then raise exception 'Escreva um comentário de até 10.000 caracteres.'; end if;
   new.edit_count:=old.edit_count+1;new.edited_at:=clock_timestamp();
 elsif current_user in('authenticated','anon') then
   new.edit_count:=old.edit_count;new.edited_at:=old.edited_at;new.deleted_at:=old.deleted_at;
 end if;
 return new;
end; $$;
create trigger guard_comment_edits before insert or update on public.comments for each row execute function private.guard_comment_edits();

create or replace function public.edit_x_comment(p_comment_id uuid,p_content text)
returns public.comments language plpgsql security definer set search_path='' as $$
declare c public.comments%rowtype; result public.comments%rowtype;
begin
 select * into c from public.comments where id=p_comment_id for update;
 if auth.uid() is null or c.user_id is distinct from auth.uid() then raise exception 'Você só pode editar seus próprios comentários.' using errcode='42501'; end if;
 if c.deleted_at is not null then raise exception 'Este comentário foi removido.'; end if;
 update public.comments set content=btrim(p_content) where id=c.id returning * into result;
 insert into public.security_audit_log(action,target_table,target_id,actor_id,old_data,new_data)
 values('comment_edited','comments',c.id::text,auth.uid(),to_jsonb(c),to_jsonb(result));
 return result;
end; $$;

create or replace function public.remove_x_comment(p_comment_id uuid)
returns public.comments language plpgsql security definer set search_path='' as $$
declare c public.comments%rowtype; result public.comments%rowtype;
begin
 select * into c from public.comments where id=p_comment_id for update;
 if auth.uid() is null or (c.user_id is distinct from auth.uid() and not exists(select 1 from public.profiles where id=auth.uid() and role='Admin' and deleted_at is null)) then raise exception 'Você não tem permissão para remover este comentário.' using errcode='42501'; end if;
 if c.deleted_at is not null then return c; end if;
 update public.comments set content='',deleted_at=clock_timestamp() where id=c.id returning * into result;
 insert into public.security_audit_log(action,target_table,target_id,actor_id,old_data,new_data)
 values('comment_removed','comments',c.id::text,auth.uid(),to_jsonb(c),to_jsonb(result));
 return result;
end; $$;
revoke update,delete on public.comments from authenticated,anon;
revoke all on function public.edit_x_comment(uuid,text),public.remove_x_comment(uuid) from public,anon;
grant execute on function public.edit_x_comment(uuid,text),public.remove_x_comment(uuid) to authenticated;
alter function public.edit_x_comment(uuid,text) owner to postgres;
alter function public.remove_x_comment(uuid) owner to postgres;
revoke all on function private.guard_comment_edits() from public,anon,authenticated;

-- Deterministic fictional precincts; snapshots change only when residence changes.
create or replace function private.assign_electoral_precinct()
returns trigger language plpgsql security definer set search_path='' as $$
declare citizen public.profiles%rowtype; locality text; digest bytea;
begin
 if new.type<>'Título de Eleitor' then return new; end if;
 select * into citizen from public.profiles where id=new.user_id;
 locality:=coalesce(citizen.residence_state_code,'BR')||':'||coalesce(citizen.residence_city_code,citizen.residence_city_name,'GOVRP');
 if new.metadata->>'electoral_locality' is distinct from locality then
   digest:=extensions.digest(locality,'sha256');
   new.metadata:=coalesce(new.metadata,'{}')||jsonb_build_object('electoral_locality',locality,
     'electoral_zone',lpad(((get_byte(digest,0)*256+get_byte(digest,1))%999+1)::text,3,'0'),
     'electoral_section',lpad(((get_byte(digest,2)*256+get_byte(digest,3))%9999+1)::text,4,'0'),
     'electoral_city',citizen.residence_city_name,'electoral_state',citizen.residence_state_code);
 end if;
 return new;
end; $$;
create trigger assign_electoral_precinct before insert or update on public.documents for each row execute function private.assign_electoral_precinct();
update public.documents set metadata=coalesce(metadata,'{}') where type='Título de Eleitor' and is_valid;
create or replace function private.refresh_electoral_residence()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.documents set metadata=metadata-'electoral_locality' where user_id=new.id and type='Título de Eleitor' and is_valid;
 return new;
end; $$;
create trigger refresh_electoral_residence after update of residence_city_code,residence_state_code on public.profiles for each row when (old.residence_city_code is distinct from new.residence_city_code or old.residence_state_code is distinct from new.residence_state_code) execute function private.refresh_electoral_residence();
alter function private.assign_electoral_precinct() owner to postgres;
alter function private.refresh_electoral_residence() owner to postgres;
revoke all on function private.assign_electoral_precinct(),private.refresh_electoral_residence() from public,anon,authenticated;
commit;
