// Read-only staging contract for the A–O 價格清單 worksheet. No DB payload is generated.
export const priceColumns=['公司編碼','公司','業務分類','產品／規格／加工','現行單價','單價單位','每批底價','價格條件與原文','價格狀態','啟用狀態','待確認問題','來源位置','原左欄','原右欄','紀錄ID'];
const keys=['code','name','category','product_text','unit_price','unit','minimum_charge','conditions','price_status','active_status','questions','source_location','raw_left','raw_right','source_record_id'];
const text=v=>String(v??'').trim();
export function priceImportPreview(sheet,vendors){
 if(!Array.isArray(sheet)||!Array.isArray(sheet[0])||priceColumns.some((c,i)=>sheet[0][i]!==c))throw new Error('價格清單 A–O 欄位不符，請先核對來源版本');
 if(sheet.length>5001)throw new Error('預覽上限 5000 列');
 return sheet.slice(1).map((row,index)=>({row,index})).filter(({row})=>row.some(v=>v!==null&&v!==undefined&&v!=='')).map(({row,index})=>{
  const source=Object.fromEntries(keys.map((k,i)=>[k,row[i]===undefined||row[i]===''?null:row[i]]));
  const exact=vendors.filter(v=>text(source.code)!==''&&text(v.code)===text(source.code)&&text(v.short_name)===text(source.name));
  const candidates=exact.length?exact:vendors.filter(v=>(text(source.code)!==''&&text(v.code)===text(source.code))||(text(source.name)!==''&&text(v.short_name)===text(source.name)));
  const blockers=[];
  if(exact.length!==1)blockers.push(exact.length>1?'多筆廠商符合，需人工核對':'廠商未完整匹配，需人工核對');
  if(typeof source.unit_price!=='number'||!Number.isFinite(source.unit_price)||source.unit_price<0||source.price_status!=='使用中')blockers.push('單價未確認');
  if(source.unit==='原表未註單位'||!source.unit)blockers.push('單位未確認');
  else if(!['kg','公斤'].includes(source.unit))blockers.push('單位與目前按公斤計價的貨件模型不相容');
  if(source.minimum_charge!==null&&(typeof source.minimum_charge!=='number'||!Number.isFinite(source.minimum_charge)||source.minimum_charge<0))blockers.push('每批底價格式需人工核對');
  if(source.questions)blockers.push('來源有待確認問題');
  if(source.active_status!=='使用中')blockers.push('保留停用／未確認歷史，不自動啟用');
  blockers.push('生效日未確認（收到日不能代用）','產品 UUID／歷史期間及最新正式資料尚未核對');
  return {row:index+2,source,vendor_id:exact.length===1?exact[0].id:null,candidates:candidates.map(v=>({id:v.id,code:v.code,name:v.short_name})),effective_date:null,blockers};
 });
}
