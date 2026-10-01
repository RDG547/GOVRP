begin;
create table public.economic_regions (
 code text primary key check(code ~ '^[A-Z]{2}$'), name text not null, capital text not null,
 population bigint not null default 2000000 check(population>=0),
 roads numeric not null default 50 check(roads between 0 and 100),
 energy numeric not null default 50 check(energy between 0 and 100),
 ports numeric not null default 30 check(ports between 0 and 100),
 airports numeric not null default 40 check(airports between 0 and 100),
 telecom numeric not null default 50 check(telecom between 0 and 100),
 coastal boolean not null default false, updated_at timestamptz not null default now()
);
comment on table public.economic_regions is 'Estados brasileiros; população e infraestrutura são parâmetros do mundo RP, não estatísticas demográficas reais.';
insert into public.economic_regions(code,name,capital,coastal) values
 ('AC','Acre','Rio Branco',false),('AL','Alagoas','Maceió',true),('AP','Amapá','Macapá',true),('AM','Amazonas','Manaus',false),('BA','Bahia','Salvador',true),('CE','Ceará','Fortaleza',true),('DF','Distrito Federal','Brasília',false),('ES','Espírito Santo','Vitória',true),('GO','Goiás','Goiânia',false),('MA','Maranhão','São Luís',true),('MT','Mato Grosso','Cuiabá',false),('MS','Mato Grosso do Sul','Campo Grande',false),('MG','Minas Gerais','Belo Horizonte',false),('PA','Pará','Belém',true),('PB','Paraíba','João Pessoa',true),('PR','Paraná','Curitiba',true),('PE','Pernambuco','Recife',true),('PI','Piauí','Teresina',true),('RJ','Rio de Janeiro','Rio de Janeiro',true),('RN','Rio Grande do Norte','Natal',true),('RS','Rio Grande do Sul','Porto Alegre',true),('RO','Rondônia','Porto Velho',false),('RR','Roraima','Boa Vista',false),('SC','Santa Catarina','Florianópolis',true),('SP','São Paulo','São Paulo',true),('SE','Sergipe','Aracaju',true),('TO','Tocantins','Palmas',false);
alter table public.economic_regions enable row level security;
create policy regions_read on public.economic_regions for select to authenticated using(true);
grant select on public.economic_regions to authenticated;
revoke all on public.economic_regions from anon;
alter table public.businesses add column region_code text references public.economic_regions(code), add column brand_palette jsonb not null default '[]'::jsonb;
alter table public.accounts alter column user_id drop not null;
alter table public.accounts add column business_id uuid unique references public.businesses(id) deferrable initially deferred,
 add column account_kind text not null default 'personal' check(account_kind in ('personal','business','population'));
alter table public.accounts add constraint accounts_holder_check check(
 (account_kind='personal' and user_id is not null and business_id is null) or
 (account_kind='business' and user_id is null and business_id is not null) or
 (account_kind='population' and user_id is null and business_id is null));
create unique index accounts_single_population on public.accounts(account_kind) where account_kind='population';
create index businesses_region_idx on public.businesses(region_code);
create or replace function public.assign_business_bank_account() returns trigger language plpgsql security definer set search_path='' as $$
declare a uuid;
begin
 select id into a from public.accounts where business_id=new.id;
 if a is null then
  insert into public.accounts(user_id,business_id,account_kind,account_number,agency_number,balance)
  values(null,new.id,'business','PJ-'||replace(new.id::text,'-',''),'0002',0) returning id into a;
  if new.bank_account_id is not null then
   new.metadata:=coalesce(new.metadata,'{}')||jsonb_build_object('legacy_personal_account_id',new.bank_account_id,'cash_separated_at',clock_timestamp());
  end if;
 end if;
 new.bank_account_id:=a;
 return new;
end $$;
-- Preserve every personal balance. Company cash starts at zero and needs a real capital contribution.
update public.businesses set owner_id=owner_id;
create or replace function private.can_manage_company(p_business_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
 select p_user_id is not null and exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id)
$$;
revoke all on function private.can_manage_company(uuid,uuid) from public,anon;
grant execute on function private.can_manage_company(uuid,uuid) to authenticated;
drop policy accounts_owner_or_bank_read on public.accounts;
create policy accounts_owner_or_bank_read on public.accounts for select to authenticated using(
 user_id=(select auth.uid()) or (business_id is not null and private.can_manage_company(business_id)) or public.user_can_manage_national_bank((select auth.uid())));
alter table public.business_transactions add column metadata jsonb not null default '{}', add column operation_key text;
create unique index business_transactions_operation_key on public.business_transactions(business_id,operation_key) where operation_key is not null;
create or replace function public.contribute_company_capital(p_business_id uuid,p_amount numeric,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype; a public.accounts%rowtype; t public.transactions%rowtype;
begin
 if not private.can_manage_company(p_business_id) then raise exception 'Somente o proprietário pode aportar capital.' using errcode='42501';end if;
 if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount>100000000000 or p_amount<>round(p_amount,2) then raise exception 'Informe um valor positivo com até duas casas decimais.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 select * into t from public.transactions where idempotency_key=p_idempotency_key;
 if found then
  if t.metadata->>'actor_id' is distinct from auth.uid()::text or t.metadata->>'business_id' is distinct from p_business_id::text or t.amount<>p_amount or t.type<>'company_capital' then raise exception 'Esta identificação já pertence a outra operação.';end if;
  return jsonb_build_object('success',true,'transaction_id',t.id);
 end if;
 select * into b from public.businesses where id=p_business_id for update;
 if b.owner_id<>auth.uid() then raise exception 'A propriedade da empresa mudou. Atualize a operação.';end if;
 select * into a from public.accounts where user_id=auth.uid() and account_kind='personal';
 if a.id is null then raise exception 'Abra sua conta pessoal antes de aportar capital.';end if;
 perform id from public.accounts where id in(a.id,b.bank_account_id) order by id for update;
 select * into a from public.accounts where id=a.id;
 if a.balance<p_amount then raise exception 'Saldo pessoal insuficiente para este aporte.';end if;
 update public.accounts set balance=balance-p_amount,updated_at=clock_timestamp() where id=a.id;
 update public.accounts set balance=balance+p_amount,updated_at=clock_timestamp() where id=b.bank_account_id;
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
 values(a.id,b.bank_account_id,p_amount,'company_capital','Aporte de capital: '||b.name,jsonb_build_object('actor_id',auth.uid(),'business_id',b.id,'gross_amount',p_amount,'net_amount',p_amount,'total_debited',p_amount,'tax_amount',0),p_idempotency_key) returning * into t;
 insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key)
 values(b.id,'other',p_amount,'Aporte do proprietário',jsonb_build_object('kind','capital','transaction_id',t.id),'capital:'||p_idempotency_key);
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 values('company_capital_contributed','economy','businesses',b.id,auth.uid(),jsonb_build_object('amount',p_amount,'transaction_id',t.id),'capital:'||p_idempotency_key);
 return jsonb_build_object('success',true,'transaction_id',t.id);
end $$;
revoke all on function public.contribute_company_capital(uuid,numeric,uuid) from public,anon;
grant execute on function public.contribute_company_capital(uuid,numeric,uuid) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='economic_regions') then alter publication supabase_realtime add table public.economic_regions;end if;
end $$;
notify pgrst,'reload schema';
commit;
