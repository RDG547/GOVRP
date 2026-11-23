import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createStructuralTestDatabase} from './structural-test-db.mjs';
const db=await createStructuralTestDatabase();let checks=0;
const row=async sql=>(await db.query(sql)).rows[0],check=(value,label)=>{assert(value,label);checks++;};
try{
 for(const file of ['schema','extra-schema','macro-runtime','close-runtime'])await db.exec(readFileSync(new URL(`./fixtures/structural-economy-${file}.sql`,import.meta.url),'utf8'));
 for(const file of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.includes('structural_economy')).sort())await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec(`INSERT INTO public.economic_state(id,player_share,simulated_share) VALUES(true,.5,.5);
  SELECT economy_private.ensure_periods('2020-01-15');
  INSERT INTO public.price_basket_items(code,name,category,weight,base_price,current_price) VALUES('qa','QA','food',1,100,100);
  INSERT INTO public.price_observations(basket_item_id,source_table,source_id,price,is_simulated,observed_at_rp)
  SELECT id,'qa','sim',100,true,'2020-01-01' FROM public.price_basket_items;
  INSERT INTO public.price_observations(basket_item_id,product_id,source_table,source_id,price,is_simulated,observed_at_rp)
  SELECT b.id,v.product::uuid,'products',v.source,v.price,false,v.at::timestamptz FROM public.price_basket_items b CROSS JOIN(VALUES
   ('00000000-0000-4000-8000-000000000001','a1',10,'2020-01-01'),('00000000-0000-4000-8000-000000000001','a2',20,'2020-01-20'),
   ('00000000-0000-4000-8000-000000000002','b1',100,'2020-01-01'),('00000000-0000-4000-8000-000000000002','b2',100,'2020-01-20'))v(product,source,price,at);`);
 const month=(await row("SELECT id FROM public.economic_periods WHERE period_type='month' AND rp_year=2020 AND rp_month=1")).id;
 let prices=await row(`SELECT * FROM economy_private.comparable_basket_prices('${month}')`);
 check(Number(prices.price)===125&&Number(prices.observed_products)===2,'Observed prices are same-product ratios, blended with the configured national share');
 await db.exec("INSERT INTO public.price_observations(basket_item_id,source_table,source_id,price,is_simulated,observed_at_rp) SELECT id,'unknown','different-unit',999999,false,'2020-01-21' FROM public.price_basket_items");
 check(Number((await row(`SELECT * FROM economy_private.comparable_basket_prices('${month}')`)).price)===125,'Unidentified prices cannot contaminate the comparable basket');
 await db.exec("INSERT INTO public.price_observations(basket_item_id,product_id,source_table,source_id,price,is_simulated,observed_at_rp) SELECT id,'00000000-0000-4000-8000-000000000001','products','future',9999,false,'2020-02-01' FROM public.price_basket_items");
 check(Number((await row(`SELECT * FROM economy_private.comparable_basket_prices('${month}')`)).price)===125,'Future prices never leak into an earlier CPI');
 await db.exec(`INSERT INTO public.government_expenditures(expenditure_type,source_table,source_id,amount,productive_share,occurred_at_rp) VALUES
  ('government_project','government_projects','capital',100,.8,'2020-01-15'),('infrastructure','government_projects','maintenance',50,1,'2020-01-15'),
  ('social_assistance','automatic_stabilizers','social',20,0,'2020-01-15');
  SELECT economy_private.capture_period_inputs('${month}');`);
 check(Number((await row(`SELECT economy_private.operational_public_investment('${month}') n`)).n)===80,'Captured public capital excludes maintenance and social transfers');
 await db.exec("UPDATE public.government_expenditures SET amount=9999 WHERE source_id='capital'");
 check(Number((await row(`SELECT economy_private.operational_public_investment('${month}') n`)).n)===80,'Public investment uses immutable captured expenses');
 check(Number((await row("SELECT private.household_location_weight('missing') n")).n)===1,'Unknown location uses a neutral score');
 console.log(`PASS: ${checks} release-completion assertions`);
}finally{await db.close();}
