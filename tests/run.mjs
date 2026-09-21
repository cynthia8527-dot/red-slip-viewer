import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mainId = 'icqdmzndjmxffnlciijs';
const envUrls = ['TEST_SUPABASE_URL', 'SUPABASE_URL', 'DATABASE_URL', 'POSTGRES_URL'];
for (const name of envUrls) {
  const value = process.env[name];
  if (value && (value.includes(mainId) || !/^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)|postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$))/.test(value))) {
    console.error(`PRE-FLIGHT FAIL: ${name} is not an isolated loopback target.`);
    process.exit(1);
  }
}
for (const page of ['board', 'calculator', 'dispatch', 'vendors']) {
  const source = readFileSync(resolve(root, page, 'index.html'), 'utf8');
  if (source.includes(mainId) || !source.includes("from '../config.js'")) {
    console.error(`PRE-FLIGHT FAIL: ${page} bypasses shared configuration or embeds main project ID.`);
    process.exit(1);
  }
}
console.log('PRE-FLIGHT PASS: no test target or data page points directly at main Supabase.');
// The suite has no HTTP client; it uses local, in-memory SQLite and file fixtures only.
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
  'tests/config.test.mjs', 'tests/pricing.test.mjs', 'tests/data.test.mjs', 'tests/smoke.test.mjs', 'tests/browser.test.mjs'],
  { cwd: root, encoding: 'utf8', env: { ...process.env, TEST_MODE: 'offline' } });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
const count = name => Number(result.stdout?.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN);
const total = count('tests'), passed = count('pass'), failed = count('fail'), skipped = count('skipped');
if (result.status !== 0 || !Number.isFinite(total) || total === 0 || failed !== 0 || skipped !== 0 || passed !== total) {
  console.error(`TEST RUN FAIL: passed=${passed}, failed=${failed}, skipped=${skipped}, total=${total}, exit=${result.status}`);
  process.exit(1);
}
console.log(`TEST RUN PASS: passed=${passed}, failed=${failed}, skipped=${skipped}; main Supabase connections=0 (offline suite).`);
