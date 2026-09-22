import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('T014 all data pages load shared environment config', () => {
  for (const page of ['board', 'calculator', 'dispatch', 'vendors']) {
    const html = readFileSync(new URL(`../${page}/index.html`, import.meta.url), 'utf8');
    assert.match(html, /from '\.\.\/config\.js'/, `${page} missing config import`);
    assert.doesNotMatch(html, /icqdmzndjmxffnlciijs/, `${page} embeds main project ID`);
  }
});

test('T015 static smoke: entry pages and data module still exist', () => {
  for (const page of ['index.html', 'board/index.html', 'calculator/index.html', 'dispatch/index.html', 'vendors/index.html']) {
    assert.match(readFileSync(new URL(`../${page}`, import.meta.url), 'utf8'), /<html/i, `${page} is not HTML`);
  }
  assert.match(readFileSync(new URL('../data/pricing.js', import.meta.url), 'utf8'), /export function priceIsEffective/);
});

test('T012 quick product uses one atomic product-and-price request', () => {
  const html = readFileSync(new URL('../board/index.html', import.meta.url), 'utf8');
  const quickSave = html.split("$('qSave').onclick=async()=>{")[1]?.split("$('fVendor').oninput=")[0];
  assert.ok(quickSave, 'quick product handler is missing');
  assert.match(quickSave, /supabaseClient\.rpc\('create_product_with_initial_price'/);
  assert.doesNotMatch(quickSave, /\.from\('products'\)\.insert|\.from\('vendor_prices'\)\.insert|\.from\('products'\)\.delete/);
});

test('T023 CI runs offline suite without cloud credentials', () => {
  const workflow = readFileSync(new URL('../.github/workflows/offline-tests.yml', import.meta.url), 'utf8');
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /run: pnpm test/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\.|SUPABASE_URL|DATABASE_URL|icqdmzndjmxffnlciijs/);
});
