import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const form = read('src/components/social-x/CreatePostForm.jsx');
const news = read('src/lib/newsPublisher.js');
const migration = read('supabase/migrations/20261120035635_bot_government_and_president_news_guard.sql');

assert.ok(form.includes(".from('posts').insert("),'Ordinary X posts should still publish.');
assert.ok(!form.includes('publishPresidentPostNews'),'The president cannot automatically generate official news from a normal X post.');
assert.ok(!news.includes('publishPresidentPostNews'),'There must be no legacy auto-promote helper.');
assert.ok(migration.includes("NEW.title LIKE '📢 Pronunciamento Oficial do Presidente:%'"),
  'The WhatsApp outbox must also ignore cached legacy X client auto-news.');
assert.ok(migration.includes("title NOT LIKE '📢 Pronunciamento Oficial do Presidente:%'"),
  '!noticias must exclude legacy auto-generated pronouncement articles.');
assert.ok(migration.includes("JOIN public.government_terms g ON g.id=m.government_id") &&
  migration.includes("c.election_id=g.election_id") &&
  migration.includes("t.office_key='public_prosecutor'"),
  '!governo must use current government term, electoral vice and active PGR appointment.');
assert.ok(migration.includes('Formação governamental') && migration.includes('Vice-Presidente da República'),
  '!governo must include the full formation in the required order.');
console.log('✓ GOVRP bot news filtering and current-government command contracts passed.');
