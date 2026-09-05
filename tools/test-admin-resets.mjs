import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// The SQL refuses to run if any existing profile is found and rolls back every
// fixture. Point this only at an isolated clone with the migrations installed.
// Load the API's safeupdate module as the container administrator, then drop to
// the usual postgres session identity before running any fixture or assertion.
const container = process.env.RESET_TEST_CONTAINER || 'govrp-reset-test';
const result = spawnSync('docker', [
  'exec', '-i', container, 'sh', '-c',
  `PGPASSWORD="$POSTGRES_PASSWORD" exec psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "load 'safeupdate'; set session authorization postgres;" -f -`,
], {
  input: readFileSync(new URL('../supabase/tests/admin_rp_reset.sql', import.meta.url), 'utf8'),
  encoding: 'utf8',
  maxBuffer: 12 * 1024 * 1024,
});
if (result.error || result.status !== 0) {
  console.error(result.error?.message || `${result.stdout}\n${result.stderr}`.split('\n').slice(-30).join('\n'));
  process.exitCode = 1;
} else {
  const checks = result.stderr.split('\n').filter((line) => line.includes('PASS:'));
  checks.forEach((line) => console.log(line.replace(/^.*NOTICE:\s+PASS:/, '✓')));
  console.log(`\n${checks.length} verificações reais de reset aprovadas; todas as alterações de teste foram desfeitas.`);
}
