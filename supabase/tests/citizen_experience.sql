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
-- Regression cases from the nine-item experience audit.
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',true);
set local role authenticated;
insert into results values('normal-occurrence',to_jsonb(public.create_police_occurrence('Relato identificado','Descrição completa do relato identificado para testar sigilo.','Denúncia','Local de teste',now(),false,'normal')));
reset role;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.triage_police_occurrence((select (payload->>'id')::uuid from results where name='normal-occurrence'),'accept','SEGREDO-INTERNO-REGRESSAO');
reset role;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.police_occurrences),'cidadão não lê diretamente notas internas nem da própria ocorrência normal');
select pg_temp.assert_true(not exists(select 1 from public.justice_audit_log a where entity_id=(select (payload->>'id')::uuid from results where name='normal-occurrence') and to_jsonb(a)::text like '%SEGREDO-INTERNO%'),'cidadão não obtém triagem pelo log interno');
insert into results values('safe-page',public.get_my_police_occurrences_page());
select pg_temp.assert_true((select jsonb_array_length(payload->'items')=2 from results where name='safe-page'),'RPC paginada mantém relatos próprios normais e anônimos');
select pg_temp.assert_true((select payload::text not like '%SEGREDO-INTERNO%' and payload::text not like '%triage_notes%' and payload::text not like '%assigned_officer_id%' from results where name='safe-page'),'projeção de todas as ocorrências exclui conteúdo interno');
select pg_temp.assert_true(exists(select 1 from public.notifications where user_id=auth.uid() and type='justice_occurrence_status_changed' and metadata->>'occurrence_id'=(select payload->>'id' from results where name='normal-occurrence')),'andamento permanece disponível por notificação segura');
insert into results values('clearance',to_jsonb(public.issue_criminal_clearance_certificate()));
select pg_temp.assert_true((select payload->>'type'='Atestado de Antecedentes' and payload->'metadata'->>'result'='nothing_found' and (payload->>'is_valid')::boolean from results where name='clearance'),'atestado válido possui tipo e resultado usados pelo modelo do DIC');
do $$ begin
 perform public.save_business_product(null,null,'Produto PF','Produto com promoção inválida.',100,'https://example.invalid/product.png','one-time',null,'Outros',2,150,null);
 raise exception 'PROMOÇÃO INVÁLIDA FOI ACEITA';
exception when others then if sqlerrm<>'INVALID_PROMOTION' then raise; end if;
 raise notice 'PASS: backend mantém recusa de promoção acima do preço normal'; end $$;
do $$ begin
 for i in 1..103 loop
  perform public.create_police_occurrence('Ocorrência de volume '||i,'Descrição completa dos fatos para teste de paginação.','Denúncia','Local de teste',now(),false,'normal');
 end loop;
end $$;
create temporary table paged_occurrences(id uuid primary key);
do $$ declare page jsonb; cursor_created timestamptz; cursor_id uuid; pages integer:=0; begin
 loop
  page:=public.get_my_police_occurrences_page(17,cursor_created,cursor_id);
  insert into paged_occurrences select (item->>'id')::uuid from jsonb_array_elements(page->'items') item;
  pages:=pages+1;
  exit when page->'next_cursor'='null'::jsonb;
  cursor_created:=(page->'next_cursor'->>'created_at')::timestamptz;
  cursor_id:=(page->'next_cursor'->>'id')::uuid;
  if pages>20 then raise exception 'PAGINAÇÃO NÃO TERMINOU'; end if;
 end loop;
 perform pg_temp.assert_true((select count(*)=105 from paged_occurrences),'paginação percorre 105 ocorrências sem omissão ou duplicação');
 perform pg_temp.assert_true(pages=7,'cursor ordenado por data e ID percorre sete páginas');
 perform pg_temp.assert_true((page->>'active_count')::integer=105,'contador de ocorrências considera todas as páginas');
end $$;
select pg_temp.assert_true(jsonb_array_length(public.get_my_police_occurrences_page(10000)->'items')=100,'limite de leitura por página é respeitado');
do $$ begin
 perform public.get_my_police_occurrences_page(20,now(),null);
 raise exception 'CURSOR INCOMPLETO FOI ACEITO';
exception when others then if sqlerrm<>'INVALID_PAGE_CURSOR' then raise; end if;
 raise notice 'PASS: cursor incompleto é rejeitado'; end $$;
reset role;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select pg_temp.assert_true(exists(select 1 from public.police_occurrences where triage_notes='SEGREDO-INTERNO-REGRESSAO'),'delegado autorizado mantém acesso à triagem interna');
select pg_temp.assert_true(jsonb_array_length(public.get_my_police_occurrences_page()->'items')=0,'mesmo autoridade recebe somente sua autoria pela RPC do cidadão');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
update public.profiles set role='Cidadão',manual_role_override=true where id='11000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select pg_temp.assert_true(jsonb_array_length(public.get_my_police_occurrences_page()->'items')=0,'terceiro não recebe relatos de outro autor pela paginação');
select pg_temp.assert_true((select count(*)=0 from public.police_occurrences),'terceiro também não lê a tabela de ocorrências');
select pg_temp.assert_true(not has_function_privilege('anon','public.get_my_police_occurrences_page(integer,timestamptz,uuid)','execute'),'RPC paginada não está liberada para sessões anônimas');
rollback;
