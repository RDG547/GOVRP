import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// The SQL refuses to run if any existing profile is found and rolls back every
// fixture. Point this only at an isolated clone with the migrations installed.
const container = process.env.RESET_TEST_CONTAINER || 'govrp-reset-test';
const result = spawnSync('docker', [
  'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
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
  checks.forEach((line) => console.log(line.replace('NOTICE:  PASS:', '✓')));
  console.log(`\n${checks.length} verificações reais de reset aprovadas; todas as alterações de teste foram desfeitas.`);
}
