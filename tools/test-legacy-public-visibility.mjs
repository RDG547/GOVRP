import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// SQL requires an empty isolated clone and rolls back all fixture writes.
const result = spawnSync('docker', [
  'exec', '-i', 'govrp-reset-test', 'sh', '-c',
  `PGPASSWORD="$POSTGRES_PASSWORD" exec psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "load 'safeupdate'; set session authorization postgres;" -f -`,
], { input: readFileSync(new URL('../supabase/tests/legacy_public_visibility.sql', import.meta.url), 'utf8'), encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
if (result.error || result.status !== 0) {
  console.error(result.error?.message || `${result.stdout}\n${result.stderr}`.split('\n').slice(-25).join('\n'));
  process.exitCode = 1;
} else {
  const checks = result.stderr.split('\n').filter(line => line.includes('PASS:'));
  checks.forEach(line => console.log(line.replace(/^.*NOTICE:\s+PASS:/, '✓')));
  console.log(`\n${checks.length} verificações de visibilidade legada aprovadas; dados de teste desfeitos.`);
}
