import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261109180000_expire_elected_terms_without_successor.sql',
  'utf8',
);

// No new term or additional month may be granted just because there is no successor.
assert.match(migration, /CREATE OR REPLACE FUNCTION private\.extend_due_elected_mandates\(\)/);
assert.match(migration, /-- Mantem o nome antigo apenas como compatibilidade: nao prolonga mandatos/);
assert.match(migration, /CREATE OR REPLACE FUNCTION private\.expire_due_elected_mandates\(\)/);
assert.match(migration, /WHERE status = 'active' AND term_ends_at <= clock_timestamp\(\)/);
assert.match(migration, /SET status = 'expired'/);
assert.match(migration, /NOT EXISTS \([\s\S]*?next_term\.status = 'active'/);
assert.match(migration, /PERFORM private\.expire_due_elected_mandates\(\)/);
assert.doesNotMatch(
  migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION private.maintain_government_term')),
  /PERFORM private\.extend_due_elected_mandates\(\)/,
);
console.log('PASS: elected terms expire on schedule without successor; reelection protected.');
