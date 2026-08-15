-- Snapshot do vendedor e do local da compra no momento da transação.

create or replace function public.snapshot_commerce_transaction()
returns trigger
language plpgsql security definer set search_path='' as $$
declare seller_id uuid; seller_name text; seller_role text; seller_document public.documents%rowtype;
begin
  if new.type not in('purchase','purchase_card','subscription_payment','subscription_payment_card') then return new; end if;
  select a.user_id,p.full_name,p.role into seller_id,seller_name,seller_role
  from public.accounts a join public.profiles p on p.id=a.user_id where a.id=new.to_account_id;
  select * into seller_document from public.documents where user_id=seller_id and type='CNPJ' and is_valid order by issued_at desc limit 1;
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'purchase_location',coalesce(new.metadata->>'platform','Negócios Livres'),
    'seller_snapshot',jsonb_strip_nulls(jsonb_build_object(
      'profile_id',seller_id,'legal_name',seller_name,'role',seller_role,
      'cnpj',seller_document.document_number,
      'trade_name',coalesce(seller_document.metadata->>'trade_name',seller_document.metadata->>'business_name')
    )),
    'snapshot_at',clock_timestamp()
  );
  return new;
end; $$;

drop trigger if exists transactions_commerce_snapshot on public.transactions;
create trigger transactions_commerce_snapshot before insert on public.transactions
for each row execute function public.snapshot_commerce_transaction();
