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

test('T012/T031 quick product uses one atomic idempotent product-and-price request', () => {
  const html = readFileSync(new URL('../board/index.html', import.meta.url), 'utf8');
  const quickSave = html.split("$('qSave').onclick=async()=>{")[1]?.split("$('fVendor').oninput=")[0];
  assert.ok(quickSave, 'quick product handler is missing');
  assert.match(quickSave, /supabaseClient\.rpc\('create_product_with_initial_price_idempotent'/);
  assert.match(html, /PENDING_QUICK_PRODUCT_CREATE/);
  assert.match(html, /sessionStorage\.setItem\(PENDING_QUICK_PRODUCT_CREATE/);
  assert.match(quickSave, /p_request_id:request\.key/);
  assert.match(quickSave, /clearQuickProductCreateRequest\(request\.key\)/);
  assert.doesNotMatch(quickSave, /\.from\('products'\)\.insert|\.from\('vendor_prices'\)\.insert|\.from\('products'\)\.delete/);
});

test('T012/T031 calculator product creation is atomic, retry-safe, and preserves price details', () => {
  const html = readFileSync(new URL('../calculator/index.html', import.meta.url), 'utf8');
  const save = html.split('async function saveProduct(){')[1]?.split('function availableProductsForVendor')[0];
  assert.ok(save, 'calculator product handler is missing');
  assert.match(html, /PENDING_CALCULATOR_PRODUCT_CREATE/);
  assert.match(html, /sessionStorage\.setItem\(PENDING_CALCULATOR_PRODUCT_CREATE/);
  assert.match(save, /supabase\.rpc\('create_product_with_initial_price_idempotent'/);
  assert.match(save, /p_vendor_process:\$\('npVendorProcess'\)/);
  assert.match(save, /p_price_note:\$\('npPriceNote'\)/);
  assert.match(save, /clearCalculatorProductCreateRequest\(request\.key\)/);
  assert.doesNotMatch(save, /\.from\('products'\)\.insert|\.from\('vendor_prices'\)\.insert/);
  assert.match(save, /商品與價格已建立，不要再按新增/);
  assert.match(html, /PRODUCT_PHOTO_API/);
  assert.match(html, /async function attachProductPhoto/);
  assert.match(save, /await attachProductPhoto\(product\.id,path,previousPath\)/);
  assert.doesNotMatch(save, /update\(\{reference_photo_path:path\}\)/);
});

test('T017 shipment create keeps one request key across an uncertain retry', () => {
  const board = readFileSync(new URL('../board/index.html', import.meta.url), 'utf8');
  assert.match(board, /PENDING_SHIPMENT_CREATE/);
  assert.match(board, /sessionStorage\.setItem\(PENDING_SHIPMENT_CREATE/);
  assert.match(board, /'Idempotency-Key':request\.key/);
  assert.match(board, /clearShipmentCreateRequest\(request\.key\)/);
});

test('T021 shipment success is not reported as a failed create when photo upload fails', () => {
  const board = readFileSync(new URL('../board/index.html', import.meta.url), 'utf8');
  const createHandler = board.split("$('addTask').onclick=async()=>{")[1]?.split('setInterval(')[0];
  assert.ok(createHandler, 'shipment create handler is missing');
  assert.match(createHandler, /if\(!tasks\.some\(x=>x\.id===d\.shipment\.id\)\)/);
  assert.match(createHandler, /catch\(e\)\{photoError=e\}/);
  assert.match(createHandler, /貨件已建立，不要再按新增/);
  assert.match(createHandler, /resetShipmentCreateForm\(\)/);
});

test('T021 shipment photo metadata uses the cleanup-aware Edge endpoint', () => {
  const board = readFileSync(new URL('../board/index.html', import.meta.url), 'utf8');
  const upload = board.split('async function uploadShipmentPhotos(')[1]?.split('async function loadShipmentPhotos(')[0];
  const attach = board.split('async function attachShipmentPhoto(')[1]?.split('async function uploadShipmentPhotos(')[0];
  assert.ok(upload, 'shipment photo upload helper is missing');
  assert.ok(attach, 'shipment photo attach helper is missing');
  assert.match(attach, /action:'attach_photo'/);
  assert.match(attach, /storage_path:path/);
  assert.match(attach, /for\(let attempt=0;attempt<2;attempt\+\+\)/);
  assert.match(attach, /AbortSignal\.timeout\(15000\)/);
  assert.match(upload, /await attachShipmentPhoto\(shipmentId,path\)/);
  assert.doesNotMatch(upload, /from\('shipment_photos'\)\.insert/);
});

test('T023 CI runs offline suite without cloud credentials', () => {
  const workflow = readFileSync(new URL('../.github/workflows/offline-tests.yml', import.meta.url), 'utf8');
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /run: pnpm test/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\.|SUPABASE_URL|DATABASE_URL|icqdmzndjmxffnlciijs/);
});
