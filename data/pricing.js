// Shared, side-effect-free rules used by both price screens and offline tests.
export function priceIsEffective(row, date) {
  const from = row.effective_date || '0000-01-01';
  const to = row.end_date || '9999-12-31';
  return from <= date && date <= to;
}

export function selectCurrentPrices(prices, date) {
  const selected = new Map();
  for (const row of prices) {
    if (!priceIsEffective(row, date)) continue;
    const key = (row.vendor_id || `name:${row.vendor_name}`) + '|' + row.product_id;
    const previous = selected.get(key);
    if (!previous || String(row.effective_date || '').localeCompare(String(previous.effective_date || '')) > 0) selected.set(key, row);
  }
  return [...selected.values()];
}

export function priceHistory(prices, current) {
  return prices.filter(row => row.product_id === current.product_id &&
    (current.vendor_id ? (row.vendor_id === current.vendor_id || (!row.vendor_id && row.vendor_name === current.vendor_name))
      : (!row.vendor_id && row.vendor_name === current.vendor_name)))
    .sort((a, b) => String(b.effective_date || '').localeCompare(String(a.effective_date || '')) ||
      String(b.created_at || '').localeCompare(String(a.created_at || '')));
}
