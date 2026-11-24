// Private mappings are injected by the caller; a display code is never an identity.
function resolveClassificationCustomer(ref={}, customers=[], aliases=[]) {
  const ids=new Set(), text=v=>String(v??'').trim();
  if(ref.canonical_id&&!customers.some(c=>c.canonical_id===ref.canonical_id))return {status:'unmatched',customer_id:null};
  if(ref.vendor_id)ids.add(String(ref.vendor_id));
  if(ref.canonical_id)for(const c of customers)if(c.canonical_id===ref.canonical_id)ids.add(c.id);
  if(ref.vendor_id||ref.canonical_id){
    if(ids.size!==1)return {status:ids.size?'ambiguous':'unmatched',customer_id:null};
  }else{
    if(text(ref.code)&&text(ref.name))for(const c of customers)if(text(c.code)===text(ref.code)&&text(c.short_name)===text(ref.name))ids.add(c.id);
    if(text(ref.name))for(const a of aliases)if(a.confirmed===true&&text(a.name)===text(ref.name)&&(!a.code||text(a.code)===text(ref.code)))ids.add(a.customer_id);
  }
  const valid=[...ids].filter(id=>customers.some(c=>c.id===id));
  return {status:ids.size>1?'ambiguous':valid.length===1?'matched':'unmatched',customer_id:ids.size===1&&valid.length===1?valid[0]:null};
}

function normalizeClassificationUnit(unit) {
  return ({kg:'kg','公斤':'kg','桶':'桶','批':'批'})[String(unit??'').trim().toLowerCase()]||null;
}

function decimal(value){
  const text=String(value??'').trim();
  if(text.length>48||!/^\d+(?:\.\d+)?$/.test(text))return null;
  const [whole,fraction='']=text.split('.');
  const key=(whole.replace(/^0+(?=\d)/,'')||'0')+(fraction.replace(/0+$/,'')?'.'+fraction.replace(/0+$/,''):'');
  return key==='0'?null:key;
}
function compareDecimal(a,b){
  const [aw,af='']=a.split('.'),[bw,bf='']=b.split('.'),scale=Math.max(af.length,bf.length);
  const left=BigInt(aw+af.padEnd(scale,'0')),right=BigInt(bw+bf.padEnd(scale,'0'));
  return left>right?1:left<right?-1:0;
}
const review=reason=>({kind:'review',process:null,requires_review:true,reason});
const present=v=>typeof v==='string'&&v.trim()!=='';
function protectedDecision(row){
  if(present(row.person_process))return {kind:'person_specified',process:row.person_process,requires_review:false,reason:'person_specified'};
  if(present(row.explicit_process))return row.ambiguous?review('ambiguous_explicit_process'):{kind:'explicit_process',process:row.explicit_process,requires_review:false,reason:'written_process'};
  if(row.has_existing_quote||row.quote_process||row.quote_verified||row.matched_price_id)return row.quote_verified===true&&present(row.quote_process)?{kind:'existing_quote',process:row.quote_process,requires_review:false,reason:'verified_existing_quote'}:review('existing_quote_requires_check');
  const text=[row.item_text,row.process_text].filter(Boolean).join(' ').normalize('NFKC');
  if(row.ambiguous)return review('ambiguous_source');
  if(row.duplicate)return review('duplicate_source');
  if(row.grinding_grade||/(?:^|[^A-Za-z0-9])(?:\d+(?:\.\d+)?\s*A+|A{1,3})(?=$|[^A-Za-z0-9])/i.test(text))return review('grinding_grade_exception');
  if(/磁振/.test(text))return review('magnetic_exception');
  if(row.mixed_process||/研加亮/.test(text)||/熱/.test(text)&&/研/.test(text))return review('mixed_process_exception');
  return review('insufficient_evidence');
}

// Classification annotations only. Original rows, prices and amounts never change.
export function classifyHeatGrind(rows,{customers=[],aliases=[],references=[]}={}){
  const result=rows.map(source=>({source:structuredClone(source),decision:protectedDecision(source)}));
  rows.forEach((row,index)=>{
    if(result[index].decision.kind==='person_specified')return;
    const customer=resolveClassificationCustomer(row.customer,customers,aliases);
    if(customer.status!=='matched')return;
    const matches=references.filter(ref=>{
      if(ref.customer_id!==customer.customer_id||ref.authority!=='person_confirmed'||ref.confirmed!==true||ref.status!=='confirmed'||ref.classification_only!==true||!present(ref.evidence_id))return false;
      if(!present(ref.process)&&ref.not_heat!==true)return false;
      const scope=Object.entries(ref.scope||{});
      if(!scope.length||!scope.every(([key,value])=>['batch_id','slip_id','origin_line_id'].includes(key)&&present(value)&&row[key]===value))return false;
      if(ref.item_key!==undefined&&ref.item_key!==row.item_key)return false;
      if(ref.unit_price!==undefined&&(!decimal(ref.unit_price)||decimal(ref.unit_price)!==decimal(row.unit_price)))return false;
      if(ref.billing_unit!==undefined&&(!normalizeClassificationUnit(ref.billing_unit)||normalizeClassificationUnit(ref.billing_unit)!==normalizeClassificationUnit(row.billing_unit)))return false;
      return true;
    });
    if(!matches.length)return;
    if(new Set(matches.map(r=>JSON.stringify([r.process||null,r.not_heat===true]))).size!==1){result[index].decision=review('conflicting_scoped_references');return;}
    result[index].decision={kind:'scoped_reference',process:matches[0].process||null,not_heat:matches[0].not_heat===true,reference_id:matches[0].id,requires_review:false,reason:'person_confirmed_original_scope_only'};
  });
  const groups=new Map(),origins=new Map(),sources=new Map();
  for(const row of rows)if(row.origin_line_id)origins.set(row.origin_line_id,(origins.get(row.origin_line_id)||0)+1);
  for(const row of rows)if(row.source_id)sources.set(row.source_id,(sources.get(row.source_id)||0)+1);
  rows.forEach((row,index)=>{
    if((row.origin_line_id&&origins.get(row.origin_line_id)>1)||(row.source_id&&sources.get(row.source_id)>1)){
      if(result[index].decision.reason==='insufficient_evidence')result[index].decision=review('duplicate_source');
    }
  });
  rows.forEach((row,index)=>{
    const customer=resolveClassificationCustomer(row.customer,customers,aliases),weight=decimal(row.weight_kg);
    if(customer.status!=='matched'||!row.slip_id||!weight)return;
    const key=JSON.stringify([customer.customer_id,row.slip_id,weight]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(index);
  });
  for(const indices of groups.values()){
    if(indices.length!==2)continue;
    if(indices.some(i=>result[i].decision.reason!=='insufficient_evidence'))continue;
    const [a,b]=indices.map(i=>rows[i]),prices=[decimal(a.unit_price),decimal(b.unit_price)];
    if(!prices[0]||!prices[1]||compareDecimal(...prices)===0)continue;
    if(![a,b].every(row=>row.origin_line_id&&origins.get(row.origin_line_id)===1&&normalizeClassificationUnit(row.billing_unit)==='kg'))continue;
    const high=compareDecimal(...prices)>0?0:1;
    indices.forEach((index,n)=>{result[index].decision={kind:'paired_rate_hint',process:n===high?'熱處理':'研磨',requires_review:true,reason:'same_customer_slip_weight_two_original_rates'};});
  }
  rows.forEach((row,index)=>{
    if(result[index].decision.reason!=='insufficient_evidence')return;
    const unit=normalizeClassificationUnit(row.billing_unit);
    if(unit==='批')result[index].decision={kind:'unit_hint',process:'熱處理',requires_review:true,reason:'batch_bias_not_proof'};
    if(unit==='桶')result[index].decision={kind:'unit_hint',process:null,alternatives:['研磨','磁振'],requires_review:true,reason:'barrel_does_not_distinguish_grind_or_magnetic'};
  });
  return result;
}
