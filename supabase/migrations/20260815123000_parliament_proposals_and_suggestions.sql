-- Casa legislativa autoritativa e ciclo rastreável das sugestões cidadãs.

alter table public.bill_suggestions
  add column if not exists bill_type text not null default 'PL',
  add column if not exists adopted_by uuid references public.profiles(id) on delete set null,
  add column if not exists adopted_bill_id uuid references public.bills(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.propose_parliament_bill(p_title text,p_summary text,p_full_text text,p_type text,p_house_id uuid default null)
returns public.bills
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text; resolved_house uuid; result public.bills%rowtype;
begin
  select role into actor_role from public.profiles where id=actor;
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_summary,'')))<15 then raise exception 'Título e resumo precisam ser completos.'; end if;
  if actor_role='Admin' then
    resolved_house:=p_house_id;
  else
    select pm.house_id into resolved_house from public.parliament_members pm
    where pm.user_id=actor and pm.term_start_date<=current_date and pm.term_end_date>=current_date
    order by pm.term_end_date desc limit 1;
  end if;
  if resolved_house is null or not exists(select 1 from public.parliament_houses where id=resolved_house) then raise exception 'Casa legislativa não autorizada para este mandato.'; end if;
  if actor_role<>'Admin' and not exists(select 1 from public.parliament_members where user_id=actor and house_id=resolved_house and term_start_date<=current_date and term_end_date>=current_date) then raise exception 'O projeto deve tramitar na Casa do mandato do parlamentar.'; end if;
  insert into public.bills(title,summary,full_text,type,author_id,house_id,author_role,status)
  values(trim(p_title),trim(p_summary),nullif(trim(p_full_text),''),p_type,actor,resolved_house,actor_role,'Em tramitação') returning * into result;
  insert into public.notifications(user_id,sender_id,type,content,link)
  select pm.user_id,actor,'parliament_bill_proposed','Novo projeto em sua Casa: '||result.title,'/services/parliament/panel'
  from public.parliament_members pm where pm.house_id=resolved_house and pm.term_start_date<=current_date and pm.term_end_date>=current_date and pm.user_id<>actor;
  return result;
end; $$;

create or replace function public.submit_bill_suggestion(p_title text,p_suggestion text,p_target_type text,p_target_id uuid,p_bill_type text)
returns json
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result public.bill_suggestions%rowtype;
begin
  if actor is null then return json_build_object('success',false,'message','Faça login para enviar a sugestão.'); end if;
  if p_target_type not in('parliamentarian','party','house') then return json_build_object('success',false,'message','Tipo de destinatário inválido.'); end if;
  if p_bill_type not in('PL','PLC','PEC','PDL','PR','MP') then return json_build_object('success',false,'message','Tipo de projeto inválido.'); end if;
  if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_suggestion,'')))<20 then return json_build_object('success',false,'message','Descreva melhor a proposta.'); end if;
  if p_target_type='house' and not exists(select 1 from public.parliament_houses where id=p_target_id) then return json_build_object('success',false,'message','Casa legislativa inválida.'); end if;
  if p_target_type='party' and not exists(select 1 from public.political_parties where id=p_target_id) then return json_build_object('success',false,'message','Partido inválido.'); end if;
  if p_target_type='parliamentarian' and not exists(select 1 from public.parliament_members where user_id=p_target_id and term_start_date<=current_date and term_end_date>=current_date) then return json_build_object('success',false,'message','Parlamentar sem mandato ativo.'); end if;
  insert into public.bill_suggestions(title,suggestion,author_id,target_type,target_id,status,bill_type)
  values(trim(p_title),trim(p_suggestion),actor,p_target_type,p_target_id,'Pendente',p_bill_type) returning * into result;
  return json_build_object('success',true,'message','Sua sugestão foi enviada e os destinatários foram notificados.','suggestion',to_jsonb(result));
end; $$;

create or replace function public.submit_bill_suggestion(p_title text,p_suggestion text,p_target_type text,p_target_id uuid)
returns json language plpgsql security definer set search_path='' as $$
begin return public.submit_bill_suggestion(p_title,p_suggestion,p_target_type,p_target_id,'PL'); end; $$;

revoke insert on public.bills from authenticated;
grant execute on function public.propose_parliament_bill(text,text,text,text,uuid) to authenticated,service_role;
grant execute on function public.submit_bill_suggestion(text,text,text,uuid,text) to authenticated,service_role;

do $$ begin alter publication supabase_realtime add table public.bill_suggestions; exception when duplicate_object then null; end $$;
