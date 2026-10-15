begin;
create or replace function public.get_country_companies(p_search text default '',p_type text default '',p_state text default '',p_size text default '',p_product text default '',p_status text default 'active',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Entre para consultar empresas.' using errcode='42501';end if;
 with companies as (
 select b.id,b.name,b.description,b.logo_url,b.brand_color,b.font_key,b.region_code,b.size_class,b.status,b.operational_status,b.market_value,b.business_type_id,t.name activity,
 coalesce(p.full_name,'Capital da população') owner_name,
 case when public.is_admin() then b.control_kind else null end control_kind,
 array(select distinct name from (
   select r.name from public.business_inventory i join public.economic_resources r on r.code=i.resource_code where i.business_id=b.id and i.available_for_sale and i.quantity>0
   union select pr.name from public.products pr where pr.business_id=b.id and pr.archived_at is null and pr.moderation_status='approved' and pr.listing_status='active'
 ) offers order by name) products
 from public.businesses b left join public.business_types t on t.id=b.business_type_id left join public.profiles p on p.id=b.owner_id
 where (coalesce(p_search,'')='' or b.name ilike '%'||left(p_search,120)||'%')
 and (coalesce(p_type,'')='' or b.business_type_id=p_type)
 and (coalesce(p_state,'')='' or b.region_code=p_state)
 and (coalesce(p_size,'')='' or b.size_class=p_size)
 and (coalesce(p_status,'')='' or b.status=p_status)
 ), matched as(select * from companies where coalesce(p_product,'')='' or array_to_string(products,' ') ilike '%'||left(p_product,120)||'%'),
 page as(select * from matched order by name,id limit 36 offset greatest(0,least(coalesce(p_offset,0),100000)))
 select jsonb_build_object('total',(select count(*) from matched),'companies',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]')) into result;
 return result;
end $$;
revoke all on function public.get_country_companies(text,text,text,text,text,text,integer) from public,anon;
grant execute on function public.get_country_companies(text,text,text,text,text,text,integer) to authenticated;

-- Same products, purchase pipeline and inventory consumption as all other market offers.
insert into public.products(id,state_enterprise_id,name,description,price,category,product_type,consumable_effects,metadata)
select v.id::uuid,s.id,v.name,v.description,v.price,'Bebidas','one-time','{"thirst":15,"social":8,"health":-3}'::jsonb,'{"market_group":"Bebidas alcoólicas"}'::jsonb
from public.state_enterprises s cross join(values
 ('f2100000-0000-4000-8000-000000000021','Cerveja','Bebida alcoólica: recupera sede e socialização, com redução moderada de saúde.',8.50),
 ('f2100000-0000-4000-8000-000000000022','Vinho','Vinho para consumo responsável no RP. Confira os efeitos antes de consumir.',38.00),
 ('f2100000-0000-4000-8000-000000000023','Destilado','Bebida destilada com os mesmos efeitos balanceados das demais bebidas alcoólicas.',52.00)
)v(id,name,description,price) where s.service_key='national_market'
on conflict(id) do nothing;

notify pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.get_company_page(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre para consultar empresas.' using errcode='42501'; end if;
 select * into b from public.businesses where id=p_business_id;
 if not found then return null; end if;
 return jsonb_build_object('id',b.id,'name',b.name,'description',b.description,'status',b.status,'created_at',b.created_at,'business_type_id',b.business_type_id,'logo_url',b.logo_url,'font_key',b.font_key,'brand_color',b.brand_color,'owner_id',b.owner_id,'brand_palette',b.brand_palette,'region_code',b.region_code,'market_value',b.market_value,'size_class',b.size_class,'employees',b.employees,'reputation',b.reputation,'control_kind',b.control_kind,'operational_status',b.operational_status,'can_manage',private.can_manage_company(b.id),
 'owner',(select jsonb_build_object('id',id,'full_name',full_name,'avatar_url',avatar_url) from public.profiles where id=b.owner_id),
 'activity',(select name from public.business_types where id=b.business_type_id),'regularization_required',b.metadata->'cnpj_regularization_required',
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'image_url',p.image_url,'price',p.final_price)) from public.get_products_with_final_price() p where p.seller->>'business_id'=b.id::text),'[]'::jsonb),
 'offers',coalesce((select jsonb_agg(offer) from jsonb_array_elements(public.get_company_suppliers()) offer where offer->>'business_id'=b.id::text),'[]'),
 'vacancies',coalesce((select jsonb_agg(job) from jsonb_array_elements(public.get_company_jobs()) job where job->>'business_id'=b.id::text),'[]'),
 'cnpjs',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'number',d.document_number,'activity',coalesce(d.metadata->>'activity_name',t.name),'issued_at',d.issued_at,'is_valid',d.is_valid and (d.expires_at is null or d.expires_at>now()))) from public.documents d left join public.business_types t on t.id=d.metadata->>'business_type_id' where d.type='CNPJ' and (d.id=b.cnpj_document_id or d.metadata->>'business_id'=b.id::text)),'[]'::jsonb));
end $function$

;
commit;
