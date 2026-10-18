begin;
alter table public.citizen_residences add column image_url text;
update public.citizen_residences r set image_url=p.image_url from public.products p where p.id=r.product_id;
create function private.snapshot_residence_image() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.image_url is null then select image_url into new.image_url from public.products where id=new.product_id;end if;return new;
end $$;
create trigger snapshot_residence_image before insert on public.citizen_residences for each row execute function private.snapshot_residence_image();
revoke all on function private.snapshot_residence_image() from public,anon,authenticated;

create function public.get_company_resource_listing_quote(p_business_id uuid,p_resource_code text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare market public.state_enterprises%rowtype;product public.products%rowtype;fee numeric;
begin
 if auth.uid() is null or not private.can_manage_company(p_business_id) then raise exception 'Consulta restrita à gestão.' using errcode='42501';end if;
 select * into market from public.state_enterprises where service_key='marketplace';
 select * into product from public.products where business_id=p_business_id and resource_code=p_resource_code;
 market:=private.marketplace_seller_policy(market,p_business_id,product.id is not null);
 fee:=case when product.id is not null and product.listing_status='active' and (product.listing_paid_until is null or product.listing_paid_until>clock_timestamp()) then 0 when market.active_listing_fee_enabled then market.active_listing_fee_amount else 0 end;
 return jsonb_build_object('amount',fee,'days',market.active_listing_fee_period,'product_id',product.id,'commission_percent',market.commission_value,'fixed_sale_fee',market.fixed_sale_fee);
end $$;
revoke all on function public.get_company_resource_listing_quote(uuid,text) from public,anon;
grant execute on function public.get_company_resource_listing_quote(uuid,text) to authenticated;
drop function public.publish_company_resource_listing(uuid,text,numeric);
create function public.publish_company_resource_listing(p_business_id uuid,p_resource_code text,p_price numeric,p_confirmed_fee numeric,p_period_days integer,p_idempotency_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype;r public.economic_resources%rowtype;pid uuid;stock numeric;
begin
 if auth.uid() is null or not private.can_manage_company(p_business_id) then raise exception 'Somente a gestão pode anunciar o estoque da empresa.' using errcode='42501';end if;
 select * into b from public.businesses where id=p_business_id and status='active' for update;
 if b.owner_id is distinct from auth.uid() then raise exception 'O proprietário deve confirmar a publicação no marketplace.' using errcode='42501';end if;
 select * into r from public.economic_resources where code=p_resource_code;
 select quantity into stock from public.business_inventory where business_id=b.id and resource_code=r.code for update;
 if b.id is null or r.code is null or stock is null or floor(stock)<1 or p_price is null or p_price::text in ('NaN','Infinity','-Infinity') or p_price not between .01 and 1000000000 or p_idempotency_key is null then raise exception 'Confira recurso, estoque, preço e confirmação.';end if;
 select id into pid from public.products where business_id=b.id and resource_code=r.code for update;
 if pid is null then
  perform set_config('govrp.physical_listing_authorized',b.id::text,true);
  pid:=(public.publish_business_product(jsonb_build_object('p_business_id',b.id,'p_name',r.name,'p_description','Produto do estoque físico de '||b.name||'. Quantidade em '||r.unit||'.','p_price',p_price,'p_product_type','one-time','p_category','Insumos','p_stock',floor(stock)::int,'p_consumable_effects','{}'::jsonb),p_confirmed_fee,p_period_days,p_idempotency_key)).id;
  update public.products set resource_code=r.code where id=pid;
  perform set_config('govrp.physical_listing_authorized','',true);
 else
  update public.products set price=p_price,archived_at=null where id=pid;
  perform private.activate_marketplace_listing(pid,p_confirmed_fee,p_period_days,p_idempotency_key);
 end if;
 perform economy_private.audit('company_resource_listed','products',pid::text,null,jsonb_build_object('resource_code',r.code,'price',p_price),'Anúncio vinculado ao estoque físico existente.',auth.uid());
 return pid;
end $$;
revoke all on function public.publish_company_resource_listing(uuid,text,numeric,numeric,integer,uuid) from public,anon;
grant execute on function public.publish_company_resource_listing(uuid,text,numeric,numeric,integer,uuid) to authenticated;

create function private.expire_vice_invitations() returns void language plpgsql security definer set search_path='' as $$
declare n public.notifications%rowtype;
begin
 for n in select no.* from public.notifications no join public.elections e on e.id::text=no.metadata->>'election_id'
 where no.type='vice_candidacy_invitation' and no.metadata->>'status'='pending' and (e.candidacy_end_date<=clock_timestamp() or e.status in ('Finished','Cancelled')) for update of no skip locked loop
  update public.notifications set metadata=metadata||jsonb_build_object('status','expired','expired_at',clock_timestamp()) where id=n.id;
  update public.notifications set metadata=metadata||jsonb_build_object('status','expired','expired_at',clock_timestamp()) where type='vice_candidacy_request_sent' and user_id=n.sender_id and metadata->>'election_id'=n.metadata->>'election_id' and metadata->>'status'='pending';
  if n.sender_id is not null then perform public.justice_notify(n.sender_id,'vice_invitation_expired','O convite para compor a chapa expirou com o encerramento das candidaturas.','/services/elections',jsonb_build_object('invitation_id',n.id));end if;
 end loop;
end $$;
revoke all on function private.expire_vice_invitations() from public,anon,authenticated;
select cron.schedule('govrp-vice-invitation-expiry','* * * * *','select private.expire_vice_invitations()');

CREATE OR REPLACE FUNCTION public.get_residence_market()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'image_url',r.image_url,'name',r.name,'city',r.city,'state',r.state,'area_sqm',r.area_sqm,'rooms',r.rooms,'quality',r.quality,'hygiene_recovery',r.hygiene_recovery,'sleep_minutes',r.sleep_minutes,'listing_mode',r.listing_mode,'asking_price',r.asking_price,'rent_period_days',r.rent_period_days,'owner_id',r.owner_id,'state_enterprise_id',r.state_enterprise_id,'rent_quote',public.quote_legal_levies('purchase',r.asking_price,false,null,'Moradia'),'quote',public.quote_legal_levies('purchase',r.asking_price,false,null,'Moradia')) order by r.state,r.asking_price),'[]'::jsonb)
 from public.citizen_residences r where auth.uid() is not null and r.listing_mode<>'none' and r.asking_price>0 and not exists(select 1 from public.residence_leases l where l.residence_id=r.id and l.status<>'ended')
$function$;
CREATE OR REPLACE FUNCTION public.get_state_citizen_offers(p_housing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('rent_quote',case when p.residence_spec is not null then public.quote_legal_levies('purchase',coalesce((p.residence_spec->>'rent_price')::numeric,0),false,null,'Moradia') end,'quote',public.quote_legal_levies('purchase',p.price,s.is_privatized,p.economic_sector_id,p.category)) order by p.price),'[]') into result
 from public.products p join public.state_enterprises s on s.id=p.state_enterprise_id
 where s.is_active and p.archived_at is null and p.moderation_status='approved' and (p.residence_spec is not null)=p_housing;
 return result;
end; $function$;
CREATE OR REPLACE FUNCTION private.happiness_world_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;item jsonb:=to_jsonb(new);c record;won boolean;event text;uid uuid;
begin
 if tg_table_name='election_settlements' then
  if new.status<>'settled' then return new;end if;
  for c in select user_id,vice_candidate_id,id from public.candidates where election_id=new.election_id and status='Approved' loop
   won:=exists(select 1 from jsonb_array_elements(new.result) w where w->>'candidate_id'=c.id::text);
   event:=case when won then 'election_win' else 'election_loss' end;
   foreach uid in array array[c.user_id,c.vice_candidate_id] loop if uid is not null then perform private.apply_happiness(uid,event,'election:'||new.election_id);end if;end loop;
  end loop;
 elsif tg_table_name='citizen_residences' then
  actor:=(item->>'owner_id')::uuid;
  if actor is not null and (tg_op='INSERT' or new.owner_id is distinct from old.owner_id) then perform private.apply_happiness(actor,'property_purchase','property:first:residence');end if;
 elsif tg_table_name='professional_work_sessions' then
  if new.status='completed' and old.status<>'completed' and new.score>=80 then perform private.apply_happiness(new.user_id,'professional_achievement','professional:'||new.business_id||':'||(clock_timestamp() at time zone 'America/Sao_Paulo')::date);end if;
 else
  actor:=coalesce((item->>'user_id')::uuid,(item->>'sender_id')::uuid);
  if tg_table_name in ('posts','comments','messages','x_messages') and length(btrim(coalesce(item->>'content','')))<10 then return new;end if;
  if tg_table_name in ('likes','post_likes') then
   select user_id into uid from public.posts where id=(item->>'post_id')::uuid;
   if uid is null or uid=actor then return new;end if;
   perform private.apply_happiness(uid,'social','received-like:'||(item->>'post_id')||':'||actor,1);return new;
  end if;
  if actor is not null then perform private.apply_happiness(actor,'social',tg_table_name||':'||coalesce(item->>'id',item->>'post_id')||':'||actor);end if;
 end if;
 return new;
end $function$;
create trigger happiness_post_likes after insert on public.post_likes for each row execute function private.happiness_world_event();
create trigger happiness_x_messages after insert on public.x_messages for each row execute function private.happiness_world_event();
-- Distinct, durable images for owned homes and new catalog hygiene items.
update public.products set image_url='/images/catalog/house.webp' where state_enterprise_id is not null and residence_spec is not null and lower(name) like 'casa%' and image_url='/images/catalog/studio.webp';
insert into public.products(id,state_enterprise_id,name,description,price,stock,category,image_url,consumable_effects)
 select md5('govrp:catalog:soap')::uuid,id,'Sabonete','Sabonete para a higiene do cidadão no universo fictício do GOVRP.',12,10000,'Higiene','/images/catalog/soap.webp','{"hygiene":20}'::jsonb from public.state_enterprises where service_key='national_market' on conflict(id) do nothing;
update public.products set image_url='/images/catalog/'||case name
 when 'Pão do dia' then 'bread' when 'Arroz com feijão' then 'meal' when 'Refeição completa' then 'meal' when 'Banana' then 'banana' when 'Maçã' then 'apple' when 'Sanduíche simples' then 'sandwich' when 'Sopa de legumes' then 'soup' when 'Salada da estação' then 'salad' when 'Biscoitos' then 'cookies' when 'Tapioca' then 'tapioca' when 'Água mineral' then 'water' when 'Suco de laranja' then 'juice' when 'Água de coco' then 'coconut' when 'Chá gelado' then 'tea' when 'Leite' then 'milk' when 'Cerveja' then 'beer' when 'Vinho' then 'wine' when 'Destilado' then 'whisky' else 'soap' end||'.webp'
where state_enterprise_id is not null and name in ('Pão do dia','Arroz com feijão','Refeição completa','Banana','Maçã','Sanduíche simples','Sopa de legumes','Salada da estação','Biscoitos','Tapioca','Água mineral','Suco de laranja','Água de coco','Chá gelado','Leite','Cerveja','Vinho','Destilado','Sabonete') and (nullif(image_url,'') is null or image_url like '/images/catalog/%');
update public.products set image_url='/images/catalog/'||case when lower(name) like '%mans%' then 'mansion' when lower(name) like 'casa%' or (residence_spec->>'quality')::int=3 then 'house' when lower(name) like '%apart%' then 'apartment' else 'studio' end||'.webp'
where state_enterprise_id is not null and residence_spec is not null and (image_url like '/images/housing/%.svg' or nullif(image_url,'') is null);
update public.citizen_residences r set image_url=p.image_url from public.products p where p.id=r.product_id and (r.image_url like '/images/housing/%.svg' or nullif(r.image_url,'') is null);
insert into public.products(id,state_enterprise_id,name,description,price,stock,category,image_url,residence_spec)
select md5('govrp:catalog:mansion:DF')::uuid,id,'Mansão Institucional DF','Imóvel de alto padrão no universo fictício do GOVRP. Imagem meramente representativa.',1000000,5,'Moradia','/images/catalog/mansion.webp','{"type":"mansion","state":"DF","city":"Brasília","area_sqm":550,"quality":3,"rooms":{"bedrooms":5,"bathrooms":4,"living_rooms":2,"kitchens":1},"hygiene_recovery":100,"sleep_minutes":8,"rent_price":2500,"rent_period_days":7,"sale_enabled":true,"rent_enabled":true}'::jsonb from public.state_enterprises where service_key='national_housing' on conflict(id) do nothing;

commit;
