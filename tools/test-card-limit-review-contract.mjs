import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const citizen = read('src/components/bank/CardLimitRequest.jsx');
const manager = read('src/components/bank/BankManagementPanel.jsx');
const migration = read('supabase/migrations/20261119204000_optional_card_limit_reason_and_admin_reviews.sql');
const integration = read('tools/test-general-update.mjs');

assert.ok(citizen.includes('Justificativa (opcional)'), 'The form must describe the explanation as optional');
assert.ok(!citizen.includes('minLength={10}') && !citizen.includes('reason.trim().length<10'),
  'The citizen must be able to submit an empty explanation');
assert.ok(citizen.includes('maxLength={2000}'), 'Explanations must still have a safe length limit');
assert.ok(migration.includes("length(coalesce(p_justification,''))>2000"),
  'The server must accept an empty or NULL justification');
assert.ok(migration.includes("a.justification=btrim(coalesce(p_justification,''))"),
  'The idempotency check must handle missing reasons');
assert.ok(migration.includes("c.id,c.card_limit,btrim(coalesce(p_justification,'')))"),
  'The persisted request must handle a missing reason');
assert.ok(manager.includes('const canReviewOwnLimitRequest =') &&
  manager.includes("application.user_id === user?.id && !canReviewOwnLimitRequest"),
  'Admin review buttons must work while ordinary bank managers still have a separate reviewer');
assert.ok(migration.includes("a.user_id=auth.uid() AND NOT public.is_admin(auth.uid())"),
  'The backend must enforce platform Admin permission for self-review');
assert.ok(migration.includes("'admin_self_review',a.user_id=auth.uid()"),
  'Administrative self-review must be explicitly audited');
assert.ok(manager.includes('onClick={() => handleCardDecision(application, \'approve\')}') &&
  manager.includes('onClick={() => handleCardDecision(application, \'reject\')}'),
  'Both card approval and rejection buttons must retain functional handlers');
assert.ok(integration.includes('analista não aprova o próprio aumento') &&
  integration.includes('Admin analisa o próprio pedido') &&
  integration.includes('Admin rejeita o próprio pedido') &&
  integration.includes('pedido de aumento sem justificativa'),
  'The isolated integration suite must exercise both role restrictions and optional reasons');
console.log('✓ Card limit requests: optional explanations, authorized reviews, audit and actions verified.');
