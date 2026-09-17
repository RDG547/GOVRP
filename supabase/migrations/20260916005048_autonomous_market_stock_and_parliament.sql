alter table public.products add column stock_depleted_at timestamptz,add column archived_at timestamptz;
create or replace function private.track_product_stock()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and current_user not in('postgres','supabase_admin','service_role') and new.archived_at is distinct from old.archived_at then raise exception 'O arquivamento é controlado pelo serviço.'; end if;
 if new.product_type='one-time' and coalesce(new.stock,0)<=0 then
  new.stock_depleted_at:=case when tg_op='INSERT' then clock_timestamp() else coalesce(old.stock_depleted_at,clock_timestamp()) end;
 else new.stock_depleted_at:=null;new.archived_at:=null; end if;
 return new;
end $$;
revoke all on function private.track_product_stock() from public,anon,authenticated;
create trigger track_product_stock before insert or update on public.products for each row execute function private.track_product_stock();
update public.products set stock_depleted_at=clock_timestamp() where stock<=0 and product_type='one-time';
create index products_stock_expiry on public.products(stock_depleted_at) where archived_at is null and stock<=0;
create or replace function private.archive_depleted_products()
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.products set archived_at=clock_timestamp() where product_type='one-time' and stock<=0 and archived_at is null and stock_depleted_at<=clock_timestamp()-interval '14 days';
end $$;
revoke all on function private.archive_depleted_products() from public,anon,authenticated;
select cron.schedule('archive-depleted-market-products','* * * * *','select private.archive_depleted_products()');

create or replace function private.finalize_bill_voting(p_voting_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.parliament_votings%rowtype; bill public.bills%rowtype; seats integer; voted integer; yes integer; no integer; approved boolean; other_house uuid; other_result record; next_status text;
begin
 select * into v from public.parliament_votings where id=p_voting_id for update;
 if not found or v.type<>'bill' then raise exception 'BILL_VOTING_NOT_FOUND'; end if;
 if v.status='closed' then return jsonb_build_object('finalized',true,'message','Votação já encerrada.'); end if;
 select * into bill from public.bills where id=v.related_id for update;
 if lower(coalesce(bill.status,'')) in ('sancionado','promulgado','rejeitado','vetado','arquivado','sustado') then
  update public.parliament_votings set status='closed' where id=v.id;
  return jsonb_build_object('finalized',true,'message','Votação encerrada; decisão institucional preservada.');
 end if;
 select count(*) into seats from public.parliament_members where house_id=v.house_id and term_start_date<=(clock_timestamp() at time zone 'America/Sao_Paulo')::date and term_end_date>=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
 select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar') into voted,yes,no from public.parliament_voting_votes where voting_id=v.id;
 if clock_timestamp()<v.end_date and (seats=0 or voted<seats) then return jsonb_build_object('finalized',false); end if;
 approved:=case when bill.type='PEC' then yes>=ceil(greatest(seats,1)*2.0/3.0) else yes>no and yes>0 end;
 next_status:=case when approved then 'Aguardando sanção presidencial' else 'Rejeitado' end;
 if bill.type='PEC' and approved then
  select pv.id,pv.status,pv.house_id,count(pvv.*) filter(where pvv.vote='Aprovar') approvals,
   (select greatest(count(*),1) from public.parliament_members where house_id=pv.house_id and term_start_date<=current_date and term_end_date>=current_date) seats
  into other_result from public.parliament_votings pv left join public.parliament_voting_votes pvv on pvv.voting_id=pv.id
  where pv.related_id=bill.id and pv.type='bill' and pv.house_id<>v.house_id group by pv.id order by pv.created_at desc limit 1;
  if found and other_result.status='closed' then next_status:=case when other_result.approvals>=ceil(other_result.seats*2.0/3.0) then 'Aguardando promulgação presidencial' else 'Rejeitado' end;
  else
   next_status:='Em votação (2ª Casa)';
   if other_result.id is null then
    select id into other_house from public.parliament_houses where id<>v.house_id order by id limit 1;
    if other_house is null then raise exception 'PEC_REQUIRES_TWO_HOUSES'; end if;
    insert into public.parliament_votings(house_id,type,related_id,title,description,status,end_date) values(other_house,'bill',bill.id,'[2ª Casa] '||bill.title,'Votação constitucional na segunda Casa. Exige aprovação de dois terços.','active',clock_timestamp()+interval '24 hours');
   end if;
  end if;
 end if;
 update public.bills set status=next_status,updated_at=clock_timestamp() where id=bill.id;
 update public.parliament_votings set status='closed' where id=v.id;
 insert into public.notifications(user_id,type,content,link,metadata)
 select p.id,'parliament_voting_result','Votação encerrada: '||bill.title||'. Resultado: '||next_status||'.','/services/parliament',jsonb_build_object('voting_id',v.id,'bill_id',bill.id,'approve',yes,'reject',no,'abstain',greatest(seats-voted,0)+voted-yes-no)
 from public.profiles p where p.deleted_at is null and (p.id=bill.author_id or p.role='Presidente' or exists(select 1 from public.parliament_members m where m.user_id=p.id and m.house_id=v.house_id and m.term_end_date>=current_date));
 return jsonb_build_object('finalized',true,'approved',approved,'message','Votação encerrada. '||next_status||'.');
end $$;
revoke all on function private.finalize_bill_voting(uuid) from public,anon,authenticated;
create or replace function public.finalize_bill_voting(p_voting_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare house uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select house_id into house from public.parliament_votings where id=p_voting_id;
 if not coalesce(public.is_parliament_governance_manager(auth.uid(),house),false) and not exists(select 1 from public.parliament_members where user_id=auth.uid() and house_id=house and term_start_date<=current_date and term_end_date>=current_date) then raise exception 'PARLIAMENT_MEMBER_REQUIRED'; end if;
 return private.finalize_bill_voting(p_voting_id);
end $$;
revoke all on function public.finalize_bill_voting(uuid) from public,anon;
grant execute on function public.finalize_bill_voting(uuid) to authenticated;
create or replace function private.close_due_bill_votings()
returns void language plpgsql security definer set search_path='' as $$
declare v record;
begin
 for v in select id from public.parliament_votings where type='bill' and status='active' and end_date<=clock_timestamp() order by end_date for update skip locked loop
  perform private.finalize_bill_voting(v.id);
 end loop;
end $$;
revoke all on function private.close_due_bill_votings() from public,anon,authenticated;
select cron.schedule('close-due-bill-votings','5 seconds','select private.close_due_bill_votings()');
create or replace function private.notify_parliament_voting_open()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='active' and (tg_op='INSERT' or old.status is distinct from new.status) then
  insert into public.notifications(user_id,type,content,link,metadata) select distinct m.user_id,'parliament_voting_open','Nova votação aberta: '||new.title||'.','/services/parliament',jsonb_build_object('voting_id',new.id,'ends_at',new.end_date)
  from public.parliament_members m where m.house_id=new.house_id and m.term_start_date<=current_date and m.term_end_date>=current_date;
 end if;
 return new;
end $$;
revoke all on function private.notify_parliament_voting_open() from public,anon,authenticated;
create trigger parliament_voting_open_notification after insert or update of status on public.parliament_votings for each row execute function private.notify_parliament_voting_open();

CREATE OR REPLACE FUNCTION public.get_products_with_final_price()
 RETURNS TABLE(id uuid, seller_id uuid, name text, description text, price numeric, image_url text, created_at timestamp with time zone, product_type text, subscription_interval text, subscription_price numeric, metadata jsonb, category text, stock integer, promotion_price numeric, promotion_expires_at timestamp with time zone, sales_count integer, subscribers_count integer, tax_rate numeric, final_price numeric, seller json)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select product.id,product.seller_id,product.name,product.description,product.price,product.image_url,product.created_at,
    product.product_type,product.subscription_interval,product.subscription_price,coalesce(product.metadata,'{}')||jsonb_build_object('stock_depleted_at',product.stock_depleted_at),product.category,product.stock,
    product.promotion_price,product.promotion_expires_at,product.sales_count,product.subscribers_count,
    case when price_data.base>0 then (levy.value->>'buyer_tax')::numeric/price_data.base else 0 end,
    (levy.value->>'total_debited')::numeric,
    json_build_object('id',seller.id,'full_name',seller.full_name,'x_handle',seller.x_handle,'role',seller.role,
      'seller_type',product.seller_type,'business_id',business.id,'business_name',business.name,'business_status',business.status,'activity_restricted',(levy.value->>'restricted')::boolean,
      'documents',(select json_agg(json_build_object('type',document.type,'document_number',document.document_number,'metadata',json_build_object('company_name',business.name))) from public.documents document where document.user_id=seller.id and document.type='CNPJ' and document.metadata->>'business_id'=business.id::text))
  from public.products product
  join public.profiles seller on seller.id=product.seller_id
  left join public.businesses business on business.id=product.business_id
  cross join lateral (select case when product.promotion_price is not null and product.promotion_expires_at>statement_timestamp() then product.promotion_price else product.price end AS base) price_data
  cross join lateral (select public.quote_legal_levies('purchase',price_data.base,product.business_id is not null,coalesce(product.economic_sector_id,business.economic_sector_id),product.category) AS value) levy
  where seller.deleted_at is null and product.archived_at is null
    and (seller.onboarding_completed or seller.onboarding_mode='legacy_migration')
    and (product.business_id is null or business.status='active')
  order by product.created_at desc, product.id desc
$function$

;
notify pgrst,'reload schema';
