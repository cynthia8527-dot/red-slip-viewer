// Display ordering never changes UUID identity or cursor pagination.
const natural=new Intl.Collator('zh-Hant',{numeric:true});
export function compareVendors(a,b){
 return Number(!a.code)-Number(!b.code)||natural.compare(String(a.code||''),String(b.code||''))||natural.compare(a.short_name||a.name||'',b.short_name||b.name||'')||String(a.id||'').localeCompare(String(b.id||''));
}
