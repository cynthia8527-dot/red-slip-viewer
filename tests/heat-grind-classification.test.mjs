import test from 'node:test';
import assert from 'node:assert/strict';
const customers=[{id:'synthetic-a',canonical_id:'S-A',code:'77',short_name:'合成甲'},{id:'synthetic-b',canonical_id:'S-B',code:'77',short_name:'合成乙'}];
const base={customer:{canonical_id:'S-A'},slip_id:'SYNTHETIC-001',weight_kg:'12.50',billing_unit:'公斤',item_text:'合成工件',amount:999};
const pair=()=>[{...base,source_id:'scan-line-a',origin_line_id:'original-line-a',unit_price:61},{...base,source_id:'scan-line-b',origin_line_id:'original-line-b',unit_price:23}];
test('heat/grind pair is a review hint only for verified same customer, slip, exact weight and two original rate lines',async()=>{
 const {classifyHeatGrind}=await import('../data/heat-grind-classification.js');const input=pair(),before=structuredClone(input);const result=classifyHeatGrind(input,{customers});
 assert.deepEqual(result.map(r=>r.decision.process),['熱處理','研磨']);assert.ok(result.every(r=>r.decision.kind==='paired_rate_hint'&&r.decision.requires_review));assert.deepEqual(result.map(r=>r.source),before);assert.deepEqual(input,before);
});
test('explicit/person decisions and known prices win; grades, magnetic, mixed work and ambiguity never get a pair guess',async()=>{
 const {classifyHeatGrind}=await import('../data/heat-grind-classification.js');
 const explicit=pair();explicit[0].explicit_process='研磨';explicit[0].person_process='熱處理';explicit[1].explicit_process='磁振';const result=classifyHeatGrind(explicit,{customers});assert.equal(result[0].decision.process,'熱處理');assert.equal(result[0].decision.kind,'person_specified');assert.equal(result[1].decision.process,'磁振');
 for(const guard of [{has_existing_quote:true},{quote_process:'研磨',quote_verified:false},{grinding_grade:'AA'},{item_text:'白鐵 3A 研磨'},{item_text:'研磨 AA'},{item_text:'磁振'},{item_text:'熱＋研混合'},{item_text:'研加亮'},{mixed_process:true},{ambiguous:true},{duplicate:true}]){
  const input=pair();Object.assign(input[0],guard);assert.ok(classifyHeatGrind(input,{customers}).every(r=>r.decision.kind!=='paired_rate_hint'),JSON.stringify(guard));
 }
 const counter=pair();counter[0].explicit_process='磁振';counter[1].explicit_process='熱處理';assert.deepEqual(classifyHeatGrind(counter,{customers}).map(r=>r.decision.process),['磁振','熱處理']);
 const known=pair();Object.assign(known[0],{has_existing_quote:true,quote_verified:true,quote_process:'研亮'});assert.equal(classifyHeatGrind(known,{customers})[0].decision.process,'研亮');
});
test('batch/barrel are review-only unit hints and cannot override written process',async()=>{
 const {classifyHeatGrind}=await import('../data/heat-grind-classification.js');const input=[{...base,source_id:'batch',billing_unit:'批'},{...base,source_id:'barrel',billing_unit:'桶'},{...base,source_id:'written',billing_unit:'桶',explicit_process:'熱處理'}];
 const r=classifyHeatGrind(input,{customers});assert.equal(r[0].decision.kind,'unit_hint');assert.equal(r[0].decision.process,'熱處理');assert.equal(r[0].decision.requires_review,true);assert.equal(r[1].decision.process,null);assert.deepEqual(r[1].decision.alternatives,['研磨','磁振']);assert.equal(r[2].decision.kind,'explicit_process');assert.deepEqual(r.map(x=>x.source),input);
});
test('cross-slip/customer/weight, duplicate origins or sources, equal or missing prices and non-kg units never pair',async()=>{
 const {classifyHeatGrind}=await import('../data/heat-grind-classification.js');
 const cases=[p=>p[1].slip_id='SYNTHETIC-OTHER',p=>p[1].customer={canonical_id:'S-B'},p=>p[1].weight_kg='12.51',p=>p[1].origin_line_id=p[0].origin_line_id,p=>p[1].source_id=p[0].source_id,p=>p[1].unit_price=61,p=>p[1].unit_price=null,p=>p[1].origin_line_id=null,p=>p[1].billing_unit='原帳未註',p=>p[1].billing_unit='批',p=>p[0].customer={code:'77'},p=>p.push({...p[0],source_id:'third',origin_line_id:'third-origin'})];
 for(const change of cases){const p=pair();change(p);assert.ok(classifyHeatGrind(p,{customers}).every(r=>r.decision.kind!=='paired_rate_hint'));}
 const exact=pair();exact[1].weight_kg='012.5000';assert.equal(classifyHeatGrind(exact,{customers})[0].decision.kind,'paired_rate_hint');
});
test('private person-confirmed references apply only to exact reviewed scope and never become prices or permanent rules',async()=>{
 const {classifyHeatGrind}=await import('../data/heat-grind-classification.js');const input=pair();input[0].batch_id='SYNTHETIC-REVIEW';input[0].explicit_process='熱處理';
 const ref={id:'synthetic-ref',customer_id:'synthetic-a',authority:'person_confirmed',confirmed:true,status:'confirmed',classification_only:true,evidence_id:'synthetic-evidence',scope:{batch_id:'SYNTHETIC-REVIEW',slip_id:'SYNTHETIC-001',origin_line_id:'original-line-a'},unit_price:61,billing_unit:'kg',process:'磁振'};
 const out=classifyHeatGrind(input,{customers,references:[ref]});assert.equal(out[0].decision.kind,'scoped_reference');assert.equal(out[0].decision.process,'磁振');assert.equal(out[0].decision.reference_id,'synthetic-ref');assert.deepEqual(out.map(x=>x.source),input);
 for(const change of [{confirmed:false},{status:'tentative'},{status:'historical_only'},{status:'record_only'},{classification_only:false},{evidence_id:null},{scope:{}},{scope:{batch_id:'OTHER'}},{customer_id:'synthetic-b'},{unit_price:62}])assert.equal(classifyHeatGrind(input,{customers,references:[{...ref,...change}]})[0].decision.kind,'explicit_process');
 const conflict={...ref,id:'synthetic-conflict',process:'研磨'};assert.equal(classifyHeatGrind(input,{customers,references:[ref,conflict]})[0].decision.kind,'review');
 const excluded=classifyHeatGrind(input,{customers,references:[{...ref,process:null,not_heat:true}]})[0].decision;assert.equal(excluded.process,null);assert.equal(excluded.not_heat,true);
});
