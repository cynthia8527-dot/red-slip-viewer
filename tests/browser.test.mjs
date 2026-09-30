import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const candidates = [process.env.TEST_BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean);
const browserPath = candidates.find(existsSync);
const stubClient = `export function createClient(){return {auth:{getSession:async()=>({data:{session:null}})}}}`;

test('T016/T017/T021/T031 browser smoke: isolated pages and timeout retries', async () => {
  assert.ok(browserPath, 'No browser found; set TEST_BROWSER_PATH. Browser smoke is required, never skipped.');
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/config.local.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end("export default {supabaseUrl:'http://127.0.0.1:54321',supabaseKey:'test-only',storageBucket:'factory-photos-test'}");
      return;
    }
    const file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep) && file !== root) { response.writeHead(403).end(); return; }
    try {
      await access(file);
      response.writeHead(200, { 'content-type': extname(file) === '.js' ? 'text/javascript' : 'text/html' });
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true });
    const context = await browser.newContext();
    const blocked = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'esm.sh') return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: stubClient });
      if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
      blocked.push(url.href);
      return route.abort();
    });
    for (const pageName of ['board', 'calculator', 'dispatch', 'vendors']) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const response = await page.goto(`http://127.0.0.1:${port}/${pageName}/index.html`);
      assert.equal(response.status(), 200, `${pageName} did not load`);
      await page.waitForTimeout(150);
      assert.equal(errors.length, 0, `${pageName} browser errors: ${errors.join('; ')}`);
      assert.equal(await page.locator('#authGate').count(), 1, `${pageName} auth gate missing`);
      await page.close();
    }
    // Simulate an authenticated reload after the original photo attachment timed out.
    // All HTTP traffic, including Supabase API calls, is intercepted in this browser.
    const staffClient = `export function createClient(){const rows={products:[],vendor_prices:[],vendors:[]};return {
      auth:{getSession:async()=>({data:{session:{user:{id:'staff-a',email:'test@example.invalid'},access_token:'offline-token'}}})},
      from(table){const query={select:()=>query,eq:()=>query,order:async()=>({data:rows[table]||[],error:null}),
        maybeSingle:async()=>({data:{display_name:'測試員工',role:'staff',active:true},error:null})};return query}
    }}`;
    const replayContext = await browser.newContext();
    let attempts = 0;
    const replayErrors = [];
    await replayContext.addInitScript(() => sessionStorage.setItem('factory-board:pending-shipment-photos', JSON.stringify([{
      userId: 'staff-a', shipmentId: 'shipment-a', path: 'shipments/shipment-a/photo.jpg', createdAt: Date.now(),
    }])));
    await replayContext.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'esm.sh') return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: staffClient });
      if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
      if (url.hostname === '127.0.0.1' && url.port === '54321' && url.pathname === '/functions/v1/shipments') {
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', headers, body: '{"shipments":[]}' });
        assert.equal(route.request().method(), 'POST');
        assert.deepEqual(route.request().postDataJSON(), { action: 'attach_photo', id: 'shipment-a', storage_path: 'shipments/shipment-a/photo.jpg' });
        attempts++;
        if (attempts <= 2) return route.abort('failed');
        return route.fulfill({ status: 200, contentType: 'application/json', headers, body: '{"replayed":true}' });
      }
      blocked.push(url.href);
      return route.abort();
    });
    const replayPage = await replayContext.newPage();
    replayPage.on('pageerror', error => replayErrors.push(error.message));
    const boardUrl = `http://127.0.0.1:${port}/board/index.html`;
    await replayPage.goto(boardUrl);
    await replayPage.waitForFunction(() => document.querySelector('#syncText').textContent.includes('仍待處理'));
    assert.equal(attempts, 2, 'uncertain response should retry the same path once');
    await replayPage.reload();
    await replayPage.waitForFunction(() => document.querySelector('#syncText').textContent.includes('1 張照片已補關聯'));
    assert.equal(attempts, 3, 'reload should replay one original attachment');
    assert.equal(await replayPage.evaluate(() => sessionStorage.getItem('factory-board:pending-shipment-photos')), null);
    assert.deepEqual(replayErrors, []);
    await replayContext.close();

    // The first shipment POST commits on the mock server, but its response is lost.
    // Cover both an immediate retry and a retry after reload with the same form.
    for (const reloadBeforeRetry of [false, true]) {
      const createContext = await browser.newContext();
      const createErrors = [], alerts = [], requests = [];
      const shipment = { id: 'shipment-retry', vendor_name: 'Test vendor', item_name: 'Test item', location: '蘆洲', status: '未開始', urgent: false, is_demo: false };
      await createContext.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'esm.sh') return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: staffClient });
        if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
        if (url.hostname === '127.0.0.1' && url.port === '54321' && url.pathname === '/functions/v1/shipments') {
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,idempotency-key', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ shipments: requests.length ? [shipment] : [] }) });
          assert.equal(route.request().method(), 'POST');
          requests.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
          if (requests.length === 1) return route.abort('failed');
          return route.fulfill({ status: 201, contentType: 'application/json', headers, body: JSON.stringify({ shipment, replayed: true }) });
        }
        blocked.push(url.href);
        return route.abort();
      });
      const createPage = await createContext.newPage();
      createPage.on('pageerror', error => createErrors.push(error.message));
      createPage.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
      await createPage.goto(boardUrl);
      await createPage.locator('#appMain').waitFor({ state: 'visible' });
      await createPage.locator('#toggleForm').click();
      await createPage.locator('#fVendor').fill('Test vendor');
      await createPage.locator('#fItem').fill('Test item');
      await createPage.locator('#addTask').click();
      await createPage.waitForFunction(() => document.querySelector('#addTask').disabled === false && sessionStorage.getItem('factory-board:pending-shipment-create'));
      assert.match(alerts.join(' '), /新增失敗/);
      const pending = await createPage.evaluate(() => JSON.parse(sessionStorage.getItem('factory-board:pending-shipment-create')));
      assert.equal(requests.length, 1);
      assert.equal(requests[0].key, pending.key);
      if (reloadBeforeRetry) {
        await createPage.reload();
        await createPage.locator('#appMain').waitFor({ state: 'visible' });
        assert.equal(requests.length, 1, 'reload must not post the shipment again');
        assert.equal(await createPage.evaluate(() => JSON.parse(sessionStorage.getItem('factory-board:pending-shipment-create')).key), pending.key);
        await createPage.locator('#toggleForm').click();
        await createPage.locator('#fVendor').fill('Test vendor');
        await createPage.locator('#fItem').fill('Test item');
      }
      await createPage.locator('#addTask').click();
      await createPage.waitForFunction(() => document.querySelector('#syncText').textContent.includes('剛剛已同步'));
      assert.equal(requests.length, 2);
      assert.equal(requests[1].key, requests[0].key);
      assert.equal(requests[1].body, requests[0].body);
      assert.equal(await createPage.evaluate(() => sessionStorage.getItem('factory-board:pending-shipment-create')), null);
      assert.equal(await createPage.locator('#cActive').innerText(), '1');
      assert.deepEqual(createErrors, []);
      await createContext.close();
    }
    // The RPC commits both records before its first response is lost.
    // Exercise the real quick-product form with immediate and reload retries.
    const adminClient = `export function createClient(){return {
      auth:{getSession:async()=>({data:{session:{user:{id:'admin-a'},access_token:'offline-token'}}})},
      from(table){const query={select:()=>query,eq:()=>query,
        order:async()=>({data:await (await fetch('http://127.0.0.1:54321/rest/v1/'+table)).json(),error:null}),
        maybeSingle:async()=>({data:{display_name:'測試管理員',role:'admin',active:true},error:null})};return query},
      async rpc(name,body){try{return {data:await (await fetch('http://127.0.0.1:54321/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json(),error:null}}catch(error){return {data:null,error}}}
    }}`;
    for (const reloadBeforeRetry of [false, true]) {
      const productContext = await browser.newContext();
      const productErrors = [], productAlerts = [], productRequests = [];
      const product = { id: 'product-retry', name: 'Test product', is_active: true, material: 'SK5', standard_process: '研磨' };
      const rows = { vendors: [{ id: 'vendor-a', short_name: 'Test vendor', is_active: true }], products: [], vendor_prices: [] };
      await productContext.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'esm.sh') return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: adminClient });
        if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();
        if (url.hostname === '127.0.0.1' && url.port === '54321') {
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          const reply = data => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(data) });
          if (url.pathname === '/functions/v1/shipments' && route.request().method() === 'GET') return reply({ shipments: [] });
          if (url.pathname === '/rest/v1/rpc/create_product_with_initial_price_idempotent' && route.request().method() === 'POST') {
            productRequests.push(route.request().postDataJSON());
            if (productRequests.length === 1) {
              rows.products.push(product);
              rows.vendor_prices.push({ id: 'price-retry', product_id: product.id, vendor_name: 'Test vendor', unit_price: 70, effective_date: '2000-01-01', unit: 'kg' });
              return route.abort('failed');
            }
            assert.deepEqual(productRequests[1], productRequests[0]);
            return reply({ product, replayed: true });
          }
          const table = url.pathname.replace('/rest/v1/', '');
          if (route.request().method() === 'GET' && Object.hasOwn(rows, table)) return reply(rows[table]);
        }
        blocked.push(url.href);
        return route.abort();
      });
      const productPage = await productContext.newPage();
      productPage.on('pageerror', error => productErrors.push(error.message));
      productPage.on('dialog', async dialog => { productAlerts.push(dialog.message()); await dialog.accept(); });
      const fillProduct = async () => {
        await productPage.locator('#fVendor').fill('Test vendor');
        await productPage.locator('#quickProduct').click();
        await productPage.locator('#qName').fill('Test product');
        await productPage.locator('#qPrice').fill('70');
        await productPage.locator('#qMaterial').fill('SK5');
        await productPage.locator('#qProcess').fill('研磨');
      };
      await productPage.goto(boardUrl);
      await productPage.locator('#appMain').waitFor({ state: 'visible' });
      await productPage.locator('#toggleForm').click();
      await fillProduct();
      await productPage.locator('#qSave').click();
      await productPage.waitForFunction(() => !document.querySelector('#quickModal').classList.contains('saving') && sessionStorage.getItem('factory-board:pending-quick-product-create'));
      assert.match(productAlerts.join(' '), /建立商品失敗/);
      const pending = await productPage.evaluate(() => JSON.parse(sessionStorage.getItem('factory-board:pending-quick-product-create')));
      assert.equal(productRequests.length, 1);
      assert.equal(productRequests[0].p_request_id, pending.key);
      if (reloadBeforeRetry) {
        await productPage.reload();
        await productPage.locator('#appMain').waitFor({ state: 'visible' });
        assert.equal(productRequests.length, 1, 'reload must not create another product');
        await productPage.locator('#toggleForm').click();
        await fillProduct();
      }
      await productPage.locator('#qSave').click();
      await productPage.waitForFunction(() => document.querySelector('#syncText').textContent.includes('新商品已建立'));
      assert.equal(productRequests.length, 2);
      assert.deepEqual(productRequests[1], productRequests[0]);
      assert.equal(rows.products.length, 1);
      assert.equal(rows.vendor_prices.length, 1);
      assert.equal(await productPage.locator('#fProduct').inputValue(), product.id);
      assert.equal(await productPage.locator('#fProduct option[value="product-retry"]').count(), 1);
      assert.equal(await productPage.evaluate(() => sessionStorage.getItem('factory-board:pending-quick-product-create')), null);
      assert.deepEqual(productErrors, []);
      await productContext.close();
    }
    assert.deepEqual(blocked, [], `Non-local request attempted: ${blocked.join(', ')}`);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});
