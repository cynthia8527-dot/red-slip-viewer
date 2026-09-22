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

function shipmentPath(vendor) {
  const params = new URLSearchParams({ select: 'id', vendor_name: `eq.${vendor}` });
  return `/rest/v1/shipments?${params}`;
}

function productPath(name) {
  const params = new URLSearchParams({ select: 'id,name', name: `eq.${name}` });
  return `/rest/v1/products?${params}`;
}

async function run() {
  requireTestEnvironment();
  const suffix = randomUUID().replaceAll('-', '');
  const label = `CODEX_INVALID_${suffix}`;
  const vendor = `CODEX_TEST_${suffix}`;
  const validLabel = `CODEX_VALID_${suffix}`;
  const validVendor = `CODEX_VALID_${suffix}`;
  const patchLabel = `CODEX_PATCH_${suffix}`;
  const rollbackLabel = `CODEX_ROLLBACK_${suffix}`;
  const rollbackVendor = `CODEX_ROLLBACK_${suffix}`;
  const failedProductName = `CODEX_PRICE_FAIL_${suffix}`;
  const validProductName = `CODEX_PRICE_VALID_${suffix}`;
  const productNames = [failedProductName, validProductName];
  const fixtures = [{ label, vendor }, { label: validLabel, vendor: validVendor }, { label: patchLabel, vendor: validVendor }, { label: rollbackLabel, vendor: rollbackVendor }];
  let token;
  let failure;
  let cleanupFailure;
  let passed = 0;
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
    passed++;
    const valid = await request('/functions/v1/shipments', {
      method: 'POST', token,
      body: {
        vendor_name: validVendor, item_name: 'Atomic rollback test',
        intake_group_label: validLabel, location: '蘆洲',
      },
    });
    if (valid.status !== 201 || valid.data?.shipment?.vendor_name !== validVendor ||
        valid.data.shipment.intake_groups?.label !== validLabel) {
      throw new Error(`valid atomic shipment expected HTTP 201 with linked group; got HTTP ${valid.status} / ${JSON.stringify(valid.data)}`);
    }
    passed++;
    const failedInsert = await request('/functions/v1/shipments', {
      method: 'POST', token,
      body: {
        vendor_name: rollbackVendor, item_name: 'Atomic rollback test',
        intake_group_label: rollbackLabel, location: 'INVALID_TEST_LOCATION',
      },
    });
    if (failedInsert.status !== 500) {
      throw new Error(`invalid location expected HTTP 500; got HTTP ${failedInsert.status} / ${JSON.stringify(failedInsert.data)}`);
    }
    const rolledBackGroup = await request(groupPath(rollbackLabel, rollbackVendor), { token });
    const rolledBackShipment = await request(shipmentPath(rollbackVendor), { token });
    if (rolledBackGroup.status !== 200 || rolledBackShipment.status !== 200 ||
        rolledBackGroup.data?.length !== 0 || rolledBackShipment.data?.length !== 0) {
      throw new Error(`expected 0 groups and 0 shipments after failed insert; got ${rolledBackGroup.data?.length ?? 'unknown'} groups and ${rolledBackShipment.data?.length ?? 'unknown'} shipments`);
    }
    passed++;
    const invalidPatch = await request('/functions/v1/shipments', {
      method: 'PATCH', token,
      body: { id: valid.data.shipment.id, intake_group_label: patchLabel, location: 'INVALID_TEST_LOCATION' },
    });
    if (invalidPatch.status !== 500) {
      throw new Error(`invalid grouped PATCH expected HTTP 500; got HTTP ${invalidPatch.status} / ${JSON.stringify(invalidPatch.data)}`);
    }
    const patchGroup = await request(groupPath(patchLabel, validVendor), { token });
    const unchangedShipment = await request(`/rest/v1/shipments?select=id,intake_group_id,location&id=eq.${valid.data.shipment.id}`, { token });
    if (patchGroup.status !== 200 || patchGroup.data?.length !== 0 ||
        unchangedShipment.status !== 200 || unchangedShipment.data?.length !== 1 ||
        unchangedShipment.data[0].intake_group_id !== valid.data.shipment.intake_group_id ||
        unchangedShipment.data[0].location !== '蘆洲') {
      throw new Error(`failed PATCH should leave original shipment and no new group; got ${patchGroup.data?.length ?? 'unknown'} new groups / ${JSON.stringify(unchangedShipment.data)}`);
    }
    passed++;
    const validPatch = await request('/functions/v1/shipments', {
      method: 'PATCH', token,
      body: { id: valid.data.shipment.id, intake_group_label: patchLabel, note: 'Atomic PATCH test' },
    });
    if (validPatch.status !== 200 || validPatch.data?.shipment?.intake_groups?.label !== patchLabel ||
        validPatch.data.shipment.note !== 'Atomic PATCH test') {
      throw new Error(`valid grouped PATCH expected HTTP 200 and new linked group; got HTTP ${validPatch.status} / ${JSON.stringify(validPatch.data)}`);
    }
    passed++;
    const priceArgs = {
      p_material: null, p_standard_process: 'test process', p_process_notes: null,
      p_vendor_name: validVendor, p_unit_price: 50, p_minimum_charge: 70,
      p_unit: 'kg', p_effective_date: new Date().toISOString().slice(0, 10),
    };
    const invalidPrice = await request('/rest/v1/rpc/create_product_with_initial_price', {
      method: 'POST', token,
      body: { ...priceArgs, p_name: failedProductName, p_vendor_id: 'c0d00000-0000-4000-8000-000000000999' },
    });
    if (invalidPrice.status !== 409 || invalidPrice.data?.code !== '23503') {
      throw new Error(`invalid vendor FK expected HTTP 409 / 23503; got HTTP ${invalidPrice.status} / ${JSON.stringify(invalidPrice.data)}`);
    }
    const orphan = await request(productPath(failedProductName), { token });
    if (orphan.status !== 200 || orphan.data?.length !== 0) {
      throw new Error(`failed price insert must leave 0 products; found ${orphan.data?.length ?? 'unknown'}`);
    }
    passed++;
    const validProduct = await request('/rest/v1/rpc/create_product_with_initial_price', {
      method: 'POST', token,
      body: { ...priceArgs, p_name: validProductName, p_vendor_id: null },
    });
    if (validProduct.status !== 200 || validProduct.data?.name !== validProductName || !validProduct.data.id) {
      throw new Error(`valid quick product expected HTTP 200 and product ID; got HTTP ${validProduct.status} / ${JSON.stringify(validProduct.data)}`);
    }
    const linkedPrice = await request(`/rest/v1/vendor_prices?select=product_id,vendor_name,unit_price,minimum_charge&product_id=eq.${validProduct.data.id}`, { token });
    if (linkedPrice.status !== 200 || linkedPrice.data?.length !== 1 ||
        linkedPrice.data[0].vendor_name !== validVendor || Number(linkedPrice.data[0].unit_price) !== 50 ||
        Number(linkedPrice.data[0].minimum_charge) !== 70) {
      throw new Error(`quick product must have exactly one linked initial price; got ${JSON.stringify(linkedPrice.data)}`);
    }
    passed++;
  } catch (error) {
    failure = error;
  } finally {
    if (token) {
      try {
        for (const fixture of fixtures) {
          const shipments = await request(shipmentPath(fixture.vendor), { token });
          if (shipments.status !== 200 || !Array.isArray(shipments.data)) {
            throw new Error(`cannot inspect cleanup shipments: HTTP ${shipments.status}`);
          }
          for (const row of shipments.data) {
            const deleted = await request(`/rest/v1/shipments?id=eq.${row.id}`, { method: 'DELETE', token });
            if (deleted.status !== 204) throw new Error(`could not remove test shipment ${row.id}: HTTP ${deleted.status}`);
          }
          const remaining = await request(groupPath(fixture.label, fixture.vendor), { token });
          if (remaining.status !== 200 || !Array.isArray(remaining.data)) {
            throw new Error(`cannot inspect cleanup groups: HTTP ${remaining.status}`);
          }
          for (const row of remaining.data) {
            const deleted = await request(`/rest/v1/intake_groups?id=eq.${row.id}`, { method: 'DELETE', token });
            if (deleted.status !== 204) throw new Error(`could not remove test group ${row.id}: HTTP ${deleted.status}`);
          }
          const clearedGroups = await request(groupPath(fixture.label, fixture.vendor), { token });
          const clearedShipments = await request(shipmentPath(fixture.vendor), { token });
          if (clearedGroups.status !== 200 || clearedGroups.data?.length !== 0 ||
              clearedShipments.status !== 200 || clearedShipments.data?.length !== 0) {
            throw new Error('temporary shipment/group cleanup could not be verified');
          }
        }
      } catch (error) {
        cleanupFailure = error;
      }
      try {
        for (const name of productNames) {
          const products = await request(productPath(name), { token });
          if (products.status !== 200 || !Array.isArray(products.data)) {
            throw new Error(`cannot inspect cleanup products: HTTP ${products.status}`);
          }
          for (const product of products.data) {
            const deleted = await request(`/rest/v1/products?id=eq.${product.id}`, { method: 'DELETE', token });
            if (deleted.status !== 204) throw new Error(`could not remove test product ${product.id}: HTTP ${deleted.status}`);
            const prices = await request(`/rest/v1/vendor_prices?select=id&product_id=eq.${product.id}`, { token });
            if (prices.status !== 200 || prices.data?.length !== 0) {
              throw new Error(`test product ${product.id} left a price after cleanup`);
            }
          }
          const cleared = await request(productPath(name), { token });
          if (cleared.status !== 200 || cleared.data?.length !== 0) {
            throw new Error(`temporary product ${name} cleanup could not be verified`);
          }
        }
      } catch (error) {
        cleanupFailure = cleanupFailure ?? error;
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
    console.error(`CLOUD TEST FAIL: passed=${passed}, failed=${Number(Boolean(failure)) + Number(Boolean(cleanupFailure))}, skipped=0`);
    process.exitCode = 1;
  } else {
    console.log('T012 PASS: grouped shipments and quick products committed or rolled back together; test session revoked');
    console.log(`CLOUD TEST PASS: passed=${passed}, failed=0, skipped=0`);
  }
}

run().catch(error => {
  console.error(`T012 FAIL: ${error.message}`);
  process.exitCode = 1;
});
