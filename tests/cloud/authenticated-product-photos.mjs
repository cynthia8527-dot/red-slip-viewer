import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// This command has no project or bucket URL override. Never use production data.
const projectId = 'zfcsuxihpakrsohvcwlr';
const baseUrl = `https://${projectId}.supabase.co`;
const bucket = 'factory-photos-test';
const credentialFile = new URL('./credentials.local.json', import.meta.url);
const local = existsSync(credentialFile) ? JSON.parse(readFileSync(credentialFile, 'utf8')) : {};
const key = process.env.TEST_CLOUD_PUBLISHABLE_KEY || local.publishableKey;
const email = process.env.TEST_CLOUD_EMAIL || local.email;
let password = process.env.TEST_CLOUD_PASSWORD;

function requireTestEnvironment() {
  if ((process.env.TEST_CLOUD_PROJECT_ID || local.projectId) !== projectId) {
    throw new Error('Cloud photo tests require the dedicated test project; no request was sent');
  }
  if (!password && local.encryptedPassword && process.platform === 'win32') {
    const decrypt = "$secret = ConvertTo-SecureString ([Console]::In.ReadToEnd()); [System.Net.NetworkCredential]::new('', $secret).Password";
    password = execFileSync('pwsh', ['-NoProfile', '-Command', decrypt], {
      input: local.encryptedPassword, encoding: 'utf8', windowsHide: true,
    }).trimEnd();
  }
  if (!key || !email || !password || !/^codex-[a-z0-9-]+@example\.invalid$/i.test(email)) {
    throw new Error('A test-only publishable key, codex-*@example.invalid account and password are required; no request was sent');
  }
}

async function request(path, { method = 'GET', token, body, image = false } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(image ? { 'Content-Type': 'image/png', 'x-upsert': 'false' } : body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(image ? { body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlX4a4AAAAASUVORK5CYII=', 'base64') }
      : body ? { body: JSON.stringify(body) } : {}),
  });
  const content = response.status === 200 && path.startsWith('/storage/v1/object/') && method === 'GET'
    ? null : await response.text();
  let data = null;
  try { data = content ? JSON.parse(content) : null; } catch { data = content; }
  if (content === null) await response.arrayBuffer();
  return { status: response.status, data };
}

function objectUrl(path) { return `/storage/v1/object/${bucket}/${path}`; }
async function isPresent(path, token) {
  const result = await request(objectUrl(path), { token });
  if (![200, 404].includes(result.status)) throw new Error(`photo inspection HTTP ${result.status}`);
  return result.status === 200;
}

async function run() {
  requireTestEnvironment();
  const name = `CODEX_PHOTO_${randomUUID().replaceAll('-', '')}`;
  const paths = [];
  let token;
  let id;
  let passed = 0;
  let failure;
  const cleanupErrors = [];
  try {
    const login = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    if (login.status !== 200 || !login.data?.access_token || login.data.user?.email !== email) {
      throw new Error(`test-only login expected HTTP 200; got ${login.status}`);
    }
    token = login.data.access_token;
    const profile = await request(`/rest/v1/profiles?select=role,active&user_id=eq.${login.data.user.id}`, { token });
    if (profile.status !== 200 || profile.data?.length !== 1 || profile.data[0].role !== 'admin' || !profile.data[0].active) {
      throw new Error('test account must be an active admin');
    }
    const created = await request('/rest/v1/products?select=id,name,reference_photo_path', {
      method: 'POST', token, body: { name },
    });
    // PostgREST returns a representation only when Prefer: return=representation is supplied.
    // Query by the unique random fixture name so cleanup still finds the row if this response is lost.
    if (![201, 204].includes(created.status)) throw new Error(`test product creation HTTP ${created.status}`);
    const rows = await request(`/rest/v1/products?select=id,reference_photo_path&name=eq.${name}`, { token });
    if (rows.status !== 200 || rows.data?.length !== 1 || rows.data[0].reference_photo_path !== null) {
      throw new Error('expected one clean test product');
    }
    id = rows.data[0].id;
    const first = `products/${id}/${randomUUID()}.png`;
    const second = `products/${id}/${randomUUID()}.png`;
    const rejected = `products/${id}/${randomUUID()}.png`;
    paths.push(first, second, rejected);
    async function upload(path) {
      const result = await request(objectUrl(path), { method: 'POST', token, image: true });
      if (result.status !== 200 && result.status !== 201) throw new Error(`test photo upload HTTP ${result.status}`);
      if (!await isPresent(path, token)) throw new Error('uploaded test photo is not readable');
    }
    async function attach(path, previousPath) {
      return request('/functions/v1/product-photos', {
        method: 'POST', token,
        body: { id, storage_path: path, previous_storage_path: previousPath },
      });
    }
    async function currentPath() {
      const result = await request(`/rest/v1/products?select=reference_photo_path&id=eq.${id}`, { token });
      if (result.status !== 200 || result.data?.length !== 1) throw new Error('test product lookup failed');
      return result.data[0].reference_photo_path;
    }

    await upload(first);
    const initial = await attach(first, null);
    const replay = await attach(first, null); // First response is intentionally ignored when choosing the retry.
    if (initial.status !== 201 || initial.data?.replayed !== false ||
        replay.status !== 200 || replay.data?.replayed !== true ||
        await currentPath() !== first || !await isPresent(first, token)) {
      throw new Error(`photo attach/replay mismatch: ${initial.status} / ${replay.status}`);
    }
    passed++;

    await upload(second);
    const replaced = await attach(second, first);
    if (replaced.status !== 201 || replaced.data?.previous_cleanup_pending !== false ||
        await currentPath() !== second || await isPresent(first, token) || !await isPresent(second, token)) {
      throw new Error(`photo replacement/old photo cleanup mismatch: HTTP ${replaced.status}`);
    }
    passed++;

    await upload(rejected);
    const conflict = await attach(rejected, first); // Stale previous path: must clean this new object.
    if (conflict.status !== 409 || await currentPath() !== second || await isPresent(rejected, token) ||
        !await isPresent(second, token)) {
      throw new Error(`stale photo link should fail and remove only new object: HTTP ${conflict.status}`);
    }
    passed++;
  } catch (error) {
    failure = error;
  } finally {
    if (token) {
      // Cleanup is limited to this run's random name and exact object paths.
      try {
        const found = await request(`/rest/v1/products?select=id&name=eq.${name}`, { token });
        if (found.status !== 200 || !Array.isArray(found.data)) throw new Error('cannot inspect test product cleanup');
        for (const row of found.data) {
          const deleted = await request(`/rest/v1/products?id=eq.${row.id}`, { method: 'DELETE', token });
          if (deleted.status !== 204) throw new Error(`cannot delete test product: HTTP ${deleted.status}`);
        }
        const remaining = await request(`/rest/v1/products?select=id&name=eq.${name}`, { token });
        if (remaining.status !== 200 || remaining.data?.length !== 0) throw new Error('test product cleanup not verified');
      } catch (error) { cleanupErrors.push(error); }
      for (const path of paths) {
        try {
          const removed = await request(`/storage/v1/object/${bucket}`, {
            method: 'DELETE', token, body: { prefixes: [path] },
          });
          if (removed.status !== 200 || await isPresent(path, token)) {
            throw new Error(`test image cleanup not verified: ${path}`);
          }
        } catch (error) { cleanupErrors.push(error); }
      }
      try {
        const logout = await request('/auth/v1/logout?scope=global', { method: 'POST', token });
        if (logout.status !== 204) throw new Error(`test session revoke HTTP ${logout.status}`);
      } catch (error) { cleanupErrors.push(error); }
    }
  }
  if (failure || cleanupErrors.length) {
    if (failure) console.error(`T032 FAIL: ${failure.message}`);
    for (const error of cleanupErrors) console.error(`T032 CLEANUP FAIL: ${error.message}`);
    console.error(`CLOUD PHOTO TEST FAIL: passed=${passed}, failed=${Number(Boolean(failure)) + cleanupErrors.length}, skipped=0`);
    process.exitCode = 1;
  } else {
    console.log(`CLOUD PHOTO TEST PASS: passed=${passed}, failed=0, skipped=0; fixture objects/product removed; session revoked`);
  }
}

run().catch(error => {
  console.error(`T032 FAIL: ${error.message}`);
  console.error('CLOUD PHOTO TEST FAIL: passed=0, failed=1, skipped=0; no cloud request was sent');
  process.exitCode = 1;
});
