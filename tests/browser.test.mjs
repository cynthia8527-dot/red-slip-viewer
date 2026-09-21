import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const candidates = [process.env.TEST_BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
const browserPath = candidates.find(existsSync);
const stubClient = `export function createClient(){return {auth:{getSession:async()=>({data:{session:null}})}}}`;

test('T016 browser smoke: data pages load locally without any main or external data request', async () => {
  assert.ok(browserPath, 'No browser found; set TEST_BROWSER_PATH. Browser smoke is required, never skipped.');
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/config.local.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end("export default {supabaseUrl:'http://127.0.0.1:54321',supabaseKey:'test-only',storageBucket:'factory-photos-test'}");
      return;
    }
    const file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + '\\') && file !== root) { response.writeHead(403).end(); return; }
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
    assert.deepEqual(blocked, [], `Non-local request attempted: ${blocked.join(', ')}`);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});
