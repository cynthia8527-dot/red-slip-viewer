import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// This runner deliberately has no URL override. It cannot be pointed at main.
const projectId = 'zfcsuxihpakrsohvcwlr';
const baseUrl = `https://${projectId}.supabase.co`;
const credentialFile = new URL('./credentials.local.json', import.meta.url);
const local = existsSync(credentialFile) ? JSON.parse(readFileSync(credentialFile, 'utf8')) : {};
const key = process.env.TEST_CLOUD_PUBLISHABLE_KEY || local.publishableKey;
const email = process.env.TEST_CLOUD_EMAIL || local.email;
let password = process.env.TEST_CLOUD_PASSWORD;

function requireTestEnvironment() {
  if ((process.env.TEST_CLOUD_PROJECT_ID || local.projectId) !== projectId) {
    throw new Error(`Cloud test project must be ${projectId}; no cloud request was sent`);
  }
  if (!password && local.encryptedPassword && process.platform === 'win32') {
    const decrypt = "$secret = ConvertTo-SecureString ([Console]::In.ReadToEnd()); [System.Net.NetworkCredential]::new('', $secret).Password";
    password = execFileSync('pwsh', ['-NoProfile', '-Command', decrypt], {
      input: local.encryptedPassword, encoding: 'utf8', windowsHide: true,
    }).trimEnd();
  }
  if (!key || !email || !password || !/^codex-[a-z0-9-]+@example\.invalid$/i.test(email)) {
    throw new Error('A test-only publishable key, codex-*@example.invalid account and password are required; no cloud request was sent');
  }
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const content = await response.text();
  let data = null;
  try { data = content ? JSON.parse(content) : null; } catch { data = content; }
  return { status: response.status, data };
}

function groupPath(label, vendor) {
  const params = new URLSearchParams({
    select: 'id,vendor_name,label',
    label: `eq.${label}`,
    vendor_name: `eq.${vendor}`,
  });
  return `/rest/v1/intake_groups?${params}`;
}

async function run() {
  requireTestEnvironment();
  const suffix = randomUUID().replaceAll('-', '');
  const label = `CODEX_INVALID_${suffix}`;
  const vendor = `CODEX_TEST_${suffix}`;
  let token;
  let failure;
  let cleanupFailure;
  try {
    const login = await request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email, password },
    });
    if (login.status !== 200 || !login.data?.access_token || login.data.user?.email !== email) {
      throw new Error(`test-only login expected HTTP 200, got ${login.status}`);
    }
    token = login.data.access_token;
    const profile = await request(`/rest/v1/profiles?select=role,active&user_id=eq.${login.data.user.id}`, { token });
    if (profile.status !== 200 || profile.data?.length !== 1 || profile.data[0].role !== 'admin' || !profile.data[0].active) {
      throw new Error(`temporary account must be an active test-project admin; profile HTTP ${profile.status}`);
    }
    const before = await request(groupPath(label, vendor), { token });
    if (before.status !== 200 || before.data?.length !== 0) {
      throw new Error(`preflight expected zero fixture groups, got HTTP ${before.status} / ${before.data?.length ?? 'unknown'} rows`);
    }
    const invalid = await request('/functions/v1/shipments', {
      method: 'POST', token,
      body: { vendor_name: vendor, item_name: '', intake_group_label: label },
    });
    if (invalid.status !== 400 || invalid.data?.error !== 'vendor_name and item_name are required') {
      throw new Error(`invalid shipment expected HTTP 400 and required-fields error; got HTTP ${invalid.status} / ${JSON.stringify(invalid.data)}`);
    }
    const after = await request(groupPath(label, vendor), { token });
    if (after.status !== 200 || !Array.isArray(after.data)) {
      throw new Error(`group inspection expected HTTP 200, got ${after.status}`);
    }
    if (after.data.length !== 0) {
      throw new Error(`expected 0 intake groups after HTTP 400; actually found ${after.data.length}`);
    }
  } catch (error) {
    failure = error;
  } finally {
    if (token) {
      try {
        const remaining = await request(groupPath(label, vendor), { token });
        if (remaining.status !== 200 || !Array.isArray(remaining.data)) {
          throw new Error(`cannot inspect cleanup rows: HTTP ${remaining.status}`);
        }
        for (const row of remaining.data) {
          const deleted = await request(`/rest/v1/intake_groups?id=eq.${row.id}`, { method: 'DELETE', token });
          if (deleted.status !== 204) throw new Error(`could not remove test group ${row.id}: HTTP ${deleted.status}`);
        }
        const cleared = await request(groupPath(label, vendor), { token });
        if (cleared.status !== 200 || cleared.data?.length !== 0) {
          throw new Error('temporary group cleanup could not be verified');
        }
      } catch (error) {
        cleanupFailure = error;
      }
      try {
        const logout = await request('/auth/v1/logout?scope=global', { method: 'POST', token });
        if (logout.status !== 204) throw new Error(`temporary login could not be revoked: HTTP ${logout.status}`);
      } catch (error) {
        cleanupFailure = cleanupFailure ?? error;
      }
    }
  }
  if (failure || cleanupFailure) {
    if (failure) console.error(`T012 FAIL: ${failure.message}`);
    if (cleanupFailure) console.error(`T012 CLEANUP FAIL: ${cleanupFailure.message}`);
    process.exitCode = 1;
  } else {
    console.log('T012 PASS: invalid shipment returned HTTP 400 and left 0 intake groups; test session revoked');
  }
}

run().catch(error => {
  console.error(`T012 FAIL: ${error.message}`);
  process.exitCode = 1;
});
