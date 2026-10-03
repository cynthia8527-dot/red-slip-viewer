// Preserve the legacy workbook mapping; write the normalized rows in one database transaction.
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim() || null;
export function vendorImportRows(mainRows, mailRows = []) {
  const mail = new Map();
  for (const r of mailRows.slice(1)) {
    const code = clean(r[0]), title = clean(r[1]), address = clean(r[2]);
    if (address) { if (code) mail.set('c:' + code, address); if (title) mail.set('t:' + title, address); }
  }
  const rows = mainRows.slice(1).filter(r => clean(r[0]) && clean(r[1])).map(r => {
    const code = clean(r[0]), invoice = clean(r[2]);
    const source = [clean(r[11]), clean(r[12])].filter(Boolean).join('｜') || null;
    return {code, short_name:clean(r[1]), invoice_title:invoice, billing_mode:clean(r[3]), tax_id:clean(r[4]),
      contact_name:clean(r[5]), phone:clean(r[6]), fax:clean(r[7]), address:clean(r[8]), email:clean(r[9]),
      billing_address:mail.get('c:' + code) || mail.get('t:' + invoice) || null, note:clean(r[10]), source_note:source,
      site_note:[clean(r[10]),clean(r[12])].filter(Boolean).join('｜') || null,
      is_active:!/很久沒交易|結束營業|沒來/.test([invoice,clean(r[5]),clean(r[10]),source].filter(Boolean).join(' '))};
  });
  if (!rows.length) throw new Error('沒有可匯入的廠商列（需要代碼與簡稱）');
  if (rows.length > 5000 || new TextEncoder().encode(JSON.stringify(rows)).length > 2000000)
    throw new Error('單次匯入上限為 5,000 筆、2 MB 文字資料，請先拆分 Excel');
  return rows;
}
