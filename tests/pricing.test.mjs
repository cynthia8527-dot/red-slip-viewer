import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { priceIsEffective, selectCurrentPrices, priceHistory } from '../data/pricing.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/data.json', import.meta.url)));

test('T005 historic and future prices do not replace the current date price', () => {
  const prices = fixture.prices;
  assert.equal(selectCurrentPrices(prices, '2026-08-01').find(row => row.vendor_id === 'vendor-a').unit_price, 70);
  assert.equal(selectCurrentPrices(prices, '2026-09-11').find(row => row.vendor_id === 'vendor-a').unit_price, 50);
  assert.equal(priceIsEffective(prices[0], '2026-09-11'), false);
});

test('T006 price history remains vendor/product scoped and keeps old values', () => {
  const history = priceHistory(fixture.prices, fixture.prices[1]);
  assert.deepEqual(history.map(row => row.id), ['price-now', 'price-old']);
  assert.equal(history[1].unit_price, 70);
  assert.equal(fixture.prices[2].unit_price, 90);
});

test('T007 same product at another vendor has its own current price', () => {
  const selected = selectCurrentPrices(fixture.prices, '2026-09-21');
  assert.equal(selected.length, 2);
  assert.equal(selected.find(row => row.vendor_id === 'vendor-b').unit_price, 90);
});
