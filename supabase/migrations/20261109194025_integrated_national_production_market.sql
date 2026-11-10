BEGIN;
-- A real account in the existing ledger, never a second cash/balance system.
ALTER TABLE public.accounts ADD COLUMN state_enterprise_id uuid UNIQUE REFERENCES public.state_enterprises(id);
ALTER TABLE public.accounts DROP CONSTRAINT accounts_account_kind_check;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_account_kind_check CHECK(account_kind IN('personal','business','population','investment_reserve','national_market'));
ALTER TABLE public.accounts DROP CONSTRAINT accounts_holder_check;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_holder_check CHECK(
 (state_enterprise_id IS NULL AND ((account_kind='personal' AND user_id IS NOT NULL AND business_id IS NULL AND investment_id IS NULL)
 OR (account_kind='business' AND user_id IS NULL AND business_id IS NOT NULL AND investment_id IS NULL)
 OR (account_kind='population' AND user_id IS NULL AND business_id IS NULL AND investment_id IS NULL)
 OR (account_kind='investment_reserve' AND user_id IS NULL AND business_id IS NULL AND investment_id IS NOT NULL)))
 OR (account_kind='national_market' AND state_enterprise_id IS NOT NULL AND user_id IS NULL AND business_id IS NULL AND investment_id IS NULL));
INSERT INTO public.accounts(account_kind,state_enterprise_id,account_number,balance)
SELECT 'national_market',id,'MN-'||id::text,0 FROM public.state_enterprises WHERE service_key='national_market';

CREATE TABLE public.national_market_references(
 resource_code text PRIMARY KEY REFERENCES public.economic_resources(code),
 unit_price numeric NOT NULL CHECK(unit_price>0 AND unit_price<=100000000 AND unit_price=round(unit_price,2)),
 base_price numeric NOT NULL CHECK(base_price>0 AND base_price<=100000000),
 per_capita_daily numeric NOT NULL DEFAULT 0.00001 CHECK(per_capita_daily>=0 AND per_capita_daily<=10),
 reserve_days integer NOT NULL DEFAULT 7 CHECK(reserve_days BETWEEN 1 AND 30),
 automatic_price boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.national_market_stock(
 resource_code text PRIMARY KEY REFERENCES public.economic_resources(code),
 quantity numeric NOT NULL DEFAULT 0 CHECK(quantity>=0),
 unit_cost numeric NOT NULL DEFAULT 0 CHECK(unit_cost>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.national_market_purchases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 resource_code text NOT NULL REFERENCES public.economic_resources(code),
 quantity numeric NOT NULL CHECK(quantity>0),unit_price numeric NOT NULL CHECK(unit_price>0),
 gross_amount numeric NOT NULL CHECK(gross_amount>0),net_amount numeric NOT NULL CHECK(net_amount>=0),
 is_service boolean NOT NULL,service_remaining numeric NOT NULL DEFAULT 0 CHECK(service_remaining>=0),
 transaction_id uuid NOT NULL REFERENCES public.transactions(id),
 idempotency_key uuid NOT NULL UNIQUE,actor_id uuid REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((is_service AND service_remaining<=quantity) OR (NOT is_service AND service_remaining=0))
);
CREATE INDEX national_market_supplier_history ON public.national_market_purchases(business_id,created_at DESC);
CREATE INDEX national_market_service_capacity ON public.national_market_purchases(resource_code,created_at) WHERE service_remaining>0;
CREATE TABLE public.national_market_consumption(
 operation_date date NOT NULL,resource_code text NOT NULL REFERENCES public.economic_resources(code),
 quantity numeric NOT NULL CHECK(quantity>=0),amount numeric NOT NULL CHECK(amount>=0),
 PRIMARY KEY(operation_date,resource_code)
);
ALTER TABLE public.businesses ADD COLUMN national_market_auto boolean NOT NULL DEFAULT true;

-- Reference entries contain no fabricated production or inventory. Preserve
-- existing recipe units (for example bread is currently produced in units).
INSERT INTO public.economic_resources(code,name,unit,base_price,is_service) VALUES
 ('bread_kg','Pão','kg',12,false),('rice','Arroz','kg',7,false),('beans','Feijão','kg',9,false),
 ('beef','Carne bovina','kg',35,false),('chicken','Frango','kg',14,false),('eggs','Ovos','dúzia',12,false),
 ('mineral_water','Água mineral','litro',2,false),('cooking_oil','Óleo de cozinha','litro',9,false),('sugar','Açúcar','kg',5,false),
 ('gasoline','Gasolina','litro',6.5,false),('diesel','Diesel','litro',6.2,false),('cement','Cimento','saco de 50 kg',40,false),
 ('brick','Tijolo','unidade',1.2,false),('construction_hour','Serviço de construção civil','hora',35,true),('transport_km','Serviço de transporte','km',3,true)
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.national_market_references(resource_code,unit_price,base_price)
SELECT code,CASE code WHEN 'milk' THEN 6 WHEN 'cleaning' THEN 20 WHEN 'consulting' THEN 100 ELSE round(base_price,2) END,
CASE code WHEN 'milk' THEN 6 WHEN 'cleaning' THEN 20 WHEN 'consulting' THEN 100 ELSE round(base_price,2) END FROM public.economic_resources;
CREATE FUNCTION private.register_national_market_resource() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 INSERT INTO public.national_market_references(resource_code,unit_price,base_price) VALUES(new.code,round(new.base_price,2),round(new.base_price,2)) ON CONFLICT DO NOTHING;RETURN new;
END $$;
CREATE TRIGGER register_national_market_resource AFTER INSERT ON public.economic_resources FOR EACH ROW EXECUTE FUNCTION private.register_national_market_resource();
REVOKE ALL ON FUNCTION private.register_national_market_resource() FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.national_market_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.national_market_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.national_market_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.national_market_consumption ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.national_market_references,public.national_market_stock,public.national_market_purchases,public.national_market_consumption FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.national_market_references,public.national_market_stock,public.national_market_purchases,public.national_market_consumption TO authenticated;
CREATE POLICY national_references_read ON public.national_market_references FOR SELECT TO authenticated USING(true);
CREATE POLICY national_stock_read ON public.national_market_stock FOR SELECT TO authenticated USING(true);
CREATE POLICY national_consumption_read ON public.national_market_consumption FOR SELECT TO authenticated USING(true);
CREATE POLICY national_purchases_read ON public.national_market_purchases FOR SELECT TO authenticated USING(public.has_full_admin_access() OR EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=business_id AND b.owner_id=(SELECT auth.uid())));

CREATE FUNCTION public.configure_national_reference(p_resource text,p_price numeric,p_daily numeric,p_days integer,p_automatic boolean,p_version integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM private.require_competition_admin();
 IF p_price IS NULL OR p_price::text IN('NaN','Infinity','-Infinity') OR p_daily IS NULL OR p_daily::text IN('NaN','Infinity','-Infinity') OR p_days IS NULL OR p_automatic IS NULL THEN RAISE EXCEPTION 'Informe preço e demanda válidos.';END IF;
 UPDATE public.national_market_references SET unit_price=p_price,base_price=p_price,per_capita_daily=p_daily,reserve_days=p_days,automatic_price=p_automatic,version=version+1,updated_at=clock_timestamp() WHERE resource_code=p_resource AND version=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'A referência foi alterada. Atualize antes de salvar.';END IF;
 PERFORM economy_private.audit('national_reference_changed','economic_resources',p_resource,NULL,jsonb_build_object('price',p_price,'daily',p_daily,'reserve_days',p_days,'automatic',p_automatic),'Parâmetros de abastecimento nacional.',auth.uid());
END $$;

CREATE FUNCTION public.fund_national_market(p_amount numeric,p_key uuid) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.accounts%rowtype;treasury numeric;t public.transactions%rowtype;
BEGIN
 PERFORM private.require_competition_admin();
 IF p_key IS NULL OR p_amount IS NULL OR p_amount::text IN('NaN','Infinity','-Infinity') OR p_amount=0 OR abs(p_amount)>1000000000 OR p_amount<>round(p_amount,2) THEN RAISE EXCEPTION 'Informe um aporte ou devolução válido.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 SELECT * INTO t FROM public.transactions WHERE idempotency_key=p_key;
 IF t.id IS NOT NULL THEN
  IF t.type<>'national_market_funding' OR t.metadata->>'actor_id' IS DISTINCT FROM auth.uid()::text OR (t.metadata->>'signed_amount')::numeric IS DISTINCT FROM p_amount THEN RAISE EXCEPTION 'Identificação de operação já utilizada.';END IF;
  RETURN (SELECT balance FROM public.accounts WHERE account_kind='national_market' AND id=coalesce(t.to_account_id,t.from_account_id));
 END IF;
 SELECT a0.* INTO a FROM public.accounts a0 JOIN public.state_enterprises s ON s.id=a0.state_enterprise_id WHERE s.service_key='national_market' AND s.is_active AND a0.account_kind='national_market' FOR UPDATE OF a0;
 SELECT treasury_balance INTO treasury FROM public.government_finances WHERE id=1 FOR UPDATE;
 IF a.id IS NULL OR treasury IS NULL OR (p_amount>0 AND treasury<p_amount) OR (p_amount<0 AND a.balance<abs(p_amount)) THEN RAISE EXCEPTION 'Saldo disponível insuficiente.';END IF;
 UPDATE public.accounts SET balance=balance+p_amount,updated_at=clock_timestamp() WHERE id=a.id;
 UPDATE public.government_finances SET treasury_balance=treasury_balance-p_amount,updated_at=clock_timestamp() WHERE id=1;
 INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) VALUES(CASE WHEN p_amount<0 THEN a.id END,CASE WHEN p_amount>0 THEN a.id END,abs(p_amount),'national_market_funding','Orçamento de compras do Mercado Nacional',jsonb_build_object('actor_id',auth.uid(),'signed_amount',p_amount,'treasury_transfer',true),p_key);
 PERFORM economy_private.audit('national_market_funding','accounts',a.id::text,jsonb_build_object('balance',a.balance),jsonb_build_object('balance',a.balance+p_amount),'Transferência entre o Tesouro e a conta oficial do Mercado Nacional.',auth.uid());
 RETURN a.balance+p_amount;
END $$;

CREATE FUNCTION private.buy_national_production(p_business uuid,p_resource text,p_key uuid,p_actor uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.businesses%rowtype;i public.business_inventory%rowtype;r public.national_market_references%rowtype;a public.accounts%rowtype;existing public.national_market_purchases%rowtype;service boolean;population numeric;held numeric;demand numeric;qty numeric;amount numeric;q jsonb;gross numeric;net numeric;tx uuid;attempt integer;
BEGIN
 IF p_key IS NULL THEN RAISE EXCEPTION 'Identificação de operação obrigatória.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 SELECT * INTO existing FROM public.national_market_purchases WHERE idempotency_key=p_key;
 IF existing.id IS NOT NULL THEN
  IF existing.business_id<>p_business OR existing.resource_code<>p_resource OR existing.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Identificação pertence a outra compra.';END IF;
  RETURN to_jsonb(existing);
 END IF;
 SELECT * INTO b FROM public.businesses WHERE id=p_business AND status='active' FOR UPDATE;
 SELECT * INTO r FROM public.national_market_references WHERE resource_code=p_resource FOR SHARE;
 SELECT is_service INTO service FROM public.economic_resources WHERE code=p_resource;
 SELECT * INTO i FROM public.business_inventory WHERE business_id=p_business AND resource_code=p_resource FOR UPDATE;
 IF b.id IS NULL OR r.resource_code IS NULL OR i.quantity IS NULL OR i.quantity<=0 OR NOT i.available_for_sale THEN RETURN jsonb_build_object('quantity',0,'reason','Sem produção disponível para venda.');END IF;
 -- Acquire the same account locks as all existing company settlements.
 PERFORM id FROM public.accounts WHERE id=b.bank_account_id OR (account_kind='national_market' AND state_enterprise_id IN(SELECT id FROM public.state_enterprises WHERE service_key='national_market' AND is_active)) ORDER BY id FOR UPDATE;
 SELECT a0.* INTO a FROM public.accounts a0 JOIN public.state_enterprises s ON s.id=a0.state_enterprise_id WHERE s.service_key='national_market' AND s.is_active AND a0.account_kind='national_market';
 IF a.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=b.bank_account_id AND business_id=b.id) THEN RAISE EXCEPTION 'Conta oficial do comprador ou da empresa indisponível.';END IF;
 SELECT coalesce(sum(population_count),0) INTO population FROM public.country_population_segments WHERE country_code='BR';
 IF service THEN SELECT coalesce(sum(service_remaining),0) INTO held FROM public.national_market_purchases WHERE resource_code=p_resource AND service_remaining>0;
 ELSE SELECT coalesce(sum(quantity),0) INTO held FROM public.national_market_stock WHERE resource_code=p_resource;END IF;
 demand:=greatest(0,population*r.per_capita_daily*(CASE WHEN service THEN 1 ELSE r.reserve_days END)-held);
 qty:=least(i.quantity,trunc(demand,3),trunc(a.balance/r.unit_price,3),1000000);
 IF qty<=0 THEN RETURN jsonb_build_object('quantity',0,'reason','Orçamento ou demanda de abastecimento indisponível.');END IF;
 -- Quotes are computed by the current legal engine. Downsize partial orders
 -- to the actual gross debit, including current taxes and fixed levies.
 FOR attempt IN 1..4 LOOP
  amount:=round(qty*r.unit_price,2);
  IF amount<=0 THEN RETURN jsonb_build_object('quantity',0,'reason','Quantidade inferior à unidade monetária.');END IF;
  q:=public.quote_legal_levies('purchase',amount,true,b.economic_sector_id,'Insumos',NULL,b.region_code);
  IF coalesce((q->>'restricted')::boolean,false) THEN RETURN jsonb_build_object('quantity',0,'reason','Operação restrita por norma vigente.');END IF;
  gross:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
  EXIT WHEN gross<=a.balance;
  qty:=greatest(0,trunc(qty*a.balance/greatest(gross,.01)-.001,3));
 END LOOP;
 IF qty<=0 OR gross>a.balance OR gross IS NULL OR net IS NULL OR net<0 THEN RETURN jsonb_build_object('quantity',0,'reason','Orçamento insuficiente para tributos e produção.');END IF;
 UPDATE public.accounts SET balance=balance-gross,updated_at=clock_timestamp() WHERE id=a.id;
 UPDATE public.accounts SET balance=balance+net,updated_at=clock_timestamp() WHERE id=b.bank_account_id;
 IF gross>net THEN UPDATE public.government_finances SET treasury_balance=treasury_balance+gross-net,updated_at=clock_timestamp() WHERE id=1;IF NOT FOUND THEN RAISE EXCEPTION 'Tesouro indisponível para recolhimento.';END IF;END IF;
 UPDATE public.business_inventory SET quantity=quantity-qty,updated_at=clock_timestamp() WHERE business_id=b.id AND resource_code=p_resource;
 IF NOT service THEN
  INSERT INTO public.national_market_stock(resource_code,quantity,unit_cost) VALUES(p_resource,qty,gross/qty)
  ON CONFLICT(resource_code) DO UPDATE SET unit_cost=(public.national_market_stock.quantity*public.national_market_stock.unit_cost+gross)/(public.national_market_stock.quantity+qty),quantity=public.national_market_stock.quantity+qty,updated_at=clock_timestamp();
 END IF;
 INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
 VALUES(a.id,b.bank_account_id,amount,'business_supply','Venda ao Mercado Nacional: '||p_resource,q||jsonb_build_object('business_id',b.id,'seller_business_id',b.id,'buyer_kind','government','resource_code',p_resource,'quantity',qty,'reference_price',r.unit_price,'final_consumption',false,'national_market',true),p_key) RETURNING id INTO tx;
 INSERT INTO public.national_market_purchases(business_id,resource_code,quantity,unit_price,gross_amount,net_amount,is_service,service_remaining,transaction_id,idempotency_key,actor_id)
 VALUES(b.id,p_resource,qty,r.unit_price,gross,net,service,CASE WHEN service THEN qty ELSE 0 END,tx,p_key,p_actor) RETURNING * INTO existing;
 INSERT INTO public.business_transactions(business_id,type,amount,description,metadata,operation_key)
 VALUES(b.id,'revenue',amount,'Venda ao Mercado Nacional',jsonb_build_object('kind','national_market_sale','quantity',qty,'resource_code',p_resource,'unit_price',r.unit_price,'transaction_id',tx),'national-sale:'||p_key);
 IF amount>net THEN INSERT INTO public.business_transactions(business_id,type,amount,description,metadata,operation_key) VALUES(b.id,'tax',net-amount,'Tributos da venda ao Mercado Nacional',q,'national-tax:'||p_key);END IF;
 IF gross>net THEN INSERT INTO public.government_revenues(revenue_type,source_table,source_id,business_id,amount,occurred_at_rp,metadata) VALUES('consumption_tax','transactions',tx::text,b.id,gross-net,public.rp_now(),q);END IF;
 UPDATE public.business_daily_operations SET sold_quantity=sold_quantity+qty,revenue=revenue+amount WHERE business_id=b.id AND operation_date=current_date;
 RETURN to_jsonb(existing);
END $$;
REVOKE ALL ON FUNCTION private.buy_national_production(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sell_national_production(p_business uuid,p_resource text,p_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.uid() IS NULL OR NOT private.can_manage_company(p_business) THEN RAISE EXCEPTION 'A venda exige autorização de gestão da empresa.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 RETURN private.buy_national_production(p_business,p_resource,p_key,auth.uid());
END $$;
CREATE FUNCTION public.set_national_production_automatic(p_business uuid,p_enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.uid() IS NULL OR NOT private.can_manage_company(p_business) THEN RAISE EXCEPTION 'A configuração exige gestão da empresa.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 UPDATE public.businesses SET national_market_auto=p_enabled,updated_at=clock_timestamp() WHERE id=p_business;
END $$;

CREATE FUNCTION private.consume_national_market(p_day date,p_budget numeric) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row record;contract record;population numeric;demand numeric;held numeric;qty numeric;remaining numeric;amount numeric;spent numeric:=0;market uuid;buyer public.accounts%rowtype;
BEGIN
 SELECT id INTO market FROM public.accounts WHERE account_kind='national_market';
 SELECT * INTO buyer FROM public.accounts WHERE account_kind='population' FOR UPDATE;
 IF market IS NULL OR buyer.id IS NULL THEN RETURN 0;END IF;
 SELECT coalesce(sum(population_count),0) INTO population FROM public.country_population_segments WHERE country_code='BR';
 FOR row IN SELECT r.*,e.is_service FROM public.national_market_references r JOIN public.economic_resources e ON e.code=r.resource_code ORDER BY r.resource_code LOOP
  IF EXISTS(SELECT 1 FROM public.national_market_consumption WHERE operation_date=p_day AND resource_code=row.resource_code) THEN CONTINUE;END IF;
  IF row.is_service THEN SELECT coalesce(sum(service_remaining),0) INTO held FROM public.national_market_purchases WHERE resource_code=row.resource_code AND service_remaining>0;
  ELSE SELECT coalesce(sum(quantity),0) INTO held FROM public.national_market_stock WHERE resource_code=row.resource_code;END IF;
  demand:=population*row.per_capita_daily;
  qty:=least(held,trunc(demand,3),trunc(greatest(0,least(p_budget-spent,buyer.balance-spent))/row.unit_price,3));
  amount:=round(qty*row.unit_price,2);
  IF qty<=0 OR amount<=0 THEN CONTINUE;END IF;
  IF row.is_service THEN
   remaining:=qty;
   FOR contract IN SELECT * FROM public.national_market_purchases WHERE resource_code=row.resource_code AND service_remaining>0 ORDER BY created_at,id FOR UPDATE LOOP
    UPDATE public.national_market_purchases SET service_remaining=service_remaining-least(remaining,contract.service_remaining) WHERE id=contract.id;
    remaining:=remaining-least(remaining,contract.service_remaining);EXIT WHEN remaining<=0;
   END LOOP;
  ELSE UPDATE public.national_market_stock SET quantity=quantity-qty,updated_at=clock_timestamp() WHERE resource_code=row.resource_code;END IF;
  UPDATE public.accounts SET balance=balance-amount,updated_at=clock_timestamp() WHERE id=buyer.id;
  UPDATE public.accounts SET balance=balance+amount,updated_at=clock_timestamp() WHERE id=market;
  INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
  VALUES(buyer.id,market,amount,'population_purchase','Consumo do estoque nacional: '||row.resource_code,jsonb_build_object('resource_code',row.resource_code,'quantity',qty,'operation_date',p_day,'national_market',true,'final_consumption',true),md5('national-consumption:'||p_day||':'||row.resource_code)::uuid);
  INSERT INTO public.national_market_consumption VALUES(p_day,row.resource_code,qty,amount);
  spent:=spent+amount;
 END LOOP;
 RETURN spent;
END $$;
REVOKE ALL ON FUNCTION private.consume_national_market(date,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.procure_national_market(p_day date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row record;population numeric;BEGIN
 SELECT coalesce(sum(population_count),0) INTO population FROM public.country_population_segments WHERE country_code='BR';
 UPDATE public.national_market_references r
 SET unit_price=round(greatest(.01,least(r.base_price*2,greatest(
   r.base_price*.5,
   coalesce((SELECT avg(i.unit_cost)*1.1 FROM public.business_inventory i WHERE i.resource_code=r.resource_code AND i.quantity>0),r.base_price),
   r.base_price*(1+least(.25,greatest(-.25,
     (population*r.per_capita_daily-coalesce((SELECT sum(s.quantity) FROM public.national_market_stock s WHERE s.resource_code=r.resource_code),0))
       /greatest(1,population*r.per_capita_daily)*.1
   )))
 ))),2),updated_at=clock_timestamp(),version=version+1
 WHERE r.automatic_price;
 FOR row IN SELECT i.business_id,i.resource_code FROM public.business_inventory i JOIN public.businesses b ON b.id=i.business_id WHERE b.status='active' AND b.national_market_auto AND i.quantity>0 AND i.available_for_sale ORDER BY b.id,i.resource_code LOOP
  PERFORM private.buy_national_production(row.business_id,row.resource_code,md5('national-auto:'||p_day||':'||row.business_id||':'||row.resource_code)::uuid,NULL);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.procure_national_market(date) FROM PUBLIC,anon,authenticated,service_role;

-- Integrate with the installed daily demand engine. Its existing run guard
-- prevents duplicate consumption and its budget caps national + direct sales.
DO $$ DECLARE body text;anchor text:='select count(*) into resource_count from public.economic_resources';BEGIN
 body:=pg_get_functiondef('private.simulate_population_demand(date)'::regprocedure);
 IF position(anchor in body)=0 THEN RAISE EXCEPTION 'O motor demográfico mudou; revise a integração antes de implantar.';END IF;
 body:=replace(body,anchor,'perform private.procure_national_market(p_day); spent:=private.consume_national_market(p_day,total_budget); '||anchor);
 body:=replace(body,'budget:=total_budget*(1-retail_share)','budget:=greatest(0,total_budget-spent)*(1-retail_share)');
 EXECUTE body;
END $$;

CREATE FUNCTION public.get_national_production_catalog(p_business uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar o Mercado Nacional.' USING errcode='42501';END IF;
 RETURN jsonb_build_object('budget',(SELECT a.balance FROM public.accounts a JOIN public.state_enterprises s ON s.id=a.state_enterprise_id WHERE s.service_key='national_market' AND a.account_kind='national_market'),
 'references',(SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('name',e.name,'unit',e.unit,'is_service',e.is_service,'stock',coalesce(s.quantity,0)) ORDER BY e.name),'[]') FROM public.national_market_references r JOIN public.economic_resources e ON e.code=r.resource_code LEFT JOIN public.national_market_stock s ON s.resource_code=r.resource_code),
 'offers',(SELECT coalesce(jsonb_agg(jsonb_build_object('business_id',b.id,'company_name',b.name,'resource_code',e.code,'name',e.name,'unit',e.unit,'is_service',e.is_service,'quantity',CASE WHEN i.available_for_sale THEN coalesce(i.quantity,0) ELSE 0 END,'unit_price',r.unit_price,'automatic',b.national_market_auto) ORDER BY b.name,e.name),'[]') FROM public.businesses b JOIN public.business_recipes recipe ON recipe.business_type_id=b.business_type_id JOIN public.economic_resources e ON e.code=recipe.output_resource LEFT JOIN public.business_inventory i ON i.business_id=b.id AND i.resource_code=e.code LEFT JOIN public.national_market_references r ON r.resource_code=e.code WHERE b.status='active' AND (p_business IS NULL OR b.id=p_business)),
 'purchases',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]') FROM (SELECT p.id,p.business_id,p.resource_code,p.quantity,p.unit_price,p.gross_amount,p.net_amount,p.is_service,p.created_at FROM public.national_market_purchases p WHERE (p_business IS NULL OR p.business_id=p_business) AND (public.has_full_admin_access() OR EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=p.business_id AND b.owner_id=auth.uid())) ORDER BY p.created_at DESC LIMIT 100)x));
END $$;

REVOKE ALL ON FUNCTION public.configure_national_reference(text,numeric,numeric,integer,boolean,integer),public.fund_national_market(numeric,uuid),public.sell_national_production(uuid,text,uuid),public.set_national_production_automatic(uuid,boolean),public.get_national_production_catalog(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_national_reference(text,numeric,numeric,integer,boolean,integer),public.fund_national_market(numeric,uuid),public.sell_national_production(uuid,text,uuid),public.set_national_production_automatic(uuid,boolean),public.get_national_production_catalog(uuid) TO authenticated;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['national_market_references','national_market_stock','national_market_purchases','national_market_consumption'] LOOP
  EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
