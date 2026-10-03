import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const archive = fileURLToPath(new URL('./main-migrations/', import.meta.url));
const requiredDefinitions = [
  { name: 'public.dispatch_locations table', pattern: /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\.dispatch_locations\s*\(/i },
  { name: 'shipments_voided_by_idx index', pattern: /\bcreate\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(?:public\.)?shipments_voided_by_idx\b/i },
];
const excludedFromBusinessReplay = [
  '20260916155248_allow_public_read_test_catalog.sql',
  '20260919102350_add_automatic_text_backup_schedule.sql',
  '20260919105116_enable_pg_net_for_backup_seed.sql',
  '20260919120746_remove_unused_pg_net.sql',
];

// Inventory only: never execute a snapshot or infer that the archive is deployable.
export function inventoryMigrations(directory = archive) {
  const files = readdirSync(directory).filter(name => /^\d{14}_[\w-]+\.sql$/.test(name)).sort();
  const versions = files.map(name => name.slice(0, 14));
  if (new Set(versions).size !== versions.length) throw new Error('Duplicate migration version in historical archive');
  const statements = files.map(name => readFileSync(resolve(directory, name), 'utf8').replace(/--[^\n]*/g, '')).join('\n');
  return {
    files,
    missingDefinitions: requiredDefinitions.filter(item => !item.pattern.test(statements)).map(item => item.name),
    excludedPresent: excludedFromBusinessReplay.filter(name => files.includes(name)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inventoryMigrations();
  console.log(JSON.stringify({ historicalCount: report.files.length, missingDefinitions: report.missingDefinitions, excludedPresent: report.excludedPresent }, null, 2));
  if (report.missingDefinitions.length) {
    console.error('Historical archive is not a complete from-scratch baseline; review provenance before creating formal migrations.');
    process.exitCode = 2;
  }
}
