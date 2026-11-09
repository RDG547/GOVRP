import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cards = readFileSync('src/components/bank/CardsTab.jsx', 'utf8');
const auth = readFileSync('src/contexts/AuthContext.jsx', 'utf8');
const activity = readFileSync('src/components/UserActivityTracker.jsx', 'utf8');
const migration = readFileSync('supabase/migrations/20261109024000_schedule_authoritative_invoice_closure.sql', 'utf8');

// Expired invoice accounting is a privileged job, not a citizen-triggered RPC.
assert.doesNotMatch(cards, /supabase\.rpc\('close_due_invoices'\)/);
assert.match(cards, /void fetchData\(\)\.catch\(\(\) => setLoading\(false\)\)/);
assert.match(migration, /cron\.schedule\(/);
assert.match(migration, /govrp-close-due-card-invoices/);
assert.match(migration, /SELECT public\.close_due_invoices\(\)/);
assert.match(migration, /has_function_privilege\('authenticated'/);
assert.match(migration, /has_function_privilege\('anon'/);
assert.doesNotMatch(migration, /GRANT EXECUTE .*authenticated/i);

// Transient permission and network failures must not create duplicate profiles.
assert.match(auth, /error\?\.code === 'PGRST116' \|\| \(!error && !profile\)/);
assert.match(auth, /supabase\.rpc\('ensure_profile_exists'\)/);

// Avoid writing session activity using a JWT which has already been removed.
assert.match(activity, /const \{ user, session: authSession \} = useAuth\(\)/);
assert.match(activity, /authSessionRef\.current\?\.user\?\.id !== currentSession\.userId/);
assert.match(activity, /authSessionRef\.current\?\.user\?\.id !== session\.userId/);
assert.match(activity, /document\.visibilityState === 'visible'/);
assert.match(activity, /60000/);

console.log('PASS: privileged invoices stay server-side; profile fallback and auth-bound activity writes remain safe');
