import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// No URL or bucket override: this runner is restricted to the dedicated test project.
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
    throw new Error('Cloud shipment-photo tests require the dedicated test project; no request was sent');
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

async function request(path, { method = 'GET', token, body, image = false, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(image ? { 'Content-Type': 'image/png', 'x-upsert': 'false' } : body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(image ? { body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlX4a4AAAAASUVORK5CYII=', 'base64') }
      : body ? { body: JSON.stringify(body) } : {}),
  });
  if (method === 'GET' && response.status === 200 && path.startsWith('/storage/v1/object/')) {
    await response.arrayBuffer();
    return { status: response.status, data: null };
  }
  const content = await response.text();
  let data;
  try { data = content ? JSON.parse(content) : null; } catch { data = content; }
  return { status: response.status, data };
}

const objectUrl = path => `/storage/v1/object/${bucket}/${path}`;
async function isPresent(path, token) {
  const result = await request(objectUrl(path), { token });
  if (![200, 404].includes(result.status)) throw new Error(`test photo inspection HTTP ${result.status}`);
  return result.status === 200;
}

async function run() {
  requireTestEnvironment();
  const vendor = `CODEX_SHIPMENT_PHOTO_${randomUUID().replaceAll('-', '')}`;
  const knownIds = new Set();
  let photoPath;
  let token;
  let passed = 0;
  let failure;
  const cleanupErrors = [];
  const shipmentRows = () => request(`/rest/v1/shipments?select=id,voided_at&vendor_name=eq.${vendor}`, { token });
  const photoRows = id => request(`/rest/v1/shipment_photos?select=id,storage_path&shipment_id=eq.${id}`, { token });
  const attach = (id, path) => request('/functions/v1/shipments', {
    method: 'POST', token, body: { action: 'attach_photo', id, storage_path: path },
  });
  const deleteShipment = id => request('/functions/v1/shipments', { method: 'DELETE', token, body: { id } });
  async function removeFixture(id) {
    const existing = await shipmentRows();
    if (existing.status !== 200 || !Array.isArray(existing.data)) throw new Error('cannot inspect temporary shipment cleanup');
    const row = existing.data.find(item => item.id === id);
    if (row && !row.voided_at) {
      const voided = await request('/functions/v1/shipments', { method: 'PATCH', token, body: { action: 'void', id } });
      if (voided.status !== 200 || !voided.data?.shipment?.voided_at) throw new Error(`cannot void temporary shipment: HTTP ${voided.status}`);
    }
    // DELETE may return 202 if Storage cleanup or its result recording needs a retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      const deleted = await deleteShipment(id);
      if (deleted.status === 200 && deleted.data?.cleanup_pending === false) return;
      if (deleted.status !== 202 || deleted.data?.cleanup_pending !== true) {
        throw new Error(`cannot finish temporary shipment deletion: HTTP ${deleted.status}`);
      }
    }
    throw new Error('temporary shipment photo cleanup remained pending after three attempts');
  }

  try {
    const login = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    if (login.status !== 200 || !login.data?.access_token || login.data.user?.email !== email) {
      throw new Error(`test-only login expected HTTP 200; got ${login.status}`);
    }
    token = login.data.access_token;
    const profile = await request(`/rest/v1/profiles?select=role,active&user_id=eq.${login.data.user.id}`, { token });
    if (profile.status !== 200 || profile.data?.length !== 1 || profile.data[0].role !== 'admin' || !profile.data[0].active) {
      throw new Error('test-only account must be an active admin');
    }
    const created = await request('/functions/v1/shipments', {
      method: 'POST', token, headers: { 'Idempotency-Key': randomUUID() },
      body: { vendor_name: vendor, item_name: 'Test shipment photo', location: '蘆洲' },
    });
    if (created.status !== 201 || created.data?.shipment?.vendor_name !== vendor) throw new Error(`test shipment creation HTTP ${created.status}`);
    const id = created.data.shipment.id;
    knownIds.add(id);
    photoPath = `shipments/${id}/${randomUUID()}.png`;
    const missing = await attach(id, photoPath);
    const before = await photoRows(id);
    if (missing.status !== 409 || missing.data?.error !== 'uploaded photo object not found' ||
        before.status !== 200 || before.data?.length !== 0 || await isPresent(photoPath, token)) {
      throw new Error(`missing object must not create a photo row: HTTP ${missing.status}`);
    }
    passed++;

    const uploaded = await request(objectUrl(photoPath), { method: 'POST', token, image: true });
    if (![200, 201].includes(uploaded.status) || !await isPresent(photoPath, token)) {
      throw new Error(`test photo upload HTTP ${uploaded.status}`);
    }
    const first = await attach(id, photoPath);
    const replay = await attach(id, photoPath); // Ignore first response when deciding to resend.
    const linked = await photoRows(id);
    if (first.status !== 201 || first.data?.replayed !== false ||
        replay.status !== 200 || replay.data?.replayed !== true ||
        linked.status !== 200 || linked.data?.length !== 1 || linked.data[0].storage_path !== photoPath ||
        !await isPresent(photoPath, token)) {
      throw new Error(`photo attach/replay must keep one row and object: ${first.status} / ${replay.status}`);
    }
    passed++;

    const wrong = await attach(id, `shipments/${randomUUID()}/wrong.png`);
    const stillLinked = await photoRows(id);
    if (wrong.status !== 400 || stillLinked.status !== 200 || stillLinked.data?.length !== 1 ||
        stillLinked.data[0].storage_path !== photoPath || !await isPresent(photoPath, token)) {
      throw new Error(`wrong shipment photo path should be rejected: HTTP ${wrong.status}`);
    }
    passed++;

    await removeFixture(id);
    const afterShipment = await shipmentRows();
    const afterPhotos = await photoRows(id);
    if (afterShipment.status !== 200 || afterShipment.data?.length !== 0 ||
        afterPhotos.status !== 200 || afterPhotos.data?.length !== 0 || await isPresent(photoPath, token)) {
      throw new Error('permanent deletion left a shipment, photo row, or test object');
    }
    passed++;
  } catch (error) { failure = error; }
  finally {
    if (token) {
      try {
        const rows = await shipmentRows();
        if (rows.status !== 200 || !Array.isArray(rows.data)) throw new Error('cannot find shipment fixtures for cleanup');
        for (const row of rows.data) knownIds.add(row.id);
        for (const id of knownIds) await removeFixture(id);
        const remaining = await shipmentRows();
        if (remaining.status !== 200 || remaining.data?.length !== 0) throw new Error('shipment fixture cleanup not verified');
        for (const id of knownIds) {
          const photos = await photoRows(id);
          if (photos.status !== 200 || photos.data?.length !== 0) throw new Error('shipment photo row cleanup not verified');
        }
        if (photoPath && await isPresent(photoPath, token)) {
          // Only remove this exact random path after its shipment/photo rows are gone.
          const removed = await request(`/storage/v1/object/${bucket}`, { method: 'DELETE', token, body: { prefixes: [photoPath] } });
          if (removed.status !== 200 || await isPresent(photoPath, token)) throw new Error('test object cleanup not verified');
        }
      } catch (error) { cleanupErrors.push(error); }
      try {
        const logout = await request('/auth/v1/logout?scope=global', { method: 'POST', token });
        if (logout.status !== 204) throw new Error(`test session revoke HTTP ${logout.status}`);
      } catch (error) { cleanupErrors.push(error); }
    }
  }
  if (failure || cleanupErrors.length) {
    if (failure) console.error(`T021/T030 FAIL: ${failure.message}`);
    for (const error of cleanupErrors) console.error(`T021/T030 CLEANUP FAIL: ${error.message}`);
    console.error(`CLOUD SHIPMENT PHOTO TEST FAIL: passed=${passed}, failed=${Number(Boolean(failure)) + cleanupErrors.length}, skipped=0`);
    process.exitCode = 1;
  } else console.log(`CLOUD SHIPMENT PHOTO TEST PASS: passed=${passed}, failed=0, skipped=0; fixture shipment/photos/objects removed; session revoked`);
}

run().catch(error => {
  console.error(`T021/T030 FAIL: ${error.message}`);
  console.error('CLOUD SHIPMENT PHOTO TEST FAIL: passed=0, failed=1, skipped=0; no cloud request was sent');
  process.exitCode = 1;
});
