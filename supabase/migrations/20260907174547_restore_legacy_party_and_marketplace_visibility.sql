-- Onboarding v2 preserved existing RP activity but set legacy accounts to
-- onboarding_completed=false. Public party identity and published offers must
-- not disappear while those players finish their shortened confirmation flow.
-- Do not complete onboarding, activate businesses or expand base profile RLS.

CREATE OR REPLACE FUNCTION public.get_public_party_profiles(p_ids uuid[])
RETURNS TABLE(
  id uuid, citizen_id uuid, full_name text, username text, avatar_url text,
  role text, titles text[], party_affiliation uuid, x_username text,
  x_handle text, x_avatar_url text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(cardinality(p_ids),0)>100 THEN
    RAISE EXCEPTION 'PUBLIC_PROFILE_BATCH_LIMIT';
  END IF;
  RETURN QUERY
  SELECT p.id,p.citizen_id,p.full_name,p.username,p.avatar_url,p.role,p.titles,
    p.party_affiliation,p.x_username,p.x_handle,p.x_avatar_url
  FROM public.profiles p
  WHERE p.id=ANY(p_ids) AND p.deleted_at IS NULL AND (
    p.onboarding_completed OR (
      p.onboarding_mode='legacy_migration' AND (
        EXISTS(SELECT 1 FROM public.party_members m WHERE m.user_id=p.id)
        OR EXISTS(SELECT 1 FROM public.political_parties party
          WHERE p.id IN(party.founder_id,party.owner_id,party.president_id,party.vice_president_id))
      )
    )
  );
END $$;
-- This is an explicitly public projection of existing party identities only.
-- No date of birth, official document numbers or private account fields.
REVOKE ALL ON FUNCTION public.get_public_party_profiles(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_party_profiles(uuid[]) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_products_with_final_price()
 RETURNS TABLE(id uuid, seller_id uuid, name text, description text, price numeric, image_url text, created_at timestamp with time zone, product_type text, subscription_interval text, subscription_price numeric, metadata jsonb, category text, stock integer, promotion_price numeric, promotion_expires_at timestamp with time zone, sales_count integer, subscribers_count integer, tax_rate numeric, final_price numeric, seller json)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select product.id,product.seller_id,product.name,product.description,product.price,product.image_url,product.created_at,
    product.product_type,product.subscription_interval,product.subscription_price,product.metadata,product.category,product.stock,
    product.promotion_price,product.promotion_expires_at,product.sales_count,product.subscribers_count,
    coalesce(public.get_government_rule('consumption_tax_rate'),0),
    (case when product.promotion_price is not null and product.promotion_expires_at>clock_timestamp() then product.promotion_price else product.price end)
      *(1+coalesce(public.get_government_rule('consumption_tax_rate'),0)),
    json_build_object('id',seller.id,'full_name',seller.full_name,'x_handle',seller.x_handle,'role',seller.role,
      'seller_type',product.seller_type,'business_id',business.id,'business_name',business.name,'business_status',business.status,
      'documents',(select json_agg(json_build_object('type',document.type,'document_number',document.document_number,'metadata',json_build_object('company_name',business.name))) from public.documents document where document.user_id=seller.id and document.type='CNPJ' and document.metadata->>'business_id'=business.id::text))
  from public.products product
  join public.profiles seller on seller.id=product.seller_id
  left join public.businesses business on business.id=product.business_id
  where seller.deleted_at is null
    and (seller.onboarding_completed or seller.onboarding_mode='legacy_migration')
    and (product.business_id is null or business.status='active')
  order by product.created_at desc, product.id desc
$function$

;

NOTIFY pgrst,'reload schema';
