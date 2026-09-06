\set ON_ERROR_STOP on
begin;
do $$ begin
  if exists(select 1 from public.profiles) then raise exception 'EXPERIENCE TESTS REQUIRE AN EMPTY ISOLATED DATABASE'; end if;
end $$;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; raise notice 'PASS: %',message; end $$;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values
('11000000-0000-0000-0000-000000000001','seller@experience.invalid'),
('11000000-0000-0000-0000-000000000002','buyer@experience.invalid'),
('11000000-0000-0000-0000-000000000003','stranger@experience.invalid');
insert into public.profiles(id,username,full_name,role,onboarding_completed,onboarding_step,character_gender)
select id,'experience_'||right(id::text,1),'Cidadão experiência '||right(id::text,1),'Cidadão',true,'completed','male' from auth.users;
insert into public.accounts(id,user_id,account_number,agency_number,balance)
select ('22000000-0000-0000-0000-00000000000'||right(id::text,1))::uuid,id,'TEST00'||right(id::text,1),'0001',10000 from public.profiles;
insert into public.rp_time_settings(id) values(true) on conflict do nothing;
insert into public.government_rules(rule_key,numeric_value,description) values('business_license_fee',100,'Taxa teste'),('consumption_tax_rate',0.1,'Consumo teste'),('corporate_tax_rate',0.2,'Empresa teste');
insert into public.price_basket_items(code,name,category,weight,base_price,current_price) values('other','Outros','Outros',1,100,100);
insert into public.business_types(id,name,category,description,registration_fee,min_employees,is_active)
values('experience-shop','Loja teste','Comércio','Empresa de validação de comércio',100,1,true);
create temporary table results(name text primary key,payload jsonb);
grant all on results to authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
insert into results values('registration',to_jsonb(public.register_business_authoritative(auth.uid(),'experience-shop','Empresa de teste','Uma descrição completa de um negócio real no RP.','33000000-0000-0000-0000-000000000001')));
select pg_temp.assert_true((select balance=9900 from public.accounts where user_id=auth.uid()),'registro empresarial cobra uma única taxa');
select public.register_business_authoritative(auth.uid(),'experience-shop','Empresa de teste','Uma descrição completa de um negócio real no RP.','33000000-0000-0000-0000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.businesses),'registro empresarial idempotente não duplica empresa');
update public.businesses set status='active' where registration_idempotency_key='33000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
insert into results values('citizen-product',to_jsonb(public.save_business_product(null,null,'Produto PF','Produto vendido diretamente pelo cidadão.',100,'https://example.invalid/product.png','one-time',null,'Outros',2,null,null)));
select pg_temp.assert_true((select payload->>'seller_type'='citizen' and payload->>'business_id' is null from results where name='citizen-product'),'pessoa física anuncia sem empresa e sem CNPJ');
insert into results values('business-product',to_jsonb(public.save_business_product(null,(select (payload->>'id')::uuid from results where name='registration'),'Produto empresarial','Produto da empresa existente.',100,'https://example.invalid/product.png','one-time',null,'Outros',2,null,null)));
select pg_temp.assert_true((select count(*)=2 from public.get_products_with_final_price()),'vitrine pública inclui PF e empresa no mesmo catálogo');
reset role;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',true);
set local role authenticated;
insert into results values('citizen-order',public.buy_product((select (payload->>'id')::uuid from results where name='citizen-product'),'balance',null,'33000000-0000-0000-0000-000000000002'));
select pg_temp.assert_true((select (payload->>'total')::numeric=110 and (payload->>'tax')::numeric=10 from results where name='citizen-order'),'PF cobra consumo vigente sem imposto empresarial');
select public.buy_product((select (payload->>'id')::uuid from results where name='citizen-product'),'balance',null,'33000000-0000-0000-0000-000000000002');
select pg_temp.assert_true((select balance=9890 from public.accounts where user_id=auth.uid()),'compra repetida não debita novamente');
select pg_temp.assert_true((select stock=1 and sales_count=1 from public.products where id=(select (payload->>'id')::uuid from results where name='citizen-product')),'compra PF atualiza estoque e contagem uma vez');
do $$ begin
 perform public.buy_product((select (payload->>'id')::uuid from results where name='business-product'),'balance',null,'33000000-0000-0000-0000-000000000002');
 raise exception 'CONFIRMAÇÃO FOI REUTILIZADA EM OUTRO PRODUTO';
exception when others then
 if sqlerrm<>'IDEMPOTENCY_PAYLOAD_MISMATCH' then raise; end if;
 raise notice 'PASS: confirmação da compra não pode ser reutilizada com outro produto';
end $$;
insert into results values('business-order',public.buy_product((select (payload->>'id')::uuid from results where name='business-product'),'balance',null,'33000000-0000-0000-0000-000000000003'));
select pg_temp.assert_true((select (payload->>'tax')::numeric=30 from results where name='business-order'),'venda empresarial preserva consumo e tributo da empresa');
reset role;
select pg_temp.assert_true((select balance=10080 from public.accounts where user_id='11000000-0000-0000-0000-000000000001'),'vendedor recebe PF integral e receita empresarial líquida');
select pg_temp.assert_true((select metadata->>'seller_type'='citizen' and metadata->>'seller_name'='Cidadão experiência 1' from public.transactions where idempotency_key='33000000-0000-0000-0000-000000000002'),'comprovante preserva nome e tipo do vendedor PF');
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.commerce_orders),'outro cidadão não pode ver pedidos de terceiros');
do $$ begin
 perform public.buy_product((select (payload->>'id')::uuid from results where name='citizen-product'),'balance',null,'33000000-0000-0000-0000-000000000002');
 raise exception 'CHAVE DE OUTRO COMPRADOR FOI ACEITA';
exception when others then
 if sqlerrm<>'IDEMPOTENCY_KEY_FORBIDDEN' then raise; end if;
 raise notice 'PASS: compra recusa chave de idempotência pertencente a outro cidadão';
end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
update public.profiles set x_handle=username,x_username=full_name where id is not null;
insert into public.political_parties(id,name,acronym,founder_id,owner_id,president_id,registration_number,affiliation_mode,is_active,status)
values('44000000-0000-0000-0000-000000000001','Partido de teste','PTX','11000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','TEST-PARTY','manual',true,'active');
insert into public.party_members(party_id,user_id,role)
values('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Presidente') on conflict do nothing;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select pg_temp.assert_true((public.request_party_affiliation('44000000-0000-0000-0000-000000000001')->>'success')::boolean,'pedido de filiação manual é aceito');
select pg_temp.assert_true(not exists(select 1 from public.notifications where user_id=auth.uid() and type='party_membership_confirmed'),'pedido pendente não gera comemoração');
insert into results select 'party-request',jsonb_build_object('id',id) from public.party_affiliation_requests where user_id=auth.uid();
reset role;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select pg_temp.assert_true(not (public.respond_to_affiliation_request((select (payload->>'id')::uuid from results where name='party-request'),true)->>'success')::boolean,'cidadão sem cargo partidário não aprova filiação');
select pg_temp.assert_true((select count(*)=0 from public.party_affiliation_requests),'pedidos partidários de terceiros não são públicos');
reset role;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select pg_temp.assert_true((public.respond_to_affiliation_request((select (payload->>'id')::uuid from results where name='party-request'),true)->>'success')::boolean,'presidente aprova filiação com vínculo real');
reset role;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=1 from public.notifications where user_id=auth.uid() and type='party_membership_confirmed' and metadata->>'celebration_seen_at' is null),'aprovação offline mantém uma comemoração pendente');
insert into results select 'welcome',jsonb_build_object('id',id) from public.notifications where user_id=auth.uid() and type='party_membership_confirmed';
select pg_temp.assert_true(public.acknowledge_party_welcome((select (payload->>'id')::uuid from results where name='welcome')),'confirmação de leitura marca comemoração como vista');
select pg_temp.assert_true(not public.acknowledge_party_welcome((select (payload->>'id')::uuid from results where name='welcome')),'comemoração já vista não volta a ser confirmada');
insert into results values('anonymous-occurrence',to_jsonb(public.create_police_occurrence('Ocorrência anônima','Descrição suficientemente completa dos fatos da ocorrência.','Denúncia','Local de teste',now(),true,'normal')));
select pg_temp.assert_true((select payload->>'user_id' is null and payload->>'reported_by' is null from results where name='anonymous-occurrence'),'ocorrência anônima não expõe autor na tabela da autoridade');
select pg_temp.assert_true(jsonb_array_length(public.get_my_police_occurrences())=1,'autor acompanha sua ocorrência anônima');
delete from public.notifications where user_id=auth.uid() and type='justice_occurrence_created';
select pg_temp.assert_true(jsonb_array_length(public.get_my_police_occurrences())=1,'excluir notificação não perde autoria da ocorrência anônima');
reset role;
update public.police_occurrences set status='Em andamento',triage_notes='NOTA INTERNA SIGILOSA' where id=(select (payload->>'id')::uuid from results where name='anonymous-occurrence');
set local role authenticated;
select pg_temp.assert_true(public.get_my_police_occurrences()->0->>'status'='Em andamento' and not (public.get_my_police_occurrences()->0 ? 'triage_notes'),'andamento público atualizado sem vazar triagem interna');
select pg_temp.assert_true((select count(*)=1 from public.notifications where user_id=auth.uid() and type='justice_occurrence_status_changed'),'mudança de situação gera notificação persistida');
insert into results values('message',public.send_x_message('11000000-0000-0000-0000-000000000001','Mensagem de integração entre cidadãos')::jsonb);
select pg_temp.assert_true((select (payload->>'success')::boolean and payload->'message'->>'id' is not null from results where name='message'),'mensagem retorna ID definitivo para atualização sem duplicação');
select pg_temp.assert_true(not(public.send_x_message('11000000-0000-0000-0000-000000000001',' ')->>'success')::boolean,'mensagem vazia é rejeitada');
insert into results values('card-request',public.request_welcome_credit_card('visa'));
select pg_temp.assert_true(public.request_welcome_credit_card('visa')->>'application_id'=(select payload->>'application_id' from results where name='card-request'),'guia bancário não duplica solicitação de cartão');
select public.complete_bank_welcome();
select pg_temp.assert_true((select bank_welcome_completed from public.accounts where user_id=auth.uid()),'conclusão do guia bancário é persistida na própria conta');
reset role;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select pg_temp.assert_true(jsonb_array_length(public.get_my_police_occurrences())=0,'outro cidadão não acessa ocorrência anônima de terceiros');
select pg_temp.assert_true((select count(*)=0 from public.x_messages),'mensagens privadas não são lidas por terceiros');
do $$ begin
 perform public.delete_x_conversation((select (payload->>'conversation_id')::uuid from results where name='message'));
 raise exception 'CONVERSA DE TERCEIROS FOI EXCLUIDA';
exception when others then if sqlerrm<>'NOT_AUTHORIZED' then raise; end if; raise notice 'PASS: conversa de terceiros não pode ser excluída'; end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
update public.profiles set role='Deputado',manual_role_override=true,role_assigned_at=now() where id='11000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select pg_temp.assert_true(exists(select 1 from public.get_bill_suggestion_targets() where id='11000000-0000-0000-0000-000000000003' and role='Deputado'),'deputado atribuído manualmente aparece como destinatário');
select pg_temp.assert_true((public.submit_bill_suggestion('Proposta cidadã','Proposta de teste legislativo suficientemente completa.','parliamentarian','11000000-0000-0000-0000-000000000003','PL')->>'success')::boolean,'sugestão pode ser enviada ao deputado manual sem mandato eleito');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
update public.profiles set role='Juiz',manual_role_override=true where id='11000000-0000-0000-0000-000000000003';
update public.profiles set role='Delegado',manual_role_override=true where id='11000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
insert into results values('investigation',to_jsonb(public.open_criminal_investigation((select (payload->>'id')::uuid from results where name='anonymous-occurrence'),'Resumo suficiente para abertura formal da investigação.')));
insert into public.judicial_requests(id,request_type,requested_by,target_profile_id,justification,investigation_id)
values('55000000-0000-0000-0000-000000000001','search_warrant','11000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000002','Pedido de busca fundamentado com fatos e elementos suficientes.',(select (payload->>'id')::uuid from results where name='investigation'));
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
insert into results values('warrant',public.decide_judicial_request('55000000-0000-0000-0000-000000000001',true,'Decisão suficientemente fundamentada autorizando a busca.',7));
select pg_temp.assert_true((select payload->'warrant'->>'status'='issued' from results where name='warrant'),'juiz aprova pedido e emite mandado');
select pg_temp.assert_true((public.revoke_judicial_warrant((select (payload->'warrant'->>'id')::uuid from results where name='warrant'),'Revogação fundamentada pela perda do objeto da medida.')).status='revoked','juiz emissor revoga mandado com auditoria');
insert into results values('fine',public.issue_fine('11000000-0000-0000-0000-000000000002','Multa judicial fundamentada para teste.',50,now()+interval '7 days')::jsonb);
select pg_temp.assert_true((select (payload->>'success')::boolean from results where name='fine'),'juiz emite multa pelo serviço autorizado');
reset role;
insert into public.government_finances(id,treasury_balance) values(1,0) on conflict(id) do update set treasury_balance=0;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select public.pay_boleto((select payload->'fine'->>'bill_code' from results where name='fine'));
select pg_temp.assert_true((select status='Paga' from public.police_fines where id=(select (payload->'fine'->>'id')::uuid from results where name='fine')),'pagar boleto da multa também quita a multa');
select public.pay_fine((select (payload->'fine'->>'id')::uuid from results where name='fine'));
reset role;
select pg_temp.assert_true((select treasury_balance=50 from public.government_finances where id=1),'multa entra no Tesouro uma vez mesmo com repetição do pagamento');
set local role authenticated;
select pg_temp.assert_true(not(public.validate_and_get_bill((select payload->'fine'->>'bill_code' from results where name='fine'))->>'success')::boolean,'boleto de multa quitada não pode ser pago novamente');
reset role;
insert into public.documents(user_id,type,document_number) values('11000000-0000-0000-0000-000000000001','RG','123456789');
select pg_temp.assert_true((select metadata->>'issuer'='DIC' from public.documents where type='RG'),'documento civil registra DIC como órgão emissor');
insert into public.news_articles(id,author_id,title,content,created_at) values
('66000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Edição de ontem','Matéria real de ontem.','2026-08-01T23:59:00-03:00'),
('66000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','Edição seguinte','Matéria real de outro dia.','2026-08-02T00:01:00-03:00');
select pg_temp.assert_true(public.get_daily_news('2026-08-01',0)->>'total'='1' and public.get_daily_news('2026-08-01',0)->>'next_date'='2026-08-02','jornal agrupa edições pelo dia de publicação no Brasil');
select pg_temp.assert_true(public.get_daily_news('2026-08-02',0)->'items'->0->>'title'='Edição seguinte','arquivo entrega publicações reais sem inventar conteúdo');
rollback;
