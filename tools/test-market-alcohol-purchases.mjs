import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Ensure a new reset will not silently recreate non-purchasable alcohol stock.
const migration = readFileSync('supabase/migrations/20261105224500_fix_alcohol_product_effects.sql','utf8');
const commerce = readFileSync('src/lib/commerce.js','utf8');

for (const id of ['000000000021','000000000022','000000000023']) {
  assert.ok(migration.includes(id), `Missing alcohol catalog SKU ${id}`);
}
assert.match(migration, /consumable_effects=jsonb_build_object\('thirst',15,'happiness',8,'health',-3\)/);
assert.match(migration, /pg_get_functiondef\('private\.seed_reset_world\(uuid\)'::regprocedure\)/);
assert.match(migration, /EXECUTE replace\(v_definition,v_before,v_after\)/);
assert.match(migration, /RAISE EXCEPTION 'Alcohol catalog is not aligned/);
assert.match(migration, /BEGIN;/);
assert.match(migration, /COMMIT;/);
// Price, user balances, order history and payment transactions must never be rewritten.
assert.doesNotMatch(migration,/UPDATE public\.(accounts|transactions|commerce_orders|user_inventory|government_finances)\s+SET/i);
assert.doesNotMatch(migration,/UPDATE public\.products SET[^;]*\bprice\s*=/i);

// The UI may not replace actionable safe backend messages with generic copy.
assert.match(commerce, /message: purchaseErrorMessage\(error\)/);
assert.match(commerce, /export const purchaseErrorMessage = error => PURCHASE_ERRORS\[error\?\.message\] \|\| userErrorMessage/);
assert.match(commerce, /p_idempotency_key: idempotencyKey/);
console.log('PASS: alcohol catalog and reset repaired, purchase error details sanitized, idempotency preserved');
