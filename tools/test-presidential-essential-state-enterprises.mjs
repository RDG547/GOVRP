import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261103010000_restore_essential_state_enterprises.sql','utf8');
const panel = readFileSync('src/pages/dashboards/panels/PresidentDashboard.jsx','utf8');
const serviceSectors = readFileSync('src/components/business/EnterpriseOperations.jsx','utf8');

const sectors = ['Internet', 'Telefonia', 'Energia Elétrica', 'Água', 'Gás'];
const serviceKeys = [
  'national_internet',
  'national_telephony',
  'national_electricity',
  'national_water',
  'national_gas',
];
for (const sector of sectors) {
  assert.ok(migration.includes(`'${sector}'`), `missing permanent utility: ${sector}`);
  assert.ok(serviceSectors.includes(`value: '${sector}'`), `unrecognized sector: ${sector}`);
}
for (const serviceKey of serviceKeys) {
  assert.ok(migration.includes(`'${serviceKey}'`), `missing service identity: ${serviceKey}`);
}
assert.match(migration, /INSERT INTO public\.state_enterprises/);
assert.match(migration, /is_system, is_active/);
assert.match(migration, /TRUE, TRUE/);
assert.match(migration, /WHERE NOT EXISTS/);
assert.match(migration, /existing\.sector = e\.sector OR existing\.service_key = e\.service_key/);
assert.match(migration, /ON CONFLICT \(service_key\) DO NOTHING/);
assert.match(panel, /\.from\('state_enterprises'\)\.select\('\*'\)\.order\('created_at'/);
assert.match(panel, /const activeEnterprises = enterprises\.filter\(e => !e\.is_privatized\)/);
assert.match(panel, /activeEnterprises\.map\(enterprise/);
console.log('PASS: five permanent utility state enterprises, no duplicates, presidential display intact');
