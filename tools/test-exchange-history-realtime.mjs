import assert from 'node:assert/strict';
import { actor, service, request, rpc, subscribe, waitFor, cleanup } from './lib/world-test.mjs';
const country='ZZ';
try {
 const a=await actor('exchange-a'),b=await actor('exchange-b');
 await request(service.from('country_rp_states').upsert({country_code:country,country_name:'País isolado de teste'},{onConflict:'country_code'}));
 await request(service.from('country_rp_exchange_history').delete().eq('country_code',country));
 await request(service.from('country_rp_exchange_rates').upsert({country_code:country,currency_code:'USD',brl_per_unit:5.2,source:'test'},{onConflict:'country_code,currency_code'}));
 const events=[[],[]];
 for(const [i,person] of [a,b].entries())await subscribe(person.client.channel(`fx-history-${person.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'country_rp_exchange_history',filter:`country_code=eq.${country}`},event=>events[i].push(event.new)));
 await new Promise(resolve=>setTimeout(resolve,1800));
 assert.equal((await rpc(b.client,'get_rp_exchange_quotes',{p_country_code:country})).find(q=>q.currency_code==='USD').change_percent,null);
 await request(service.from('country_rp_exchange_history').insert({country_code:country,currency_code:'USD',brl_per_unit:5,source:'test',recorded_at:new Date(Date.now()-86460000).toISOString()}));
 await waitFor(()=>events.every(e=>e.length===1),'histórico em duas sessões');
 for(const person of [a,b])assert.equal(Number((await rpc(person.client,'get_rp_exchange_quotes',{p_country_code:country})).find(q=>q.currency_code==='USD').change_percent),4);
 await request(service.from('country_rp_exchange_rates').update({brl_per_unit:4.9}).eq('country_code',country).eq('currency_code','USD'));
 assert.equal(Number((await rpc(b.client,'get_rp_exchange_quotes',{p_country_code:country})).find(q=>q.currency_code==='USD').change_percent),-2);
 console.log('OK histórico publicado em duas sessões; ausência de histórico, alta de 4% e queda de 2% em 24 horas reais.');
} finally {await service.from('country_rp_exchange_history').delete().eq('country_code',country);await service.from('country_rp_exchange_rates').delete().eq('country_code',country);await cleanup();}
