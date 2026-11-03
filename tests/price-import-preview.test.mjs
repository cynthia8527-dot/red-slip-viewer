import test from 'node:test';
import assert from 'node:assert/strict';
import {priceImportPreview,priceColumns} from '../data/price-import-preview.js';
const vendors=[{id:'uuid-a',code:'292',short_name:'合成甲'},{id:'uuid-b',code:'292',short_name:'合成乙'}];
const source=['292','合成甲','加工',' 產品原文／規格 ',null,'原表未註單位',null,'單批底價未載，原文保留','待確認','停用','需核對','合成表!A2','原左','原右','source-001'];
test('price preview preserves null, raw unit, minimum, conditions, inactive history and source ID without writing',()=>{
 const input=[priceColumns,source];const before=structuredClone(input),masters=structuredClone(vendors);const p=priceImportPreview(input,vendors)[0];
 assert.equal(p.vendor_id,'uuid-a');assert.equal(p.source.unit_price,null);assert.equal(p.source.minimum_charge,null);assert.equal(p.source.unit,'原表未註單位');assert.equal(p.source.product_text,' 產品原文／規格 ');assert.equal(p.source.active_status,'停用');assert.equal(p.source.source_record_id,'source-001');assert.equal(p.source.conditions,'單批底價未載，原文保留');assert.equal(p.effective_date,null);
 assert.ok(p.blockers.includes('單價未確認'));assert.ok(p.blockers.includes('單位未確認'));assert.ok(p.blockers.includes('生效日未確認（收到日不能代用）'));assert.deepEqual(input,before);assert.deepEqual(vendors,masters);
});
test('same code different companies and similar names stay separate; ambiguity never chooses a UUID',()=>{
 const masters=[...vendors,{id:'uuid-c',code:'295',short_name:'合成山河電機'},{id:'uuid-d',code:'285',short_name:'合成山河'}];
 const sources=[priceColumns,['292','合成甲'],['292','合成乙'],['295','合成山河電機'],['285','合成山河'],['292','陌生公司'],[null,'合成甲']];
 const p=priceImportPreview(sources,masters);
 assert.deepEqual(p.map(p=>p.vendor_id),['uuid-a','uuid-b','uuid-c','uuid-d',null,null]);assert.deepEqual(p[4].candidates.map(v=>v.id),['uuid-a','uuid-b']);
 const ambiguous=priceImportPreview([priceColumns,['292','合成甲']],[...masters,{id:'duplicate',code:'292',short_name:'合成甲'}])[0];assert.equal(ambiguous.vendor_id,null);assert.match(ambiguous.blockers.join(' '),/多筆廠商符合/);
});
test('all rows including active and disabled histories survive; no sheet order defines effective dates',()=>{
 const p=priceImportPreview([priceColumns,['2','合成甲',null,'歷史品',12,'公斤',300,'每批原文','歷史','停用',null,'source-old',null,null,'id-old'],['2','合成甲',null,'現行品',50,'桶',null,null,'使用中','使用中',null,'source-new',null,null,'id-new']],[{id:'uuid-a',code:'2',short_name:'合成甲'}]);
 assert.equal(p.length,2);assert.equal(p[0].source.minimum_charge,300);assert.equal(p[1].source.minimum_charge,null);assert.deepEqual(p.map(p=>p.effective_date),[null,null]);assert.match(p[1].blockers.join(' '),/公斤計價/);assert.throws(()=>priceImportPreview([['wrong']],vendors),/A–O/);
});
test('preview source row numbers include intervening blank spreadsheet rows',()=>{
 const p=priceImportPreview([priceColumns,[],source],vendors);assert.equal(p[0].row,3);
});
