\set ON_ERROR_STOP on
begin;
do $$ begin
  if exists(select 1 from public.profiles) then raise exception 'TEST REQUIRES AN EMPTY ISOLATED DATABASE'; end if;
end $$;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; raise notice 'PASS: %',message; end $$;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email)
select ('71000000-0000-0000-0000-00000000000'||n)::uuid,'visibility'||n||'@example.invalid' from generate_series(1,6) n;
-- 1: confirmed buyer, 2/3: legacy leaders, 4: new/reset citizen,
-- 5: deleted legacy citizen, 6: legacy account without public party activity.
insert into public.profiles(id,username,full_name,role,onboarding_completed,onboarding_step,onboarding_mode,deleted_at)
select id,'visibility_'||right(id::text,1),'Nome RP '||right(id::text,1),'Cidadão',
  right(id::text,1)='1',case when right(id::text,1)='1' then 'completed' else 'identity' end,
  case when right(id::text,1) in('1','4') then 'standard' else 'legacy_migration' end,
  case when right(id::text,1)='5' then now() end
from auth.users;
insert into public.accounts(id,user_id,account_number,agency_number,balance)
select ('72000000-0000-0000-0000-00000000000'||right(id::text,1))::uuid,id,'VIS00'||right(id::text,1),'0001',10000 from public.profiles;
insert into public.rp_time_settings(id) values(true) on conflict do nothing;
insert into public.government_rules(rule_key,numeric_value,description) values('consumption_tax_rate',0.1,'Consumo teste'),('corporate_tax_rate',0.2,'Empresa teste');
update public.government_rules set rule_kind=case when rule_key='business_license_fee' then 'fee' else 'tax' end,
 definition=jsonb_build_object('basis',case when rule_key='business_license_fee' then 'license' else 'purchase' end,
 'nature',case when rule_key='business_license_fee' then 'fixed' else 'percentage' end,
 'payer',case when rule_key='corporate_tax_rate' then 'seller' else 'buyer' end,
 'audience',case when rule_key='corporate_tax_rate' then 'business' else 'all' end),is_active=true
where rule_key in('business_license_fee','consumption_tax_rate','corporate_tax_rate');

insert into public.price_basket_items(code,name,category,weight,base_price,current_price) values('other','Outros','Outros',1,100,100);
insert into public.business_types(id,name,category,description,registration_fee,min_employees,is_active)
values('visibility-shop','Loja teste','Comércio','Empresa de validação',100,1,true);
insert into public.businesses(id,owner_id,business_type_id,name,status,bank_account_id)
values('73000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','visibility-shop','Empresa pendente','pending','72000000-0000-0000-0000-000000000002');
insert into public.products(id,seller_id,name,description,price,product_type,stock,business_id)
select ('74000000-0000-0000-0000-00000000000'||n)::uuid,
  ('71000000-0000-0000-0000-00000000000'||case when n=6 then 2 else n end)::uuid,
  'Produto '||n,'Anúncio já publicado no RP',100,'one-time',3,
  case when n=6 then '73000000-0000-0000-0000-000000000001'::uuid end
from generate_series(1,6) n;
insert into public.political_parties(id,name,acronym,founder_id,owner_id,president_id,vice_president_id,registration_number,status)
values('75000000-0000-0000-0000-000000000001','Partido de teste','PTV',
  '71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002',
  '71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000003','VIS-PARTY','active');
insert into public.party_members(party_id,user_id,role)
select '75000000-0000-0000-0000-000000000001',id,'Membro' from public.profiles
where right(id::text,1) in('2','3','4','5') on conflict do nothing;

select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
-- This assertion reproduces the production regression before the migration.
select pg_temp.assert_true((select count(*)=3 from public.get_products_with_final_price()),'catálogo restaura anúncios de vendedores legados e mantém os atuais');
select pg_temp.assert_true((select count(*)=0 from public.get_products_with_final_price() where id in('74000000-0000-0000-0000-000000000004','74000000-0000-0000-0000-000000000005')),'catálogo exclui cidadão novo/resetado e excluído');
select pg_temp.assert_true(not exists(select 1 from public.get_products_with_final_price() where id='74000000-0000-0000-0000-000000000006'),'empresa pendente não publica no catálogo');
select pg_temp.assert_true((select final_price=110 and seller->>'full_name'='Nome RP 2' from public.get_products_with_final_price() where id='74000000-0000-0000-0000-000000000002'),'anúncio legado mantém nome público e imposto de consumo');
select pg_temp.assert_true((public.buy_product('74000000-0000-0000-0000-000000000002','balance',null,'76000000-0000-0000-0000-000000000001')->>'success')::boolean,'anúncio legado restaurado pode ser comprado');
select pg_temp.assert_true((select balance=9890 from public.accounts where user_id=auth.uid()),'compra de anúncio legado debita valor com imposto');
select pg_temp.assert_true((select stock=2 from public.products where id='74000000-0000-0000-0000-000000000002'),'compra de anúncio legado atualiza estoque');
select public.buy_product('74000000-0000-0000-0000-000000000002','balance',null,'76000000-0000-0000-0000-000000000001');
select pg_temp.assert_true((select balance=9890 from public.accounts where user_id=auth.uid()),'repetição da compra restaurada continua idempotente');
select pg_temp.assert_true((select count(*)=2 from public.get_public_party_profiles(array['71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000003']::uuid[])),'dono, fundador, presidente e vice legados têm perfis públicos');
select pg_temp.assert_true((select full_name='Nome RP 2' from public.get_public_party_profiles(array['71000000-0000-0000-0000-000000000002']::uuid[])),'perfil partidário retorna nome do RP');
select pg_temp.assert_true((select count(*)=0 from public.get_public_party_profiles(array['71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000006']::uuid[])),'consulta exclui novos/resetados, excluídos e legados sem atividade partidária');
select pg_temp.assert_true((select count(*)=1 from public.get_public_party_profiles(array[auth.uid(),auth.uid()])),'perfis confirmados continuam disponíveis sem duplicatas');
select pg_temp.assert_true((select count(*)=0 from public.get_public_party_profiles(null)),'IDs nulos não abrem consulta de todos os perfis');
select pg_temp.assert_true((select count(*)=0 from public.get_public_party_profiles('{}'::uuid[])),'lote vazio retorna vazio');
select pg_temp.assert_true(not exists(select 1 from public.get_public_party_profiles(array['71000000-0000-0000-0000-000000000002']::uuid[]) p where to_jsonb(p) ?| array['email','phone','date_of_birth','cpf','rg','real_full_name']),'projeção partidária não inclui dados privados nem documentos');
select pg_temp.assert_true(not exists(select 1 from public.public_citizen_profiles where id='71000000-0000-0000-0000-000000000002'),'perfil completo legado continua protegido até confirmação');
do $$ begin
  perform public.get_public_party_profiles(array_fill(auth.uid(),array[101]));
  raise exception 'LARGE BATCH ACCEPTED';
exception when others then if sqlerrm<>'PUBLIC_PROFILE_BATCH_LIMIT' then raise; end if;
  raise notice 'PASS: limite de 100 IDs é aplicado no servidor';
end $$;
reset role;
select pg_temp.assert_true((select not onboarding_completed and onboarding_mode='legacy_migration' from public.profiles where id='71000000-0000-0000-0000-000000000002'),'leitura e compra não concluem cadastro legado automaticamente');
select pg_temp.assert_true((select balance=10100 from public.accounts where user_id='71000000-0000-0000-0000-000000000002'),'vendedor legado recebe receita da compra');
update public.businesses set status='active' where id='73000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.assert_true(exists(select 1 from public.get_products_with_final_price() where id='74000000-0000-0000-0000-000000000006'),'empresa aprovada aparece no catálogo');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','anon',true);
set local role anon;
select pg_temp.assert_true((select count(*)=2 from public.get_public_party_profiles(array['71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000003']::uuid[])),'visitante também vê nomes públicos dos partidos');
select pg_temp.assert_true((select count(*)=4 from public.get_products_with_final_price()),'visitante vê catálogo público com ofertas legadas e atuais');
rollback;
